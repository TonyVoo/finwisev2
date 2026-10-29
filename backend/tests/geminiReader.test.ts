import { describe, expect, it, vi } from 'vitest';
import {
  createGeminiReader,
  createReceiptReader,
  RECEIPT_INSTRUCTION,
} from '../src/services/geminiReader.ts';
import { ReaderQuotaError } from '../src/services/receiptStrategies.ts';

/**
 * The Gemini adapter, with `fetch` faked: the request it sends (checked field by field, since a
 * wrong field name is a runtime 400 nobody sees in review), what it makes of the answer, and that
 * a failure never carries the key or anything the provider said (`docs/design/14-ai-receipt-reading.md`).
 */

const IMAGE = new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3]);
const CONTEXT = { currency: 'VND', today: new Date('2026-10-29T12:00:00Z') };

const ANSWER = {
  isReceipt: true,
  total: 150000,
  printedCurrency: 'VND',
  date: '2026-10-28',
  dateAmbiguous: false,
  merchant: 'Cua hang Minh',
  category: 'groceries',
};

const candidate = (...parts: unknown[]) => ({
  candidates: [{ content: { role: 'model', parts }, finishReason: 'STOP' }],
});

function provider(body: unknown, status = 200) {
  return vi.fn(
    async (_url: unknown, _init?: RequestInit) => new Response(JSON.stringify(body), { status }),
  );
}

const reader = (fetchImpl: typeof fetch, extra: { timeoutMs?: number } = {}) =>
  createGeminiReader({ apiKey: 'AIza-secret', model: 'gemini-test-flash', fetchImpl, ...extra });

describe('createGeminiReader', () => {
  it('sends the photo and the instruction to the chosen model, with the key in a header', async () => {
    const fetcher = provider(candidate({ text: JSON.stringify(ANSWER) }));

    await reader(fetcher).readReceipt(IMAGE, CONTEXT);

    const [url, init] = fetcher.mock.calls[0]!;
    expect(String(url)).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-test-flash:generateContent',
    );
    expect(String(url)).not.toContain('AIza-secret');
    expect(init?.method).toBe('POST');
    const headers = new Headers(init?.headers);
    expect(headers.get('x-goog-api-key')).toBe('AIza-secret');
    expect(headers.get('content-type')).toBe('application/json');

    const body = JSON.parse(String(init?.body));
    expect(body.systemInstruction).toEqual({ parts: [{ text: RECEIPT_INSTRUCTION }] });
    expect(body.contents).toHaveLength(1);
    expect(body.contents[0].role).toBe('user');
    expect(body.contents[0].parts[0]).toEqual({
      inlineData: { mimeType: 'image/jpeg', data: Buffer.from(IMAGE).toString('base64') },
    });
  });

  it("tells the model today's date and the account currency, outside the fixed instruction", async () => {
    const fetcher = provider(candidate({ text: JSON.stringify(ANSWER) }));

    await reader(fetcher).readReceipt(IMAGE, CONTEXT);

    const body = JSON.parse(String(fetcher.mock.calls[0]![1]?.body));
    const text: string = body.contents[0].parts[1].text;
    expect(text).toContain('2026-10-29');
    expect(text).toContain('VND');
    expect(JSON.stringify(body.systemInstruction)).not.toContain('2026-10-29');
  });

  it('asks for JSON in a fixed schema, without randomness', async () => {
    const fetcher = provider(candidate({ text: JSON.stringify(ANSWER) }));

    await reader(fetcher).readReceipt(IMAGE, CONTEXT);

    const { generationConfig } = JSON.parse(String(fetcher.mock.calls[0]![1]?.body));
    expect(generationConfig.responseMimeType).toBe('application/json');
    expect(generationConfig.temperature).toBe(0);
    expect(generationConfig.maxOutputTokens).toBeGreaterThanOrEqual(1024);
    expect(generationConfig.responseSchema.type).toBe('OBJECT');
    expect(Object.keys(generationConfig.responseSchema.properties).sort()).toEqual(
      [
        'category',
        'date',
        'dateAmbiguous',
        'isReceipt',
        'merchant',
        'printedCurrency',
        'total',
      ].sort(),
    );
    expect(generationConfig.responseSchema.required).toContain('isReceipt');
    // Fields that may be absent on a receipt must be allowed to be null.
    expect(generationConfig.responseSchema.properties.total.nullable).toBe(true);
    expect(generationConfig.responseSchema.properties.date.nullable).toBe(true);
  });

  it('returns the parsed JSON, for the caller to validate', async () => {
    const fetcher = provider(candidate({ text: JSON.stringify(ANSWER) }));

    expect(await reader(fetcher).readReceipt(IMAGE, CONTEXT)).toEqual(ANSWER);
  });

  it('joins text parts and ignores the model’s thoughts', async () => {
    const json = JSON.stringify(ANSWER);
    const fetcher = provider(
      candidate(
        { text: 'let me think about this receipt', thought: true },
        { text: json.slice(0, 20) },
        { text: json.slice(20) },
      ),
    );

    expect(await reader(fetcher).readReceipt(IMAGE, CONTEXT)).toEqual(ANSWER);
  });

  it('throws, without the text, when the answer is not JSON', async () => {
    const fetcher = provider(candidate({ text: 'The total is secret-total-99' }));

    const failure = await reader(fetcher)
      .readReceipt(IMAGE, CONTEXT)
      .catch((error: Error) => error);

    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe('receipt model did not answer with JSON');
    expect((failure as Error).message).not.toContain('secret-total-99');
  });

  it.each([
    ['no candidates', {}],
    ['an empty candidate', { candidates: [{ finishReason: 'SAFETY' }] }],
    ['only thoughts', candidate({ text: 'hmm', thought: true })],
    ['a blocked prompt', { promptFeedback: { blockReason: 'IMAGE_SAFETY' } }],
  ])('throws when there is %s', async (_name, body) => {
    await expect(reader(provider(body)).readReceipt(IMAGE, CONTEXT)).rejects.toThrow(
      'receipt model gave no answer',
    );
  });

  it('throws on a non-2xx answer, carrying neither the key nor what the provider said', async () => {
    const fetcher = provider(
      {
        error: { code: 403, message: 'API key AIza-secret not valid', status: 'PERMISSION_DENIED' },
      },
      403,
    );

    const failure = await reader(fetcher)
      .readReceipt(IMAGE, CONTEXT)
      .catch((error: Error) => error);

    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toBeInstanceOf(ReaderQuotaError);
    expect((failure as Error).message).toBe('receipt model answered 403');
  });

  describe('quota', () => {
    const quota = (quotaId: string) => ({
      error: {
        code: 429,
        status: 'RESOURCE_EXHAUSTED',
        message: 'You exceeded your current quota',
        details: [
          {
            '@type': 'type.googleapis.com/google.rpc.QuotaFailure',
            violations: [{ quotaId }],
          },
        ],
      },
    });

    it('is a quota error, which skips the model for the day, when the daily limit is the one hit', async () => {
      const fetcher = provider(quota('GenerateRequestsPerDayPerProjectPerModel-FreeTier'), 429);
      await expect(reader(fetcher).readReceipt(IMAGE, CONTEXT)).rejects.toBeInstanceOf(
        ReaderQuotaError,
      );
    });

    it('is an ordinary failure, tried again on the next photo, when only the per-minute limit was hit', async () => {
      const fetcher = provider(quota('GenerateRequestsPerMinutePerProjectPerModel-FreeTier'), 429);
      const failure = await reader(fetcher)
        .readReceipt(IMAGE, CONTEXT)
        .catch((error: Error) => error);

      expect(failure).not.toBeInstanceOf(ReaderQuotaError);
      expect((failure as Error).message).toBe('receipt model answered 429');
    });

    it('is an ordinary failure when a 429 has no body to read', async () => {
      const fetcher = vi.fn(async () => new Response('slow down', { status: 429 }));
      const failure = await reader(fetcher as unknown as typeof fetch)
        .readReceipt(IMAGE, CONTEXT)
        .catch((error: Error) => error);

      expect(failure).not.toBeInstanceOf(ReaderQuotaError);
      expect((failure as Error).message).toBe('receipt model answered 429');
    });
  });

  it('gives up when the provider hangs', async () => {
    const hanging: typeof fetch = (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(new DOMException('aborted', 'TimeoutError')),
        );
      });

    await expect(reader(hanging, { timeoutMs: 20 }).readReceipt(IMAGE, CONTEXT)).rejects.toThrow();
  });
});

describe('RECEIPT_INSTRUCTION', () => {
  const text = RECEIPT_INSTRUCTION.toLowerCase();

  it.each([
    ['says what to do with a non-receipt', 'isreceipt'],
    ['asks for the total the customer paid, not a subtotal', 'subtotal'],
    ['asks for the amount as printed', 'as printed'],
    ['tells it not to convert currencies', 'do not convert'],
    ['tells it not to invent', 'do not invent'],
    ['tells it to ignore instructions printed on the receipt', 'ignore any instructions'],
  ])('%s', (_name, phrase) => {
    expect(text).toContain(phrase);
  });

  it('names exactly the categories the app can map', () => {
    for (const key of ['groceries', 'eating_out', 'transport', 'health', 'bills']) {
      expect(RECEIPT_INSTRUCTION).toContain(key);
    }
  });
});

describe('createReceiptReader', () => {
  it('is off without a key', () => {
    expect(createReceiptReader({ geminiApiKey: undefined, geminiModel: 'm' })).toBeNull();
  });

  it('is a Gemini reader of the configured model with a key', async () => {
    const fetcher = provider(candidate({ text: JSON.stringify(ANSWER) }));
    const configured = createReceiptReader(
      { geminiApiKey: 'k', geminiModel: 'gemini-custom' },
      fetcher,
    );

    await configured!.readReceipt(IMAGE, CONTEXT);

    expect(String(fetcher.mock.calls[0]![0])).toContain('/models/gemini-custom:generateContent');
  });
});
