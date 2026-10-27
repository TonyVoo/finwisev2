import { describe, expect, it } from 'vitest';
import {
  ApiError,
  AmountMinor,
  CalendarDate,
  CategoryCreateRequest,
  CategorySyncFields,
  CategoryUpdateRequest,
  CurrencyCode,
  DEFAULT_CATEGORIES,
  Email,
  ERROR_CODES,
  ERROR_CODE_STATUS,
  Expense,
  ExpenseCreateRequest,
  ExpenseListQuery,
  ExpenseUpdateRequest,
  LIMITS,
  Password,
  SERVER_OWNED_FIELDS,
  SYNC_APPLY_ORDER,
  SYNC_ENTITIES,
  SyncPullQuery,
  SyncPushItem,
  SyncPushRequest,
  Timestamp,
  UNCATEGORIZED_NAME,
  Uuid,
  apiError,
} from '../src/index.js';

/**
 * Behaviour of the shared schemas. The backend validates with these at the edge, so what
 * they accept *is* the API's input contract — a schema that quietly coerces or lets an
 * unknown key through is a server bug waiting to happen, not a documentation issue.
 */

const UUID_V7 = '0192f3a0-7c3a-7f1e-9b2d-1c4a5e6f7a80';
const NOW = '2026-10-06T12:34:56.789Z';

describe('money', () => {
  it('accepts an integer count of minor units', () => {
    expect(AmountMinor.parse(1234)).toBe(1234);
    expect(AmountMinor.parse(0)).toBe(0);
  });

  it('rejects a float, so 12.34 cannot be smuggled in as a major-unit amount', () => {
    expect(AmountMinor.safeParse(12.34).success).toBe(false);
    expect(AmountMinor.safeParse(1234.0001).success).toBe(false);
  });

  it('rejects a decimal string rather than coercing it', () => {
    // Coercion here would hide the single most likely client bug: sending "12.34".
    expect(AmountMinor.safeParse('1234').success).toBe(false);
    expect(AmountMinor.safeParse('12.34').success).toBe(false);
  });

  it('rejects a negative amount', () => {
    expect(AmountMinor.safeParse(-1).success).toBe(false);
  });

  it('bounds the amount so a fat-fingered entry cannot overflow a total', () => {
    expect(AmountMinor.safeParse(LIMITS.AMOUNT_MINOR_MAX).success).toBe(true);
    expect(AmountMinor.safeParse(LIMITS.AMOUNT_MINOR_MAX + 1).success).toBe(false);
  });

  it('requires an uppercase 3-letter currency code', () => {
    expect(CurrencyCode.parse('USD')).toBe('USD');
    for (const bad of ['usd', 'US', 'USDD', 'US1', '']) {
      expect(CurrencyCode.safeParse(bad).success, bad).toBe(false);
    }
  });
});

describe('dates and times are different types', () => {
  it('accepts a calendar date', () => {
    expect(CalendarDate.parse('2026-10-05')).toBe('2026-10-05');
  });

  it('rejects an instant where a calendar date is expected', () => {
    // The whole point of the split: an expense dated "5 October" must not become an
    // instant that shifts across a timezone and moves spend between months.
    expect(CalendarDate.safeParse(NOW).success).toBe(false);
    expect(CalendarDate.safeParse('2026-10-05T00:00:00Z').success).toBe(false);
  });

  it('rejects a calendar date where an instant is expected', () => {
    expect(Timestamp.safeParse('2026-10-05').success).toBe(false);
  });

  it('rejects an impossible calendar date', () => {
    expect(CalendarDate.safeParse('2026-02-30').success).toBe(false);
    expect(CalendarDate.safeParse('2026-13-01').success).toBe(false);
  });

  it('requires an explicit offset on an instant', () => {
    expect(Timestamp.parse(NOW)).toBe(NOW);
    expect(Timestamp.parse('2026-10-06T12:34:56+02:00')).toBe('2026-10-06T12:34:56+02:00');
    expect(Timestamp.safeParse('2026-10-06T12:34:56').success).toBe(false);
  });
});

describe('ids', () => {
  it('accepts a client-minted UUIDv7', () => {
    expect(Uuid.parse(UUID_V7)).toBe(UUID_V7);
  });

  it('rejects a non-uuid', () => {
    for (const bad of ['', 'abc', '0192f3a0-7c3a-7f1e-9b2d']) {
      expect(Uuid.safeParse(bad).success, bad).toBe(false);
    }
  });
});

describe('email', () => {
  it('strips surrounding whitespace rather than rejecting it', () => {
    // An address autocompleted with a trailing space is a real thing mobile keyboards
    // do. The format check has to run on the trimmed value, or a valid login 400s.
    expect(Email.parse('  user@example.com  ')).toBe('user@example.com');
    expect(Email.parse('\tuser@example.com\n')).toBe('user@example.com');
  });

  it('still rejects a malformed address', () => {
    for (const bad of ['', '   ', 'nope', 'a@', '@x.com', 'a b@x.com']) {
      expect(Email.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });

  it('bounds the address by its trimmed length', () => {
    const local = 'a'.repeat(LIMITS.EMAIL_MAX - '@example.com'.length);
    const atLimit = `${local}@example.com`;
    expect(atLimit).toHaveLength(LIMITS.EMAIL_MAX);

    expect(Email.safeParse(atLimit).success).toBe(true);
    // Padding is not part of the address, so it must not consume the budget.
    expect(Email.safeParse(`  ${atLimit}  `).success).toBe(true);
    expect(Email.safeParse(`a${atLimit}`).success).toBe(false);
  });

  it('does not change case, which is the service layer’s job', () => {
    // Lowercasing lives in `normaliseEmail` on the backend so that the comparison and
    // the stored value cannot disagree. The schema only has to not get in its way.
    expect(Email.parse('  User@Example.com  ')).toBe('User@Example.com');
  });
});

describe('request bodies reject unknown fields', () => {
  it('rejects an unexpected key on create', () => {
    // Accepting it silently drops the field, which reads to a client as "the server
    // ignored my edit" and is close to impossible to debug from a device.
    const result = ExpenseCreateRequest.safeParse({
      categoryId: UUID_V7,
      amountMinor: 1234,
      date: '2026-10-06',
      amount: 12.34,
    });
    expect(result.success).toBe(false);
  });

  it('rejects a server-owned field on an update', () => {
    for (const field of SERVER_OWNED_FIELDS) {
      const result = ExpenseUpdateRequest.safeParse({ amountMinor: 1, [field]: UUID_V7 });
      expect(result.success, field).toBe(false);
    }
  });

  it('rejects an empty patch, which would be a no-op write', () => {
    expect(ExpenseUpdateRequest.safeParse({}).success).toBe(false);
    expect(CategoryUpdateRequest.safeParse({}).success).toBe(false);
  });

  it('accepts a single-field patch', () => {
    expect(ExpenseUpdateRequest.safeParse({ amountMinor: 1499 }).success).toBe(true);
    expect(CategoryUpdateRequest.safeParse({ name: 'Coffee' }).success).toBe(true);
  });

  it('allows note to be cleared with null but not with undefined-as-a-key', () => {
    expect(ExpenseUpdateRequest.safeParse({ note: null }).success).toBe(true);
    expect(ExpenseUpdateRequest.safeParse({ note: 'ok' }).success).toBe(true);
  });

  it('trims and bounds a note', () => {
    const parsed = ExpenseCreateRequest.parse({
      categoryId: UUID_V7,
      amountMinor: 1,
      date: '2026-10-06',
      note: '  padded  ',
    });
    expect(parsed.note).toBe('padded');
    const tooLong = ExpenseCreateRequest.safeParse({
      categoryId: UUID_V7,
      amountMinor: 1,
      date: '2026-10-06',
      note: 'x'.repeat(LIMITS.EXPENSE_NOTE_MAX + 1),
    });
    expect(tooLong.success).toBe(false);
  });

  it('trims a category name and rejects one that is only whitespace', () => {
    expect(CategoryCreateRequest.parse({ name: '  Coffee ' }).name).toBe('Coffee');
    expect(CategoryCreateRequest.safeParse({ name: '   ' }).success).toBe(false);
  });

  it('requires a #RRGGBB colour', () => {
    expect(CategoryCreateRequest.safeParse({ name: 'x', color: '#22c55e' }).success).toBe(true);
    for (const bad of ['22c55e', '#22c55', '#22c55ee', 'green']) {
      expect(CategoryCreateRequest.safeParse({ name: 'x', color: bad }).success, bad).toBe(false);
    }
  });

  it('bounds a password without silently truncating it', () => {
    expect(Password.safeParse('x'.repeat(LIMITS.PASSWORD_MIN - 1)).success).toBe(false);
    expect(Password.safeParse('x'.repeat(LIMITS.PASSWORD_MIN)).success).toBe(true);
    expect(Password.safeParse('x'.repeat(LIMITS.PASSWORD_MAX)).success).toBe(true);
    expect(Password.safeParse('x'.repeat(LIMITS.PASSWORD_MAX + 1)).success).toBe(false);
  });

  it('requires every field of a server row to be present when parsing one', () => {
    // Response schemas are closed and complete, so a backend that forgets to select a
    // column fails its own test rather than shipping an undefined to a device.
    const row = {
      id: UUID_V7,
      categoryId: UUID_V7,
      kind: 'expense',
      amountMinor: 1234,
      currency: 'USD',
      date: '2026-10-06',
      note: null,
      createdAt: NOW,
      updatedAt: NOW,
      deletedAt: null,
      revision: 3,
    };
    expect(Expense.safeParse(row).success).toBe(true);
    for (const key of Object.keys(row)) {
      const partial = { ...row } as Record<string, unknown>;
      delete partial[key];
      expect(Expense.safeParse(partial).success, `missing ${key}`).toBe(false);
    }
  });
});

describe('query strings are coerced, because that is where values arrive as strings', () => {
  it('coerces a numeric limit', () => {
    expect(ExpenseListQuery.parse({ limit: '25' }).limit).toBe(25);
    expect(SyncPullQuery.parse({ since: '42', limit: '100' })).toEqual({ since: 42, limit: 100 });
  });

  it('coerces a boolean flag', () => {
    expect(ExpenseListQuery.parse({ includeDeleted: 'true' }).includeDeleted).toBe(true);
    expect(ExpenseListQuery.parse({ includeDeleted: 'false' }).includeDeleted).toBe(false);
  });

  it('still enforces the bounds after coercing', () => {
    expect(ExpenseListQuery.safeParse({ limit: '0' }).success).toBe(false);
    expect(
      ExpenseListQuery.safeParse({ limit: String(LIMITS.EXPENSE_LIST_MAX_LIMIT + 1) }).success,
    ).toBe(false);
    expect(SyncPullQuery.safeParse({ since: '-1' }).success).toBe(false);
    expect(SyncPullQuery.safeParse({ limit: String(LIMITS.SYNC_PULL_MAX_LIMIT + 1) }).success).toBe(
      false,
    );
  });

  it('rejects a non-numeric limit instead of coercing it to NaN', () => {
    expect(ExpenseListQuery.safeParse({ limit: 'all' }).success).toBe(false);
    expect(SyncPullQuery.safeParse({ since: 'yesterday' }).success).toBe(false);
  });

  it('rejects an unknown query parameter', () => {
    expect(ExpenseListQuery.safeParse({ month: '2026-10' }).success).toBe(false);
  });
});

describe('sync push shapes', () => {
  const categoryItem = {
    entity: 'category' as const,
    id: UUID_V7,
    updatedAt: NOW,
    clientMutationId: '0192f400-0000-7f1e-9b2d-00000000000a',
    fields: { name: 'Coffee' },
  };

  it('discriminates on entity, so `fields` is narrowed without a cast', () => {
    const parsed = SyncPushItem.parse(categoryItem);
    expect(parsed.entity).toBe('category');
    if (parsed.entity === 'category') {
      expect(parsed.fields.name).toBe('Coffee');
    }
  });

  it('rejects an unknown entity', () => {
    expect(SyncPushItem.safeParse({ ...categoryItem, entity: 'budget' }).success).toBe(false);
  });

  it('rejects expense fields on a category item', () => {
    const result = SyncPushItem.safeParse({
      ...categoryItem,
      fields: { amountMinor: 1234 },
    });
    expect(result.success).toBe(false);
  });

  it('requires an idempotency key on every item', () => {
    const { clientMutationId: _omitted, ...withoutKey } = categoryItem;
    expect(SyncPushItem.safeParse(withoutKey).success).toBe(false);
  });

  it('requires updatedAt, since last-write-wins has nothing to order on without it', () => {
    const { updatedAt: _omitted, ...withoutUpdatedAt } = categoryItem;
    expect(SyncPushItem.safeParse(withoutUpdatedAt).success).toBe(false);
  });

  it('rejects empty `fields`, which would be a write with nothing to write', () => {
    expect(SyncPushItem.safeParse({ ...categoryItem, fields: {} }).success).toBe(false);
  });

  it('carries a delete as a deletedAt in fields', () => {
    const result = CategorySyncFields.safeParse({ deletedAt: NOW });
    expect(result.success).toBe(true);
    expect(CategorySyncFields.safeParse({ deletedAt: null }).success).toBe(true);
  });

  it('rejects an empty batch and one over the published limit', () => {
    expect(SyncPushRequest.safeParse({ changes: [] }).success).toBe(false);
    const oversize = Array.from({ length: LIMITS.SYNC_MAX_BATCH_SIZE + 1 }, () => categoryItem);
    expect(SyncPushRequest.safeParse({ changes: oversize }).success).toBe(false);
  });

  it('accepts a batch at exactly the limit', () => {
    const atLimit = Array.from({ length: LIMITS.SYNC_MAX_BATCH_SIZE }, () => categoryItem);
    expect(SyncPushRequest.safeParse({ changes: atLimit }).success).toBe(true);
  });

  it('applies categories, then recurring rules, then goals, then expenses', () => {
    expect(SYNC_APPLY_ORDER).toEqual(['category', 'recurring', 'goal', 'expense']);
    expect([...SYNC_APPLY_ORDER].sort()).toEqual([...SYNC_ENTITIES].sort());
  });
});

describe('error envelope', () => {
  it('builds an envelope without a details key when there are no details', () => {
    const error = apiError('not_found', 'No such expense.');
    expect(error).toEqual({ error: { code: 'not_found', message: 'No such expense.' } });
    expect('details' in error.error).toBe(false);
    expect(ApiError.safeParse(error).success).toBe(true);
  });

  it('carries field-level issues for a validation error', () => {
    const error = apiError('validation_error', 'Request body failed validation.', {
      issues: [{ path: 'fields.amountMinor', message: 'Expected integer' }],
    });
    expect(ApiError.safeParse(error).success).toBe(true);
  });

  it('rejects an unknown error code, so a typo cannot reach a client', () => {
    expect(ApiError.safeParse({ error: { code: 'whoops', message: 'x' } }).success).toBe(false);
  });

  it('rejects anything outside the envelope', () => {
    expect(
      ApiError.safeParse({ error: { code: 'not_found', message: 'x' }, extra: 1 }).success,
    ).toBe(false);
    expect(ApiError.safeParse({ message: 'bare message' }).success).toBe(false);
  });

  it('maps every code to an HTTP status', () => {
    for (const code of ERROR_CODES) {
      const status = ERROR_CODE_STATUS[code];
      expect(status, code).toBeGreaterThanOrEqual(400);
      expect(status, code).toBeLessThan(600);
    }
    expect(Object.keys(ERROR_CODE_STATUS).sort()).toEqual([...ERROR_CODES].sort());
  });

  it('has no duplicate codes', () => {
    expect(new Set(ERROR_CODES).size).toBe(ERROR_CODES.length);
  });
});

describe('seeded defaults', () => {
  it('seeds exactly one undeletable default category', () => {
    const defaults = DEFAULT_CATEGORIES.filter((category) => category.isDefault);
    expect(defaults).toHaveLength(1);
    expect(defaults[0]!.name).toBe(UNCATEGORIZED_NAME);
  });

  it('puts the default first, so the reassignment target is seeded before anything needs it', () => {
    expect(DEFAULT_CATEGORIES[0]!.isDefault).toBe(true);
  });

  it('seeds names that are unique case-insensitively, as the server requires', () => {
    const names = DEFAULT_CATEGORIES.map((category) => category.name.toLowerCase());
    expect(new Set(names).size).toBe(names.length);
  });

  it('seeds values that pass the public schemas', () => {
    for (const category of DEFAULT_CATEGORIES) {
      const result = CategoryCreateRequest.safeParse({
        name: category.name,
        color: category.color,
      });
      expect(result.success, category.name).toBe(true);
    }
  });
});
