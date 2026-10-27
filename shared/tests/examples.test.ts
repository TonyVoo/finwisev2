import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import {
  ApiError,
  AuthResponse,
  CategoryCreateRequest,
  CategoryListResponse,
  CategoryResponse,
  CategoryUpdateRequest,
  ChangeEmailRequest,
  ChangePasswordRequest,
  DeleteAccountRequest,
  ExpenseCreateRequest,
  ExpenseListResponse,
  ExpenseResponse,
  ExpenseUpdateRequest,
  HealthResponse,
  LoginRequest,
  LogoutRequest,
  MeResponse,
  RefreshRequest,
  RefreshResponse,
  SignupRequest,
  SyncPullResponse,
  SyncPushRequest,
  SyncPushResponse,
} from '../src/index.js';

/**
 * Every example in `openapi.yaml` is validated against the zod schema it claims to be.
 *
 * This is the check that makes the spec trustworthy. Mobile and QA build against the
 * examples — they are the first thing a human reads and the thing a mock server replays —
 * so an example with a stale field name or a float amount teaches the wrong contract more
 * effectively than the schema teaches the right one. Here they have to parse.
 */

const SPEC_PATH = new URL('../../docs/api/openapi.yaml', import.meta.url);

type Json = Record<string, unknown>;

const spec = parse(readFileSync(SPEC_PATH, 'utf8')) as Json;

/** Schema name in the spec -> the zod schema that is its single declaration. */
const SCHEMA_BY_NAME = {
  ApiError,
  AuthResponse,
  CategoryCreateRequest,
  CategoryListResponse,
  CategoryResponse,
  CategoryUpdateRequest,
  ChangeEmailRequest,
  ChangePasswordRequest,
  DeleteAccountRequest,
  ExpenseCreateRequest,
  ExpenseListResponse,
  ExpenseResponse,
  ExpenseUpdateRequest,
  HealthResponse,
  LoginRequest,
  LogoutRequest,
  MeResponse,
  RefreshRequest,
  RefreshResponse,
  SignupRequest,
  SyncPullResponse,
  SyncPushRequest,
  SyncPushResponse,
} as const satisfies Record<string, z.ZodType>;

type SchemaName = keyof typeof SCHEMA_BY_NAME;

interface Sample {
  readonly label: string;
  readonly schemaName: SchemaName;
  readonly value: unknown;
}

function deref(node: Json): Json {
  const ref = node.$ref;
  if (typeof ref !== 'string') return node;
  let cursor: unknown = spec;
  for (const part of ref.replace(/^#\//, '').split('/')) {
    cursor = (cursor as Json)[part];
  }
  return cursor as Json;
}

/** Pull `example` / `examples.*.value` out of a media-type object. */
function samplesFrom(container: Json | undefined, where: string): Sample[] {
  const media = (container?.content as Json | undefined)?.['application/json'] as Json | undefined;
  if (media === undefined) return [];

  const ref = (media.schema as Json | undefined)?.$ref;
  const schemaName = typeof ref === 'string' ? (ref.split('/').pop() as SchemaName) : undefined;
  if (schemaName === undefined) return [];

  const out: Sample[] = [];
  if ('example' in media) {
    out.push({ label: `${where} (example)`, schemaName, value: media.example });
  }
  for (const [name, entry] of Object.entries((media.examples as Json | undefined) ?? {})) {
    out.push({
      label: `${where} (examples.${name})`,
      schemaName,
      value: (entry as Json).value,
    });
  }
  return out;
}

const samples: Sample[] = [];
for (const [path, item] of Object.entries(spec.paths as Record<string, Json>)) {
  for (const method of ['get', 'post', 'patch', 'delete'] as const) {
    const operation = item[method] as Json | undefined;
    if (operation === undefined) continue;
    const where = `${method.toUpperCase()} ${path}`;
    samples.push(...samplesFrom(operation.requestBody as Json | undefined, `${where} request`));
    for (const [status, response] of Object.entries(operation.responses as Json)) {
      samples.push(...samplesFrom(deref(response as Json), `${where} ${status}`));
    }
  }
}
// The reusable error responses carry examples too.
for (const [name, response] of Object.entries((spec.components as Json).responses as Json)) {
  samples.push(...samplesFrom(response as Json, `responses.${name}`));
}

describe('openapi examples validate against the shared zod schemas', () => {
  it('found examples to check, so a refactor cannot silently empty this suite', () => {
    expect(samples.length).toBeGreaterThan(20);
  });

  it('only references schema names this test knows about', () => {
    // Guards the inverse failure: a new named body schema whose examples are never
    // checked because nobody added it to SCHEMA_BY_NAME.
    for (const sample of samples) {
      expect(
        SCHEMA_BY_NAME[sample.schemaName],
        `unmapped schema ${sample.schemaName}`,
      ).toBeDefined();
    }
  });

  it.each(samples)('$label parses as $schemaName', ({ schemaName, value }) => {
    const result = SCHEMA_BY_NAME[schemaName].safeParse(value);
    expect(
      result.success ? [] : result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
    ).toEqual([]);
  });
});

describe('the examples demonstrate the decisions, not just the shapes', () => {
  function sample(label: string): unknown {
    const found = samples.find((s) => s.label === label);
    expect(found, `missing example: ${label}`).toBeDefined();
    return found!.value;
  }

  it('shows an integer minor-unit amount, never a float', () => {
    const response = ExpenseListResponse.parse(sample('GET /v1/expenses 200 (example)'));
    const expense = response.data[0]!;
    expect(Number.isInteger(expense.amountMinor)).toBe(true);
    expect(expense.currency).toMatch(/^[A-Z]{3}$/);
  });

  it('shows a calendar date for `date` and an instant for createdAt/updatedAt', () => {
    const response = ExpenseListResponse.parse(sample('GET /v1/expenses 200 (example)'));
    const expense = response.data[0]!;
    expect(expense.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(expense.createdAt).toMatch(/T.*Z$/);
    expect(expense.updatedAt).toMatch(/T.*Z$/);
  });

  it('shows a delete as a tombstone rather than an absent row', () => {
    const response = ExpenseResponse.parse(sample('DELETE /v1/expenses/{id} 200 (example)'));
    expect(response.data.deletedAt).not.toBeNull();
  });

  it('shows the up-to-date pull echoing `since` back as `nextCursor`', () => {
    const response = SyncPullResponse.parse(sample('GET /v1/sync 200 (examples.upToDate)'));
    expect(response.changes).toEqual([]);
    expect(response.hasMore).toBe(false);
    expect(response.resyncRequired).toBe(false);
    expect(response.nextCursor).toBeGreaterThan(0);
  });

  it('shows a pull page whose nextCursor is the highest revision delivered', () => {
    const response = SyncPullResponse.parse(sample('GET /v1/sync 200 (examples.incremental)'));
    const revisions = response.changes.map((change) => change.record.revision);
    expect(response.nextCursor).toBe(Math.max(...revisions));
    expect(response.hasMore).toBe(true);
    // Categories lead, so an expense can reference one created in the same batch.
    expect(response.changes.map((change) => change.entity)).toEqual(['category', 'expense']);
  });

  it('shows resyncRequired with no changes and a zeroed cursor', () => {
    const response = SyncPullResponse.parse(sample('GET /v1/sync 200 (examples.resyncRequired)'));
    expect(response.resyncRequired).toBe(true);
    expect(response.changes).toEqual([]);
    expect(response.nextCursor).toBe(0);
    expect(response.hasMore).toBe(false);
  });

  it('shows a tombstone arriving through the pull', () => {
    const response = SyncPullResponse.parse(sample('GET /v1/sync 200 (examples.tombstone)'));
    expect(response.changes).toHaveLength(1);
    expect(response.changes[0]!.record.deletedAt).not.toBeNull();
  });

  it('shows a push request pushing categories before expenses', () => {
    const request = SyncPushRequest.parse(sample('POST /v1/sync request (example)'));
    expect(request.changes.map((change) => change.entity)).toEqual(['category', 'expense']);
    // The expense references the category created in the same batch — one round trip.
    const category = request.changes[0]!;
    const expense = request.changes[1]!;
    expect(expense.entity === 'expense' && expense.fields.categoryId).toBe(category.id);
  });

  it('shows every push item carrying its own idempotency key', () => {
    const request = SyncPushRequest.parse(sample('POST /v1/sync request (example)'));
    const ids = request.changes.map((change) => change.clientMutationId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('shows a conflict still returning the authoritative server row', () => {
    const response = SyncPushResponse.parse(sample('POST /v1/sync 200 (examples.conflict)'));
    const result = response.results[0]!;
    expect(result.status).toBe('conflict_server_wins');
    expect(result.record).not.toBeNull();
    expect(result.error).toBeNull();
  });

  it('shows an invalid record explaining itself and not inventing a server row', () => {
    const response = SyncPushResponse.parse(sample('POST /v1/sync 200 (examples.invalid)'));
    const result = response.results[0]!;
    expect(result.status).toBe('invalid');
    expect(result.record).toBeNull();
    expect(result.error?.code).toBe('unknown_category');
  });

  it('shows a retried mutation replaying its original result', () => {
    const replay = SyncPushResponse.parse(sample('POST /v1/sync 200 (examples.idempotentReplay)'));
    const applied = SyncPushResponse.parse(sample('POST /v1/sync 200 (examples.applied)'));

    const replayed = replay.results[0]!;
    const original = applied.results.find((r) => r.clientMutationId === replayed.clientMutationId);

    expect(original, 'the replay example should reuse an applied clientMutationId').toBeDefined();
    expect(replayed.idempotentReplay).toBe(true);
    expect(original!.idempotentReplay).toBe(false);
    // Same outcome, same row, same revision: the retry did not apply a second time.
    expect(replayed.status).toBe(original!.status);
    expect(replayed.record).toEqual(original!.record);
  });

  it('shows auth returning a duration for the access token and an instant for the refresh token', () => {
    const response = AuthResponse.parse(sample('POST /v1/auth/signup 201 (example)'));
    expect(Number.isInteger(response.accessTokenExpiresIn)).toBe(true);
    expect(response.refreshTokenExpiresAt).toMatch(/T.*Z$/);
  });
});
