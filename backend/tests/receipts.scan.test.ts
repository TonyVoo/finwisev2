import { LIMITS } from '@expense-tracker/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { getPrisma } from '../src/db/client.ts';
import { setTextReaderForTests, type TextReader } from '../src/services/textReader.ts';
import { api } from './support/api.ts';
import { createUser } from './support/fixtures.ts';

/**
 * `POST /v1/receipts/scan`: read a receipt photo and suggest an amount, date, merchant and
 * category. The OCR provider is faked (`TextReader`), so every case is about what the server
 * does with the text that comes back - and, as importantly, what it refuses to keep.
 */

function jpeg(size = 64): Buffer {
  const bytes = Buffer.alloc(size, 7);
  bytes[0] = 0xff;
  bytes[1] = 0xd8;
  bytes[2] = 0xff;
  return bytes;
}

const scan = (auth: string, bytes: Buffer = jpeg()) =>
  api()
    .post('/v1/receipts/scan')
    .set('Authorization', auth)
    .send({ contentType: 'image/jpeg', dataBase64: bytes.toString('base64') });

function yesterday(): string {
  return new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function reading(text: string): TextReader & { calls: Uint8Array[] } {
  const calls: Uint8Array[] = [];
  return {
    calls,
    async readText(image) {
      calls.push(image);
      return text;
    },
  };
}

const RECEIPT = (date: string) =>
  ['FRESH SUPERMARKET', '12 High Street', `Date: ${date}`, 'Milk 2.50', 'TOTAL 6.50'].join('\n');

afterEach(() => setTextReaderForTests(undefined));

describe('POST /v1/receipts/scan', () => {
  it('requires authentication', async () => {
    const response = await api()
      .post('/v1/receipts/scan')
      .send({ contentType: 'image/jpeg', dataBase64: jpeg().toString('base64') });
    expect(response.status).toBe(401);
  });

  it('suggests the fields it found, in the account currency', async () => {
    setTextReaderForTests(reading(RECEIPT(yesterday())));
    const user = await createUser();

    const response = await scan(user.auth);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      data: {
        amountMinor: 650,
        currency: 'USD',
        date: yesterday(),
        merchant: 'FRESH SUPERMARKET',
        category: 'groceries',
      },
    });
  });

  it('reads amounts by the account currency, so a dong receipt is whole numbers', async () => {
    setTextReaderForTests(reading('Cua hang\nTong cong: 150.000'));
    const user = await createUser({ currency: 'VND' });

    const response = await scan(user.auth);

    expect(response.body.data).toMatchObject({ amountMinor: 150000, currency: 'VND' });
  });

  it('answers nulls, not an error, when nothing could be read', async () => {
    setTextReaderForTests(reading(''));
    const user = await createUser();

    const response = await scan(user.auth);

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({
      amountMinor: null,
      currency: 'USD',
      date: null,
      merchant: null,
      category: null,
    });
  });

  it('hands the reader exactly the bytes it was sent', async () => {
    const reader = reading(RECEIPT(yesterday()));
    setTextReaderForTests(reader);
    const user = await createUser();
    const bytes = jpeg(300);

    await scan(user.auth, bytes);

    expect(reader.calls).toHaveLength(1);
    expect(Buffer.from(reader.calls[0]!).equals(bytes)).toBe(true);
  });

  it('stores nothing: no receipt row, and no expense is created', async () => {
    setTextReaderForTests(reading(RECEIPT(yesterday())));
    const user = await createUser();
    const db = getPrisma();
    const before = {
      receipts: await db.expenseReceipt.count(),
      expenses: await db.expense.count(),
    };

    await scan(user.auth);

    expect(await db.expenseReceipt.count()).toBe(before.receipts);
    expect(await db.expense.count()).toBe(before.expenses);
  });

  it('rejects something that is not a JPEG, without calling the provider', async () => {
    const reader = reading('x');
    setTextReaderForTests(reader);
    const user = await createUser();

    const response = await scan(user.auth, Buffer.from('not an image at all'));

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('validation_error');
    expect(reader.calls).toHaveLength(0);
  });

  it('rejects an image over the size limit', async () => {
    setTextReaderForTests(reading('x'));
    const user = await createUser();

    const response = await scan(user.auth, jpeg(LIMITS.RECEIPT_MAX_BYTES + 1));

    expect(response.status).toBe(400);
  });

  it('is 503 ocr_unavailable when no reader is configured', async () => {
    setTextReaderForTests(null);
    const user = await createUser();

    const response = await scan(user.auth);

    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe('ocr_unavailable');
  });

  it('is 502 ocr_failed when the provider fails, without leaking what it said', async () => {
    setTextReaderForTests({
      async readText() {
        throw new Error('vision api key AIza-secret rejected');
      },
    });
    const user = await createUser();

    const response = await scan(user.auth);

    expect(response.status).toBe(502);
    expect(response.body.error.code).toBe('ocr_failed');
    expect(JSON.stringify(response.body)).not.toContain('AIza-secret');
  });

  it('throttles each account, and only that account', async () => {
    setTextReaderForTests(reading(''));
    const busy = await createUser();
    const other = await createUser();

    for (let attempt = 0; attempt < LIMITS.RECEIPT_SCAN_MAX_PER_USER; attempt += 1) {
      expect((await scan(busy.auth)).status).toBe(200);
    }
    const limited = await scan(busy.auth);

    expect(limited.status).toBe(429);
    expect(limited.body.error.code).toBe('rate_limited');
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
    expect((await scan(other.auth)).status).toBe(200);
  });
});
