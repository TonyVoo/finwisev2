import { LIMITS } from '@expense-tracker/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { logger } from '../src/logger.ts';
import {
  setRecapReaderForTests,
  type RecapInput,
  type RecapReader,
} from '../src/services/recapReader.ts';
import { ReaderQuotaError } from '../src/services/receiptReader.ts';
import { api } from './support/api.ts';
import { createUser } from './support/fixtures.ts';

/**
 * `POST /v1/recap`: reword a month's insight sentences into a short recap (`docs/design/16-monthly-insights.md`).
 * The model is faked (`RecapReader`), so every case is about what the server does with what comes back and,
 * as importantly, what it refuses to keep or to say.
 */

const FACTS = [
  'You have spent 12% more than in September.',
  'Groceries is your biggest category, at 24% of the month.',
  "You have used 87% of Eating out's budget with 9 days left.",
];
const BODY = { month: '2026-10', language: 'en', facts: FACTS };
const GOOD = 'October was heavier than September, with groceries leading at 24%.';

const recap = (auth: string, body: Record<string, unknown> = BODY) =>
  api().post('/v1/recap').set('Authorization', auth).send(body);

function model(result: () => unknown): RecapReader & { calls: RecapInput[] } {
  const reader = {
    calls: [] as RecapInput[],
    async writeRecap(input: RecapInput) {
      reader.calls.push(input);
      return result();
    },
  };
  return reader;
}

afterEach(() => setRecapReaderForTests(null));

describe('POST /v1/recap', () => {
  it('requires authentication', async () => {
    const response = await api().post('/v1/recap').send(BODY);
    expect(response.status).toBe(401);
  });

  it('answers the recap the model wrote', async () => {
    setRecapReaderForTests(model(() => ({ text: GOOD })));
    const user = await createUser();

    const response = await recap(user.auth);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ data: { text: GOOD } });
  });

  it('hands the model the month in words, the language and the facts, and nothing else', async () => {
    const reader = model(() => ({ text: GOOD }));
    setRecapReaderForTests(reader);
    const user = await createUser();

    await recap(user.auth, { ...BODY, language: 'vi' });

    expect(reader.calls).toEqual([
      { monthLabel: 'tháng 10 năm 2026', language: 'vi', facts: FACTS },
    ]);
  });

  it('trims the facts before they reach the model', async () => {
    const reader = model(() => ({ text: GOOD }));
    setRecapReaderForTests(reader);
    const user = await createUser();

    await recap(user.auth, { ...BODY, facts: ['  Groceries is up 24%.  '] });

    expect(reader.calls[0]!.facts).toEqual(['Groceries is up 24%.']);
  });

  describe('what it refuses before spending a model call', () => {
    it.each([
      ['no facts', { ...BODY, facts: [] }],
      ['no facts field', { month: '2026-10', language: 'en' }],
      [
        'too many facts',
        { ...BODY, facts: Array.from({ length: LIMITS.RECAP_MAX_FACTS + 1 }, () => 'A fact.') },
      ],
      ['a fact that is blank', { ...BODY, facts: ['   '] }],
      ['a fact over the limit', { ...BODY, facts: ['x'.repeat(LIMITS.RECAP_FACT_MAX + 1)] }],
      ['a fact that is not text', { ...BODY, facts: [24] }],
      ['a month in the wrong form', { ...BODY, month: '2026-1' }],
      ['a month that does not exist', { ...BODY, month: '2026-13' }],
      ['an unknown language', { ...BODY, language: 'fr' }],
      ['an unknown field', { ...BODY, extra: 1 }],
    ])('is a validation error for %s', async (_name, body) => {
      const reader = model(() => ({ text: GOOD }));
      setRecapReaderForTests(reader);
      const user = await createUser();

      const response = await recap(user.auth, body);

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('validation_error');
      expect(reader.calls).toHaveLength(0);
    });
  });

  describe('what it refuses to pass on', () => {
    it.each([
      ['a number the facts do not contain', { text: 'Spending was up 15%.' }],
      ['a link', { text: 'See https://example.com for more.' }],
      ['markdown', { text: '**October** was heavier, at 24%.' }],
      ['an empty text', { text: '  ' }],
      ['a text over 500 characters', { text: 'a'.repeat(501) }],
      ['an answer that is not an object', 'October was heavier.'],
      ['an answer with no text', {}],
    ])('is 502 recap_failed for %s', async (_name, answer) => {
      setRecapReaderForTests(model(() => answer));
      const user = await createUser();

      const response = await recap(user.auth);

      expect(response.status).toBe(502);
      expect(response.body.error.code).toBe('recap_failed');
    });
  });

  describe('when the model cannot be used', () => {
    it('is 503 recap_unavailable when no model is configured', async () => {
      setRecapReaderForTests(null);
      const user = await createUser();

      const response = await recap(user.auth);

      expect(response.status).toBe(503);
      expect(response.body.error.code).toBe('recap_unavailable');
    });

    it('is 503 recap_unavailable once the day’s budget is spent, without calling the model', async () => {
      const reader = model(() => ({ text: GOOD }));
      setRecapReaderForTests(reader, 1);
      const user = await createUser();

      expect((await recap(user.auth)).status).toBe(200);
      const second = await recap(user.auth);

      expect(second.status).toBe(503);
      expect(second.body.error.code).toBe('recap_unavailable');
      expect(reader.calls).toHaveLength(1);
    });

    it('is 502 recap_failed when the model fails, without leaking what it said or what it was given', async () => {
      setRecapReaderForTests(
        model(() => {
          throw new Error('gemini key AIza-secret rejected for Groceries 24%');
        }),
      );
      const user = await createUser();

      const response = await recap(user.auth);

      expect(response.status).toBe(502);
      expect(response.body.error.code).toBe('recap_failed');
      const body = JSON.stringify(response.body);
      expect(body).not.toContain('AIza-secret');
      expect(body).not.toContain('Groceries');
    });

    it('stops asking the model for the day after a quota answer', async () => {
      const reader = model(() => {
        throw new ReaderQuotaError();
      });
      setRecapReaderForTests(reader, 100);
      const user = await createUser();

      expect((await recap(user.auth)).body.error.code).toBe('recap_failed');
      expect((await recap(user.auth)).body.error.code).toBe('recap_unavailable');
      expect(reader.calls).toHaveLength(1);
    });
  });

  it('throttles each account, and only that account', async () => {
    setRecapReaderForTests(
      model(() => ({ text: GOOD })),
      10_000,
    );
    const busy = await createUser();
    const other = await createUser();

    for (let attempt = 0; attempt < LIMITS.RECAP_MAX_PER_USER; attempt += 1) {
      expect((await recap(busy.auth)).status).toBe(200);
    }
    const limited = await recap(busy.auth);

    expect(limited.status).toBe(429);
    expect(limited.body.error.code).toBe('rate_limited');
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
    expect((await recap(other.auth)).status).toBe(200);
  });

  describe('what it logs', () => {
    it('says which strategy answered, and never the facts or the text', async () => {
      const info = vi.spyOn(logger, 'info');
      setRecapReaderForTests(model(() => ({ text: GOOD })));
      const user = await createUser();

      await recap(user.auth);

      const entry = info.mock.calls.find(([message]) => message === 'recap written');
      expect(entry?.[1]).toEqual({ userId: expect.any(String), strategy: 'model' });
      const logged = JSON.stringify(info.mock.calls);
      expect(logged).not.toContain('Groceries');
      expect(logged).not.toContain('heavier');
      info.mockRestore();
    });

    it.each([
      ["an adapter's own fixed message", 'recap model answered 503', 'recap model answered 503'],
      ['any other message, which could hold a key or a fact', 'AIza-secret Groceries', undefined],
    ])('logs why it failed: %s', async (_name, message, detail) => {
      const warn = vi.spyOn(logger, 'warn');
      setRecapReaderForTests(
        model(() => {
          throw new Error(message);
        }),
      );
      const user = await createUser();

      await recap(user.auth);

      const entry = warn.mock.calls.find(([text]) => text === 'recap failed');
      expect(entry?.[1]).toMatchObject({ reason: 'Error' });
      expect((entry?.[1] as { detail?: string }).detail).toBe(detail);
      expect(JSON.stringify(warn.mock.calls)).not.toContain('AIza-secret');
      warn.mockRestore();
    });
  });
});
