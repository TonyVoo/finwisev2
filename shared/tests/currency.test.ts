import { describe, expect, it } from 'vitest';
import {
  API_ROUTES,
  ERROR_CODES,
  ERROR_CODE_STATUS,
  ExchangeRate,
  Expense,
  ExpenseCreateRequest,
  ExpenseSyncFields,
  ExpenseUpdateRequest,
  RatesQuery,
  RatesResponse,
} from '../src/index.js';

/**
 * Foreign-currency expenses. `amountMinor` stays the amount in the account's own currency,
 * which is what every total, budget and chart sums, so nothing downstream changes. A foreign
 * expense additionally carries what was actually paid: `originalAmountMinor` in
 * `originalCurrency`. The two travel together or not at all.
 */

const UUID_V7 = '0192f3a0-7c3a-7f1e-9b2d-1c4a5e6f7a80';
const NOW = '2026-10-06T12:34:56.789Z';

const row = {
  id: UUID_V7,
  categoryId: UUID_V7,
  kind: 'expense',
  amountMinor: 1082,
  currency: 'USD',
  originalAmountMinor: 1000,
  originalCurrency: 'EUR',
  date: '2026-10-06',
  note: null,
  private: false,
  createdBy: UUID_V7,
  paidBy: null,
  createdAt: NOW,
  updatedAt: NOW,
  deletedAt: null,
  revision: 3,
};

describe('the original amount on an expense row', () => {
  it('accepts a foreign expense and a home-currency one', () => {
    expect(Expense.safeParse(row).success).toBe(true);
    expect(
      Expense.safeParse({ ...row, originalAmountMinor: null, originalCurrency: null }).success,
    ).toBe(true);
  });

  it('requires both fields to be present on a server row, even when null', () => {
    const { originalAmountMinor: _a, ...withoutAmount } = row;
    const { originalCurrency: _c, ...withoutCurrency } = row;
    expect(Expense.safeParse(withoutAmount).success).toBe(false);
    expect(Expense.safeParse(withoutCurrency).success).toBe(false);
  });

  it('refuses a fractional or negative original amount, and a lowercase currency', () => {
    expect(Expense.safeParse({ ...row, originalAmountMinor: 10.5 }).success).toBe(false);
    expect(Expense.safeParse({ ...row, originalAmountMinor: -1 }).success).toBe(false);
    expect(Expense.safeParse({ ...row, originalCurrency: 'eur' }).success).toBe(false);
  });
});

describe.each([
  ['create', ExpenseCreateRequest, { categoryId: UUID_V7, amountMinor: 1082, date: '2026-10-06' }],
  ['push fields', ExpenseSyncFields, { amountMinor: 1082 }],
  ['update', ExpenseUpdateRequest, { amountMinor: 1082 }],
] as const)('the original amount in a %s', (_name, schema, base) => {
  it('takes both fields together', () => {
    expect(
      schema.safeParse({ ...base, originalAmountMinor: 1000, originalCurrency: 'EUR' }).success,
    ).toBe(true);
  });

  it('takes both as null, which clears them', () => {
    expect(
      schema.safeParse({ ...base, originalAmountMinor: null, originalCurrency: null }).success,
    ).toBe(true);
  });

  it('takes neither', () => {
    expect(schema.safeParse(base).success).toBe(true);
  });

  it('refuses one without the other', () => {
    expect(schema.safeParse({ ...base, originalAmountMinor: 1000 }).success).toBe(false);
    expect(schema.safeParse({ ...base, originalCurrency: 'EUR' }).success).toBe(false);
  });

  it('refuses an amount with no currency and a currency with no amount, even as null', () => {
    expect(
      schema.safeParse({ ...base, originalAmountMinor: 1000, originalCurrency: null }).success,
    ).toBe(false);
    expect(
      schema.safeParse({ ...base, originalAmountMinor: null, originalCurrency: 'EUR' }).success,
    ).toBe(false);
  });
});

describe('exchange rates', () => {
  it('queries a pair, with an optional day', () => {
    expect(RatesQuery.safeParse({ from: 'EUR', to: 'USD' }).success).toBe(true);
    expect(RatesQuery.safeParse({ from: 'EUR', to: 'USD', date: '2026-10-06' }).success).toBe(true);
  });

  it('refuses a malformed pair or day, and an unknown key', () => {
    expect(RatesQuery.safeParse({ from: 'eur', to: 'USD' }).success).toBe(false);
    expect(RatesQuery.safeParse({ from: 'EUR' }).success).toBe(false);
    expect(RatesQuery.safeParse({ from: 'EUR', to: 'USD', date: '2026-13-01' }).success).toBe(
      false,
    );
    expect(RatesQuery.safeParse({ from: 'EUR', to: 'USD', extra: 1 }).success).toBe(false);
  });

  it('carries the rate as a decimal string, never a float', () => {
    const rate = { from: 'EUR', to: 'USD', date: '2026-10-06', rate: '1.0823' };
    expect(ExchangeRate.safeParse(rate).success).toBe(true);
    expect(RatesResponse.safeParse({ data: rate }).success).toBe(true);
    expect(ExchangeRate.safeParse({ ...rate, rate: 1.0823 }).success).toBe(false);
    expect(ExchangeRate.safeParse({ ...rate, rate: '0' }).success).toBe(false);
    expect(ExchangeRate.safeParse({ ...rate, rate: '1e-7' }).success).toBe(false);
    expect(ExchangeRate.safeParse({ ...rate, rate: '-1.5' }).success).toBe(false);
  });

  it('has a route and an error code for a provider that cannot be reached', () => {
    expect(API_ROUTES.some((r) => r.operationId === 'getRate' && r.path === '/v1/rates')).toBe(
      true,
    );
    expect(ERROR_CODES).toContain('rates_unavailable');
    expect(ERROR_CODE_STATUS.rates_unavailable).toBe(502);
  });
});
