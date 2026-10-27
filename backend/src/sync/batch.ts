import { createHash } from 'node:crypto';
import {
  LIMITS,
  SERVER_OWNED_FIELDS,
  SyncEntity,
  SyncPushItem,
  Uuid,
  type ApiErrorBody,
} from '@expense-tracker/shared';
import { z } from 'zod';
import { ApiProblem, problems } from '../errors.ts';
import { toIssues } from '../http/issues.ts';

/**
 * Parsing a push batch.
 *
 * The rest of this API validates a request body against one `shared/` schema and
 * answers `400` if anything in it is wrong. `POST /v1/sync` cannot do that, and the
 * reason is the whole point of the endpoint: the body is a batch, the client is an
 * offline outbox, and a `400` for the batch means the outbox never drains. One row that
 * is permanently unacceptable — a locally-corrupted record, a field written by a version
 * of the app that has since been fixed — would wedge the client forever, taking every
 * good row queued behind it down too.
 *
 * So the batch is parsed in two layers:
 *
 *  1. The **envelope**, loosely: is this `{ changes: [...] }` with a legal length? A
 *     failure here is genuinely batch-level and is the contract's `400`/`413`.
 *  2. Each **item**, individually. An item that fails becomes a per-record `invalid`
 *     result and the rest of the batch proceeds.
 *
 * Layer 2 has a floor: a result must carry `entity`, `id` and `clientMutationId` for the
 * client to match it back to its outbox at all. An item missing those cannot be answered
 * per-record, so *that* is the one item-level failure which is still a `400` — and it
 * names the offending index so the client can find it.
 */

/**
 * The minimum an item must supply to be answerable at all.
 *
 * Loose rather than strict, because its job is only to recover the three fields a result
 * is keyed on. Everything else is checked by {@link SyncPushItem} afterwards.
 */
const PushItemIdentity = z.looseObject({
  entity: SyncEntity,
  id: Uuid,
  clientMutationId: Uuid,
});

export type PushItemIdentity = z.infer<typeof PushItemIdentity>;

/**
 * The envelope, checked for shape and size only.
 *
 * `z.unknown()` for the elements is the point: validating them here would collapse the
 * two layers back into one and reintroduce the wedged outbox.
 */
const PushEnvelope = z.strictObject({ changes: z.array(z.unknown()) });

/** One item of a parsed batch: either a usable mutation, or the reason it is not. */
export interface ParsedPushItem {
  /** Position in the request, which is the order results must come back in. */
  readonly index: number;
  readonly identity: PushItemIdentity;
  /** The validated mutation, or null when `error` says why there isn't one. */
  readonly item: SyncPushItem | null;
  /** Non-null exactly when `item` is null. Becomes the result's `error`. */
  readonly error: ApiErrorBody | null;
  /** SHA-256 of the canonicalised item; the idempotency ledger's payload fingerprint. */
  readonly payloadHash: string;
}

/**
 * Canonical JSON: object keys sorted, recursively.
 *
 * The payload hash has to be stable across retries, and a retry is a re-serialisation of
 * the same local row — by the same client, but not necessarily with the same key order,
 * because nothing in JSON or JavaScript promises one. Sorting makes the hash a function
 * of the *content*, so a genuine retry always matches and only a genuinely different
 * payload is reported as `mutation_id_reused`.
 *
 * Arrays keep their order, which is correct: order is content in an array.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    // `undefined` is absent from JSON, so a key holding it must not change the hash.
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`);
  return `{${entries.join(',')}}`;
}

/** The ledger's payload fingerprint for one request item. */
export function hashPushItem(raw: unknown): string {
  return createHash('sha256').update(canonicalJson(raw)).digest('hex');
}

const SERVER_OWNED = new Set<string>(SERVER_OWNED_FIELDS);

/**
 * Did this item fail because it tried to write a server-owned field?
 *
 * `fields` is a `strictObject`, so `fields.revision` comes back from zod as an
 * unrecognised key — indistinguishable, at that level, from a typo. The contract gives
 * the two different codes (`immutable_field` vs `validation_error`) because they are
 * different client bugs: one is "you tried to set something you don't own", which the
 * client must stop doing, and the other is a misspelling. Worth telling apart.
 */
function immutableFieldIssue(error: z.ZodError): string | undefined {
  for (const issue of error.issues) {
    const leaf = issue.path.at(-1);
    if (typeof leaf === 'string' && SERVER_OWNED.has(leaf)) return leaf;
    // zod reports unrecognised keys on the *container* with the keys in the message.
    if (issue.code === 'unrecognized_keys') {
      const keys = (issue as unknown as { keys?: unknown }).keys;
      if (Array.isArray(keys)) {
        const owned = keys.find((k): k is string => typeof k === 'string' && SERVER_OWNED.has(k));
        if (owned !== undefined) return owned;
      }
    }
  }
  return undefined;
}

/** The per-record error for an item that failed its own schema. */
function itemValidationError(error: z.ZodError): ApiErrorBody {
  const owned = immutableFieldIssue(error);
  const problem =
    owned === undefined
      ? problems.validation('This change failed validation.', toIssues(error))
      : new ApiProblem(
          'immutable_field',
          `\`${owned}\` is assigned by the server and cannot be pushed.`,
          toIssues(error),
        );
  return problem.toEnvelope().error;
}

/**
 * Parse a `POST /v1/sync` body.
 *
 * Throws an {@link ApiProblem} only for the failures that are genuinely about the batch
 * rather than about a row in it. Everything else comes back as a `ParsedPushItem` with
 * `item: null`, to be answered per-record.
 */
export function parsePushBatch(body: unknown): ParsedPushItem[] {
  // body-parser leaves `req.body` undefined when the request carried no body at all.
  // That is "you forgot the body", not "a field failed validation" — same distinction
  // `validateBody` draws for every other endpoint.
  if (body === undefined || body === null) {
    throw problems.malformedRequest('A JSON request body is required.');
  }
  if (typeof body !== 'object' || Array.isArray(body)) {
    throw problems.malformedRequest('Request body must be a JSON object.');
  }

  const envelope = PushEnvelope.safeParse(body);
  if (!envelope.success) {
    throw problems.validation('Request body failed validation.', toIssues(envelope.error));
  }

  const { changes } = envelope.data;

  // Checked before the per-item work, and as a `413` rather than the `400` the shared
  // schema's `.max()` would give: the contract tells the client to split and resend, and
  // that is a different recovery from "fix this field".
  if (changes.length > LIMITS.SYNC_MAX_BATCH_SIZE) {
    throw problems.batchTooLarge(
      `A sync batch may contain at most ${LIMITS.SYNC_MAX_BATCH_SIZE} changes; got ${changes.length}.`,
    );
  }
  if (changes.length === 0) {
    throw problems.validation('Request body failed validation.', {
      issues: [{ path: 'changes', message: 'must contain at least one change' }],
    });
  }

  return changes.map((raw, index) => {
    const identity = PushItemIdentity.safeParse(raw);
    if (!identity.success) {
      // No `entity`/`id`/`clientMutationId` means no addressable result. The only honest
      // answer is a batch-level failure that points at the index.
      throw problems.validation(
        `changes[${index}] is missing the entity, id or clientMutationId a result is keyed on.`,
        {
          issues: toIssues(identity.error).issues.map((issue) => ({
            path: `changes.${index}.${issue.path}`,
            message: issue.message,
          })),
        },
      );
    }

    const payloadHash = hashPushItem(raw);
    const parsed = SyncPushItem.safeParse(raw);
    return parsed.success
      ? { index, identity: identity.data, item: parsed.data, error: null, payloadHash }
      : {
          index,
          identity: identity.data,
          item: null,
          error: itemValidationError(parsed.error),
          payloadHash,
        };
  });
}
