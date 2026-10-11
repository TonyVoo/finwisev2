import { ExpenseResponse } from '@expense-tracker/shared';
import { describe, expect, it } from 'vitest';
import { api, TEST_PASSWORD, uniqueEmail } from './support/api.ts';
import { createUser } from './support/fixtures.ts';

/**
 * EDGE-13 — the currency the account is in, and what the system knows about it.
 *
 * `docs/qa/TEST_PLAN.md` §9. The server is deliberately exponent-agnostic: it stores
 * `amountMinor` verbatim and never scales, so "125" means ¥125 to a JPY account and $1.25
 * to a USD one. That half is already pinned by `expenses.test.ts` ("honours a non-USD
 * account currency").
 *
 * What is not pinned, and what these cases measure, is the gap between the three places
 * that have an opinion about which currencies exist:
 *
 * - `shared/src/primitives.ts` — `CurrencyCode` is `^[A-Z]{3}$`: 17,576 codes.
 * - `docs/design/03-auth.md` rule 8 — the signup Sheet offers a fixed list of **ten**.
 * - `docs/design/03-auth.md` rule 9 — `decimals` is "2 for all of the above except `JPY`".
 *
 * Rule 9 is correct for the ten (`mobile/tests/lib/currencyFormatting.test.ts`, EDGE-14)
 * and wrong for codes outside them in both directions. These cases establish whether the
 * server lets one through. See `GAP 21`.
 */

const signUpWith = async (currency: string) =>
  api().post('/v1/auth/signup').send({ email: uniqueEmail('cur'), password: TEST_PASSWORD, currency });

/**
 * Both resolutions of GAP 21 are acceptable and this helper accepts either, so the case
 * does not encode the branch it is arguing for. What it refuses is the third outcome: a
 * 500, or a 2xx that quietly stores something other than what was sent.
 */
const expectAcceptedOrRejected = (status: number, body: unknown): 'accepted' | 'rejected' => {
  if (status === 201) return 'accepted';
  expect(status).toBe(400);
  expect((body as { error: { code: string } }).error.code).toBe('validation_error');
  return 'rejected';
};

describe('EDGE-13 — account currency outside the design’s fixed list', () => {
  it('accepts a three-decimal currency the signup Sheet never offers', async () => {
    // KWD has 3 decimals. If the server takes it, `decimals` per rule 9 is 2, and 1000
    // minor units (1.000 KWD) renders as "10.00" — ten times the real amount, on the one
    // screen the app exists to get right.
    const response = await signUpWith('KWD');

    if (expectAcceptedOrRejected(response.status, response.body) === 'accepted') {
      expect(response.body.user.currency).toBe('KWD');
    }
  });

  it('accepts ISO 4217’s own code for "no currency"', async () => {
    // `XXX` is defined by ISO 4217 to mean *no* currency. Nothing in the stack refuses it:
    // the regex admits it and `Intl` formats it with two digits without complaint.
    const response = await signUpWith('XXX');

    if (expectAcceptedOrRejected(response.status, response.body) === 'accepted') {
      expect(response.body.user.currency).toBe('XXX');
    }
  });

  it('accepts a code that is not a currency at all', async () => {
    const response = await signUpWith('ZZZ');

    if (expectAcceptedOrRejected(response.status, response.body) === 'accepted') {
      expect(response.body.user.currency).toBe('ZZZ');
    }
  });

  it('still enforces the shape of the code, whichever list it checks against', async () => {
    // This half is settled either way: a lowercase or wrong-length code is a
    // validation_error today, and narrowing to the ten keeps it one.
    for (const currency of ['usd', 'US', 'USDD', 'US1', '']) {
      const response = await signUpWith(currency);
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('validation_error');
    }
  });
});

describe('EDGE-13 — an expense in a zero-decimal account', () => {
  it('stores and returns whole minor units without scaling, and refuses a second currency', async () => {
    // The server-side guarantee the display bug cannot be blamed on: 125 in a JPY account
    // is ¥125. The scaling question is entirely the client's, which is why GAP 21 is a
    // client-and-contract gap and not a backend defect.
    const user = await createUser({ currency: 'JPY' });

    const created = await api().post('/v1/expenses').set('Authorization', user.auth).send({
      categoryId: user.defaultCategory.id,
      amountMinor: 125,
      date: '2026-10-06',
    });

    expect(created.status).toBe(201);
    expect(() => ExpenseResponse.parse(created.body)).not.toThrow();
    expect(created.body.data.amountMinor).toBe(125);
    expect(created.body.data.currency).toBe('JPY');

    // A JPY account cannot hold a USD row: there is no conversion in the MVP, so a mixed
    // currency would make the monthly total a sum of two different units.
    const foreign = await api().post('/v1/expenses').set('Authorization', user.auth).send({
      categoryId: user.defaultCategory.id,
      amountMinor: 125,
      currency: 'USD',
      date: '2026-10-06',
    });

    expect(foreign.status).toBe(400);
    expect(foreign.body.error.code).toBe('validation_error');
  });
});
