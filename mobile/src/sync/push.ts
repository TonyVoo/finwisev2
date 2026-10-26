import {
  type SyncChange,
  SyncPushItem,
  type SyncPushResult,
  type SyncPushStatus,
} from '@expense-tracker/shared';
import type { ApiClient } from '../api/client';
import { type Clock, toTimestamp } from '../lib/clock';
import type { SqliteDatabase } from '../db/sqlite';
import { applyServerRecord } from './apply';
import {
  type OutboxEntry,
  deleteOutboxEntries,
  readOutboxBatch,
  recordOutboxAttempt,
} from './outbox';
import { clearRejection, recordRejection } from './rejections';
import { SessionChangedError, type SessionGuard } from './sessionGuard';

/**
 * The drain: `POST /v1/sync` until the outbox is empty.
 *
 * The rules this follows are the ones a straightforward implementation gets wrong, so
 * each is stated with the failure it avoids:
 *
 * 1. **A result is matched to its entry by `clientMutationId`, never by position.** The
 *    contract echoes the id back for exactly this purpose and the column is `UNIQUE`,
 *    so the lookup is exact. Matching by index would survive every test and then
 *    mis-file a row the first time the server answered in a different order.
 * 2. **`record` is written back whenever it is non-null - including on `invalid`.** The
 *    natural reading is "apply on `applied` and `conflict_server_wins`, surface the
 *    error otherwise", and that throws away an authoritative row: a `mutation_id_reused`
 *    result carries the row the server already stored. The contract's normative sentence
 *    is that `record` "is null only when there is no server row to report", so **null is
 *    the only signal that there is nothing to apply.**
 * 3. **Several results for one row are written back in the order the items were sent**,
 *    so the last write-back is the one that survives. The order used is *this client's
 *    own request index*, not the index the result arrived at. The server does promise to
 *    answer in request order, but a correctness property that can only be checked by
 *    trusting the other side is one this client can simply not depend on - and the
 *    request order is sitting right here.
 * 4. **`clientMutationId` is read off the outbox row and never regenerated.** It is
 *    minted once, at enqueue, inside the same transaction as the row write
 *    (`db/write.ts`), so it already survives restarts; the only way to break idempotency
 *    from here is to mint a new one on retry, which would double-apply the write.
 * 5. **An entry is retired the moment the server answers it, whatever the answer.** A
 *    refused mutation that stays queued retries forever - a silent battery and bandwidth
 *    leak - so `invalid` retires the entry and leaves a rejection row behind instead
 *    (`rejections.ts`).
 *
 * Entries the server did *not* answer stay queued and are retried on the next sync.
 */

export interface PushDependencies {
  readonly database: SqliteDatabase;
  readonly api: Pick<ApiClient, 'pushSync'>;
  readonly clock: Clock;
  /**
   * Keeps the pass inside the session it began in (`sessionGuard.ts`). The engine always
   * supplies one; it is optional here only so the drain's own unit cases, which have no
   * session to speak of, need not invent one.
   */
  readonly guard?: SessionGuard;
}

export interface PushOutcome {
  /** Round trips made. Zero when the outbox was already empty. */
  readonly batches: number;
  readonly applied: number;
  readonly conflicted: number;
  readonly rejected: number;
  /** True when entries were still queued after the drain stopped making progress. */
  readonly drained: boolean;
}

/** An entry paired with the wire item it will be sent as, or with why it cannot be. */
type Prepared =
  | { readonly kind: 'sendable'; readonly entry: OutboxEntry; readonly item: SyncPushItem }
  | { readonly kind: 'unsendable'; readonly entry: OutboxEntry; readonly reason: string };

function prepare(entry: OutboxEntry): Prepared {
  if (entry.fields === null) {
    return { kind: 'unsendable', entry, reason: 'Queued change could not be read' };
  }

  // Parsed rather than cast. The fields were validated at enqueue, so a failure here is
  // store corruption - and an item the server would answer with a 400 for the whole
  // batch must not be allowed to block every other entry behind it.
  const parsed = SyncPushItem.safeParse({
    entity: entry.entity,
    id: entry.recordId,
    updatedAt: entry.updatedAt,
    clientMutationId: entry.clientMutationId,
    fields: entry.fields,
  });

  return parsed.success
    ? { kind: 'sendable', entry, item: parsed.data }
    : {
        kind: 'unsendable',
        entry,
        reason: parsed.error.issues.map((issue) => issue.message).join('; '),
      };
}

/** The result's record as a {@link SyncChange}, keeping the entity and record together. */
function toChange(result: SyncPushResult): SyncChange | null {
  if (result.record === null) return null;
  switch (result.entity) {
    case 'category':
      return { entity: 'category', record: result.record };
    case 'recurring':
      return { entity: 'recurring', record: result.record };
    case 'expense':
      return { entity: 'expense', record: result.record };
  }
}

function tally(outcome: PushOutcome, status: SyncPushStatus): PushOutcome {
  switch (status) {
    case 'applied':
      return { ...outcome, applied: outcome.applied + 1 };
    case 'conflict_server_wins':
      return { ...outcome, conflicted: outcome.conflicted + 1 };
    case 'invalid':
      return { ...outcome, rejected: outcome.rejected + 1 };
  }
}

/** One entry as it was sent, with the position it occupied in the request. */
interface SentEntry {
  readonly entry: OutboxEntry;
  readonly index: number;
}

/**
 * Push every queued mutation, in batches, categories before expenses.
 *
 * Throws whatever the transport throws - a `NetworkUnavailableError` offline, an
 * `ApiRequestError` on a server fault. Nothing local changes on that path: the entries
 * stay queued and the next trigger retries them with the same `clientMutationId`s,
 * which is what makes a dropped response a no-op rather than a double-apply.
 */
export async function drainOutbox(deps: PushDependencies): Promise<PushOutcome> {
  const { database, api, clock, guard } = deps;
  let outcome: PushOutcome = {
    batches: 0,
    applied: 0,
    conflicted: 0,
    rejected: 0,
    drained: true,
  };

  for (;;) {
    const entries = await readOutboxBatch(database);
    if (entries.length === 0) break;
    // The rows just read belong to whoever was signed in when the pass began; if that is no
    // longer anyone's session, nothing below - the retirements, the request, the
    // write-backs - may touch the database or the wire.
    guard?.assertCurrent();

    const prepared = entries.map(prepare);
    const sendable = prepared.filter((item) => item.kind === 'sendable');
    const unsendable = prepared.filter((item) => item.kind === 'unsendable');

    // Unreadable entries are retired first and locally, without a round trip. They
    // cannot be fixed by sending them and must not hold up the entries behind them.
    if (unsendable.length > 0) {
      const rejectedAt = toTimestamp(clock());
      await database.withExclusiveTransactionAsync(async (txn) => {
        guard?.assertCurrent();
        await deleteOutboxEntries(
          txn,
          unsendable.map((item) => item.entry.seq),
        );
        for (const { entry, reason } of unsendable) {
          await recordRejection(txn, {
            entity: entry.entity,
            recordId: entry.recordId,
            code: 'validation_error',
            message: reason,
            rejectedAt,
          });
        }
      });
      outcome = { ...outcome, rejected: outcome.rejected + unsendable.length };
    }

    if (sendable.length === 0) continue;

    let response;
    try {
      // Immediately before the call, with nothing awaited between: the interceptor reads the
      // token synchronously on entry, so this and that read see the same session.
      guard?.assertCurrent();
      response = await api.pushSync({ changes: sendable.map((item) => item.item) });
    } catch (error) {
      // Not a failed attempt: the entries belong to a session that has gone, and recording
      // an attempt against them would write into the next user's outbox.
      if (error instanceof SessionChangedError) throw error;
      // `attempts` and `lastError` are diagnostics for the sync sheet, written on the way
      // past rather than swallowed: the entries stay queued, the same
      // `clientMutationId`s go out next time, and a response that was dropped rather than
      // never sent replays its original result instead of applying twice.
      await recordOutboxAttempt(
        database,
        sendable.map((item) => item.entry.seq),
        error instanceof Error ? error.message : String(error),
      );
      throw error;
    }
    outcome = { ...outcome, batches: outcome.batches + 1 };
    // The response answers a request user A made. If B is signed in now, it is not B's.
    guard?.assertCurrent();

    // Rule 1: identity comes from the echoed id. Rule 3: order comes from our own index.
    const sent = new Map<string, SentEntry>(
      sendable.map((item, index) => [item.entry.clientMutationId, { entry: item.entry, index }]),
    );
    const resolved = response.results
      .map((result) => ({ result, sent: sent.get(result.clientMutationId) }))
      .filter(
        (pair): pair is { result: SyncPushResult; sent: SentEntry } => pair.sent !== undefined,
      )
      .sort((a, b) => a.sent.index - b.sent.index);

    if (resolved.length === 0) {
      // The server answered nothing this client recognises. Sending the same batch again
      // would loop forever, so stop and let the next trigger start over.
      outcome = { ...outcome, drained: false };
      break;
    }

    const rejectedAt = toTimestamp(clock());
    await database.withExclusiveTransactionAsync(async (txn) => {
      guard?.assertCurrent();
      // Retired before the write-backs, so `apply.ts` replays only the entries that are
      // genuinely still unsent when it decides what to put back over the server row.
      await deleteOutboxEntries(
        txn,
        resolved.map((pair) => pair.sent.entry.seq),
      );

      for (const { result, sent: sentEntry } of resolved) {
        const change = toChange(result);
        if (change !== null) await applyServerRecord(txn, change);

        if (result.status === 'invalid') {
          await recordRejection(txn, {
            entity: result.entity,
            recordId: sentEntry.entry.recordId,
            code: result.error?.code ?? 'validation_error',
            message: result.error?.message ?? 'The server refused this change',
            rejectedAt,
          });
        } else {
          await clearRejection(txn, result.entity, sentEntry.entry.recordId);
        }
      }
    });

    for (const { result } of resolved) outcome = tally(outcome, result.status);

    // Everything the server answered has left the queue. If it answered fewer items than
    // were sent, the remainder is retried by the next trigger rather than immediately, so
    // a server that keeps omitting the same entry cannot spin this loop.
    if (resolved.length < sendable.length) {
      outcome = { ...outcome, drained: false };
      break;
    }
  }

  if (outcome.drained) {
    outcome = { ...outcome, drained: (await readOutboxBatch(database, 1)).length === 0 };
  }
  return outcome;
}
