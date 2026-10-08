import { CalendarDate, Uuid, type OpaqueCursor } from '@expense-tracker/shared';
import { z } from 'zod';
import { problems } from '../errors.ts';

/**
 * The opaque cursor for `GET /v1/expenses`.
 *
 * Pagination is **keyset** on `(date DESC, id DESC)`, not offset. Offset pagination
 * skips or repeats rows whenever a write lands between two page requests, and with an
 * actively syncing client that is the normal case rather than an edge case. So the
 * cursor carries the sort key of the last row of the page just served, and the next page
 * asks for "everything strictly after this key".
 *
 * It is `base64url(JSON)` with short keys — the contract's example is
 * `eyJkIjoiMjAyNi0xMC0wNSIsImkiOiIwMTkyZjNiMSJ9`, i.e. `{"d":"…","i":"…"}` — and the
 * contract tells clients to pass it back verbatim and never to parse or construct one.
 *
 * It is deliberately *not* signed. A client that forges a syntactically valid cursor
 * only moves its own window: every query is still scoped by the `userId` from the token,
 * so there is nothing here to escalate with. What matters is that an *undecodable*
 * cursor is a loud `400 invalid_cursor` and never a silently empty page — an empty page
 * reads as "no more data" and the client stops paginating, losing rows without an error.
 */

const CursorPayload = z.strictObject({
  /** The last row's calendar `date`. */
  d: CalendarDate,
  /** The last row's `id`, which breaks ties within a date. */
  i: Uuid,
});

export interface ExpenseCursor {
  readonly date: string;
  readonly id: string;
}

export function encodeExpenseCursor(cursor: ExpenseCursor): OpaqueCursor {
  const payload: z.infer<typeof CursorPayload> = { d: cursor.date, i: cursor.id };
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

/**
 * Decode a cursor, or raise `400 invalid_cursor`.
 *
 * Every failure mode funnels to the same error: bad base64, non-JSON, JSON that is not
 * an object, an object missing a key, a `date` that is not a calendar date, an `id` that
 * is not a UUID. A truncated or tampered cursor therefore cannot reach the query builder
 * and turn into a 500 or an empty page.
 */
export function decodeExpenseCursor(cursor: OpaqueCursor): ExpenseCursor {
  let parsed: unknown;
  try {
    // `base64url` decoding is lenient — it ignores trailing junk rather than throwing —
    // so the strict check is the JSON parse and the schema below it, not this line.
    parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    throw problems.invalidCursor();
  }

  const result = CursorPayload.safeParse(parsed);
  if (!result.success) throw problems.invalidCursor();

  return { date: result.data.d, id: result.data.i };
}
