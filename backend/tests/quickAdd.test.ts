import { LIMITS } from '@expense-tracker/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getPrisma } from '../src/db/client.ts';
import { logger } from '../src/logger.ts';
import { setQuickAddReaderForTests, type QuickAddReader } from '../src/services/quickAddReader.ts';
import { ReaderQuotaError } from '../src/services/receiptReader.ts';
import { api } from './support/api.ts';
import { createUser } from './support/fixtures.ts';

/**
 * `POST /v1/quick-add`: read a typed sentence and suggest an expense (`docs/design/15-quick-add.md`).
 * The model is faked (`QuickAddReader`), so every case is about what the server does with what comes
 * back, and, as importantly, what it refuses to keep or to say.
 */

const today = () => new Date().toISOString().slice(0, 10);
const yesterday = () => new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
const SENTENCE = 'coffee 4.50 yesterday';

const quickAdd = (
  auth: string,
  body: Record<string, unknown> = { text: SENTENCE, today: today() },
) => api().post('/v1/quick-add').set('Authorization', auth).send(body);

const answer = (overrides: Record<string, unknown> = {}) => ({
  kind: 'expense',
  amount: 4.5,
  date: yesterday(),
  dateAmbiguous: false,
  note: 'Coffee',
  category: 'eating_out',
  ...overrides,
});

function model(result: () => unknown): QuickAddReader & {
  calls: { text: string; context: { currency: string; today: string } }[];
} {
  const reader = {
    calls: [] as { text: string; context: { currency: string; today: string } }[],
    async readSentence(text: string, context: { currency: string; today: string }) {
      reader.calls.push({ text, context });
      return result();
    },
  };
  return reader;
}

afterEach(() => setQuickAddReaderForTests(null));

describe('POST /v1/quick-add', () => {
  it('requires authentication', async () => {
    const response = await api().post('/v1/quick-add').send({ text: SENTENCE, today: today() });
    expect(response.status).toBe(401);
  });

  it('suggests what the model understood, in the account currency', async () => {
    setQuickAddReaderForTests(model(() => answer()));
    const user = await createUser();

    const response = await quickAdd(user.auth);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      data: {
        type: 'expense',
        amountMinor: 450,
        currency: 'USD',
        date: yesterday(),
        note: 'Coffee',
        category: 'eating_out',
      },
    });
  });

  it('hands the model the sentence, the account currency and the phone’s today, and nothing else', async () => {
    const reader = model(() => answer({ amount: 45000 }));
    setQuickAddReaderForTests(reader);
    const user = await createUser({ currency: 'VND' });

    const response = await quickAdd(user.auth, { text: 'cà phê 45k', today: today() });

    expect(reader.calls).toEqual([
      { text: 'cà phê 45k', context: { currency: 'VND', today: today() } },
    ]);
    expect(response.body.data).toMatchObject({ amountMinor: 45000, currency: 'VND' });
  });

  it('answers nulls, not an error, when the model found nothing', async () => {
    setQuickAddReaderForTests(model(() => ({})));
    const user = await createUser();

    const response = await quickAdd(user.auth);

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({
      type: null,
      amountMinor: null,
      currency: 'USD',
      date: null,
      note: null,
      category: null,
    });
  });

  it('stores nothing: no expense is created', async () => {
    setQuickAddReaderForTests(model(() => answer()));
    const user = await createUser();
    const before = await getPrisma().expense.count();

    await quickAdd(user.auth);

    expect(await getPrisma().expense.count()).toBe(before);
  });

  describe('what it refuses before spending a model call', () => {
    it.each([
      ['no text', { today: today() }],
      ['empty text', { text: '', today: today() }],
      ['blank text', { text: '    ', today: today() }],
      ['text over the limit', { text: 'x'.repeat(LIMITS.QUICK_ADD_TEXT_MAX + 1), today: today() }],
      ['no date', { text: SENTENCE }],
      ['a date in the wrong form', { text: SENTENCE, today: '02/11/2026' }],
      ['an unknown field', { text: SENTENCE, today: today(), extra: 1 }],
      [
        'a today more than a day from the server’s',
        { text: SENTENCE, today: new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10) },
      ],
    ])('is a validation error for %s', async (_name, body) => {
      const reader = model(() => answer());
      setQuickAddReaderForTests(reader);
      const user = await createUser();

      const response = await quickAdd(user.auth, body);

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('validation_error');
      expect(reader.calls).toHaveLength(0);
    });

    it('accepts a today a day either side, which a time zone can cause', async () => {
      setQuickAddReaderForTests(model(() => answer()));
      const user = await createUser();
      const ahead = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
      const behind = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

      expect((await quickAdd(user.auth, { text: SENTENCE, today: ahead })).status).toBe(200);
      expect((await quickAdd(user.auth, { text: SENTENCE, today: behind })).status).toBe(200);
    });
  });

  describe('when the model cannot be used', () => {
    it('is 503 quick_add_unavailable when no model is configured', async () => {
      setQuickAddReaderForTests(null);
      const user = await createUser();

      const response = await quickAdd(user.auth);

      expect(response.status).toBe(503);
      expect(response.body.error.code).toBe('quick_add_unavailable');
    });

    it('is 503 quick_add_unavailable once the day’s budget is spent, without calling the model', async () => {
      const reader = model(() => answer());
      setQuickAddReaderForTests(reader, 1);
      const user = await createUser();

      expect((await quickAdd(user.auth)).status).toBe(200);
      const second = await quickAdd(user.auth);

      expect(second.status).toBe(503);
      expect(second.body.error.code).toBe('quick_add_unavailable');
      expect(reader.calls).toHaveLength(1);
    });

    it('is 502 quick_add_failed when the model fails, without leaking what it said', async () => {
      setQuickAddReaderForTests(
        model(() => {
          throw new Error('gemini key AIza-secret rejected for coffee 4.50 yesterday');
        }),
      );
      const user = await createUser();

      const response = await quickAdd(user.auth);

      expect(response.status).toBe(502);
      expect(response.body.error.code).toBe('quick_add_failed');
      const body = JSON.stringify(response.body);
      expect(body).not.toContain('AIza-secret');
      expect(body).not.toContain('coffee');
    });

    it('is 502 quick_add_failed when the model answers off-shape', async () => {
      setQuickAddReaderForTests(model(() => ({ amount: 'lots' })));
      const user = await createUser();

      expect((await quickAdd(user.auth)).body.error.code).toBe('quick_add_failed');
    });

    it('stops asking the model for the day after a quota answer', async () => {
      const reader = model(() => {
        throw new ReaderQuotaError();
      });
      setQuickAddReaderForTests(reader, 100);
      const user = await createUser();

      expect((await quickAdd(user.auth)).body.error.code).toBe('quick_add_failed');
      const second = await quickAdd(user.auth);

      expect(second.body.error.code).toBe('quick_add_unavailable');
      expect(reader.calls).toHaveLength(1);
    });
  });

  it('throttles each account, and only that account', async () => {
    setQuickAddReaderForTests(
      model(() => ({})),
      10_000,
    );
    const busy = await createUser();
    const other = await createUser();

    for (let attempt = 0; attempt < LIMITS.QUICK_ADD_MAX_PER_USER; attempt += 1) {
      expect((await quickAdd(busy.auth)).status).toBe(200);
    }
    const limited = await quickAdd(busy.auth);

    expect(limited.status).toBe(429);
    expect(limited.body.error.code).toBe('rate_limited');
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
    expect((await quickAdd(other.auth)).status).toBe(200);
  });

  describe('what it logs', () => {
    it('says which strategy answered, and never the sentence or the answer', async () => {
      const info = vi.spyOn(logger, 'info');
      setQuickAddReaderForTests(model(() => answer()));
      const user = await createUser();

      await quickAdd(user.auth);

      const entry = info.mock.calls.find(([message]) => message === 'quick add read');
      expect(entry?.[1]).toEqual({ userId: expect.any(String), strategy: 'model' });
      expect(JSON.stringify(info.mock.calls)).not.toContain('coffee');
      info.mockRestore();
    });

    it.each([
      [
        "an adapter's own fixed message",
        'quick add model answered 503',
        'quick add model answered 503',
      ],
      [
        'any other message, which could hold a key or the sentence',
        'AIza-secret coffee',
        undefined,
      ],
    ])('logs why it failed: %s', async (_name, message, detail) => {
      const warn = vi.spyOn(logger, 'warn');
      setQuickAddReaderForTests(
        model(() => {
          throw new Error(message);
        }),
      );
      const user = await createUser();

      await quickAdd(user.auth);

      const entry = warn.mock.calls.find(([text]) => text === 'quick add failed');
      expect(entry?.[1]).toMatchObject({ reason: 'Error' });
      expect((entry?.[1] as { detail?: string }).detail).toBe(detail);
      expect(JSON.stringify(warn.mock.calls)).not.toContain('AIza-secret');
      warn.mockRestore();
    });
  });
});
