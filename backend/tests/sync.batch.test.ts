import { LIMITS } from '@expense-tracker/shared';
import { v7 as uuidv7 } from 'uuid';
import { describe, expect, it } from 'vitest';
import { isApiProblem } from '../src/errors.ts';
import { canonicalJson, hashPushItem, parsePushBatch } from '../src/sync/batch.ts';

/**
 * Unit tests for push-batch parsing.
 *
 * Two properties worth pinning here rather than through HTTP. First, the payload hash has
 * to be a function of *content*: a retry that serialises the same local row with a
 * different key order must replay, not be reported as `mutation_id_reused`. Second, the
 * two-layer split — batch-level failures versus per-record ones — is what stops a single
 * malformed row from wedging an offline client's outbox, and the boundary between the two
 * layers is exactly one case wide.
 */

function item(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    entity: 'category',
    id: uuidv7(),
    updatedAt: '2026-10-09T10:00:00.000Z',
    clientMutationId: uuidv7(),
    fields: { name: 'Coffee' },
    ...overrides,
  };
}

/** The code on a parsed item's per-record error. */
function errorCode(parsed: ReturnType<typeof parsePushBatch>[number]): string | undefined {
  return parsed.error?.code;
}

describe('canonicalJson', () => {
  it('sorts object keys recursively', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}');
  });

  it('preserves array order, because order is content in an array', () => {
    expect(canonicalJson([3, 1, 2])).toBe('[3,1,2]');
  });

  it('ignores a key holding undefined, which JSON cannot represent anyway', () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe(canonicalJson({ a: 1 }));
  });

  it('distinguishes null from absent', () => {
    expect(canonicalJson({ a: null })).not.toBe(canonicalJson({}));
  });

  it('handles the primitives', () => {
    expect(canonicalJson(null)).toBe('null');
    expect(canonicalJson(1)).toBe('1');
    expect(canonicalJson('x')).toBe('"x"');
    expect(canonicalJson(true)).toBe('true');
  });
});

describe('hashPushItem', () => {
  it('is stable across key order, so an honest retry replays', () => {
    const id = uuidv7();
    const clientMutationId = uuidv7();
    const a = {
      entity: 'category',
      id,
      updatedAt: '2026-10-09T10:00:00.000Z',
      clientMutationId,
      fields: { name: 'Coffee', color: '#f59e0b' },
    };
    const b = {
      fields: { color: '#f59e0b', name: 'Coffee' },
      clientMutationId,
      updatedAt: '2026-10-09T10:00:00.000Z',
      id,
      entity: 'category',
    };
    expect(hashPushItem(a)).toBe(hashPushItem(b));
  });

  it('changes when any field changes, so a reused id with new content is caught', () => {
    const base = item();
    expect(hashPushItem(base)).not.toBe(hashPushItem({ ...base, fields: { name: 'Tea' } }));
    expect(hashPushItem(base)).not.toBe(
      hashPushItem({ ...base, updatedAt: '2026-10-09T10:00:01.000Z' }),
    );
  });

  it('is a sha-256 hex digest', () => {
    expect(hashPushItem(item())).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('parsePushBatch — batch-level failures', () => {
  function problemCode(body: unknown): string {
    try {
      parsePushBatch(body);
    } catch (error) {
      if (isApiProblem(error)) return error.code;
      throw error;
    }
    throw new Error('expected parsePushBatch to throw');
  }

  it('rejects a missing body as malformed_request', () => {
    expect(problemCode(undefined)).toBe('malformed_request');
    expect(problemCode(null)).toBe('malformed_request');
    expect(problemCode([])).toBe('malformed_request');
  });

  it('rejects a body with no changes array', () => {
    expect(problemCode({})).toBe('validation_error');
    expect(problemCode({ changes: 'nope' })).toBe('validation_error');
  });

  it('rejects an unknown envelope key', () => {
    expect(problemCode({ changes: [item()], deviceId: 'phone' })).toBe('validation_error');
  });

  it('rejects an empty batch', () => {
    expect(problemCode({ changes: [] })).toBe('validation_error');
  });

  it('rejects an oversized batch as batch_too_large, not validation_error', () => {
    const changes = Array.from({ length: LIMITS.SYNC_MAX_BATCH_SIZE + 1 }, () => item());
    // The recovery differs: "split and resend" rather than "fix this field".
    expect(problemCode({ changes })).toBe('batch_too_large');
  });

  it('accepts a batch exactly at the maximum', () => {
    const changes = Array.from({ length: LIMITS.SYNC_MAX_BATCH_SIZE }, () => item());
    expect(parsePushBatch({ changes })).toHaveLength(LIMITS.SYNC_MAX_BATCH_SIZE);
  });

  it('rejects an item with no addressable identity, naming the index', () => {
    // The one item-level failure that must stay batch-level: with no entity, id or
    // clientMutationId there is nothing to key a per-record result on, so the client
    // could not match an answer back to its outbox.
    try {
      parsePushBatch({ changes: [item(), { fields: { name: 'Coffee' } }] });
      throw new Error('expected a throw');
    } catch (error) {
      expect(isApiProblem(error) && error.code).toBe('validation_error');
      expect(isApiProblem(error) && error.message).toContain('changes[1]');
    }
  });

  it('rejects an unknown entity, since results are discriminated on it', () => {
    try {
      parsePushBatch({ changes: [item({ entity: 'budget' })] });
      throw new Error('expected a throw');
    } catch (error) {
      expect(isApiProblem(error) && error.code).toBe('validation_error');
    }
  });
});

describe('parsePushBatch — per-record failures', () => {
  it('passes a valid item through with its parsed form', () => {
    const [parsed] = parsePushBatch({ changes: [item()] });
    expect(parsed?.item).not.toBeNull();
    expect(parsed?.error).toBeNull();
    expect(parsed?.index).toBe(0);
  });

  it('reports a malformed item without failing the batch', () => {
    const batch = parsePushBatch({
      changes: [item({ fields: { name: '' } }), item({ fields: { name: 'Coffee' } })],
    });
    expect(batch[0]?.item).toBeNull();
    expect(errorCode(batch[0] as never)).toBe('validation_error');
    // The point of the split: one bad row must not stop the good ones behind it.
    expect(batch[1]?.item).not.toBeNull();
  });

  it('reports a server-owned field as immutable_field', () => {
    for (const field of ['revision', 'createdAt', 'id', 'userId'] as const) {
      const batch = parsePushBatch({
        changes: [item({ fields: { name: 'Coffee', [field]: 1 } })],
      });
      expect(errorCode(batch[0] as never), field).toBe('immutable_field');
    }
  });

  it('reports a plain typo as validation_error, not immutable_field', () => {
    // Different client bugs with different fixes: one is "stop setting what you do not
    // own", the other is a misspelling.
    const batch = parsePushBatch({ changes: [item({ fields: { nmae: 'Coffee' } })] });
    expect(errorCode(batch[0] as never)).toBe('validation_error');
  });

  it('reports an empty fields object', () => {
    const batch = parsePushBatch({ changes: [item({ fields: {} })] });
    expect(errorCode(batch[0] as never)).toBe('validation_error');
  });

  it('reports a bad updatedAt, since last-write-wins cannot order without one', () => {
    const batch = parsePushBatch({ changes: [item({ updatedAt: '2026-10-09' })] });
    expect(errorCode(batch[0] as never)).toBe('validation_error');
  });

  it('keeps the identity of a malformed item so a result can still address it', () => {
    const id = uuidv7();
    const clientMutationId = uuidv7();
    const batch = parsePushBatch({
      changes: [item({ id, clientMutationId, fields: { name: '' } })],
    });
    expect(batch[0]?.identity).toMatchObject({ entity: 'category', id, clientMutationId });
    // And it is still hashed, so a retry of the bad row replays rather than re-parsing.
    expect(batch[0]?.payloadHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('numbers items by their request position, which is the response order', () => {
    const batch = parsePushBatch({ changes: [item(), item(), item()] });
    expect(batch.map((entry) => entry.index)).toEqual([0, 1, 2]);
  });
});
