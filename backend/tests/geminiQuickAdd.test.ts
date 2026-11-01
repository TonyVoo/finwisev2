import { describe, expect, it, vi } from 'vitest';
import {
  createGeminiQuickAddReader,
  createQuickAddReader,
  QUICK_ADD_INSTRUCTION,
} from '../src/services/geminiReader.ts';
import { ReaderQuotaError } from '../src/services/receiptReader.ts';

/**
 * The Gemini adapter for typed sentences, with `fetch` faked: the request it sends, what it makes of
 * the answer, and that a failure never carries the key, the sentence or anything the provider said
 * (`docs/design/15-quick-add.md`). The plumbing is shared with the receipt reader, whose own tests
 * pin the same behaviours; here the point is what is different.
 */

const CONTEXT = { currency: 'VND', today: '2026-11-02' };
const SENTENCE = 'cà phê 45k hôm qua';

const ANSWER = {
  kind: 'expense',
  amount: 45000,
  date: '2026-11-01',
  dateAmbiguous: false,
  note: 'Cà phê',
  category: 'eating_out',
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
  createGeminiQuickAddReader({
    apiKey: 'AIza-secret',
    model: 'gemini-test-flash',
    fetchImpl,
    ...extra,
  });

describe('createGeminiQuickAddReader', () => {
  it('sends the sentence as text only, to the chosen model, with the key in a header', async () => {
    const fetcher = provider(candidate({ text: JSON.stringify(ANSWER) }));

    await reader(fetcher).readSentence(SENTENCE, CONTEXT);

    const [url, init] = fetcher.mock.calls[0]!;
    expect(String(url)).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-test-flash:generateContent',
    );
    expect(String(url)).not.toContain('AIza-secret');
    expect(new Headers(init?.headers).get('x-goog-api-key')).toBe('AIza-secret');

    const body = JSON.parse(String(init?.body));
    expect(body.systemInstruction).toEqual({ parts: [{ text: QUICK_ADD_INSTRUCTION }] });
    expect(body.contents).toHaveLength(1);
    expect(body.contents[0].parts).toHaveLength(1);
    expect(body.contents[0].parts[0]).not.toHaveProperty('inlineData');
  });

  it("puts today's date, the currency and the sentence in the user turn, the sentence quoted as data", async () => {
    const fetcher = provider(candidate({ text: JSON.stringify(ANSWER) }));

    await reader(fetcher).readSentence(SENTENCE, CONTEXT);

    const body = JSON.parse(String(fetcher.mock.calls[0]![1]?.body));
    const text: string = body.contents[0].parts[0].text;
    expect(text).toContain('2026-11-02');
    expect(text).toContain('VND');
    expect(text).toContain(JSON.stringify(SENTENCE));
    expect(JSON.stringify(body.systemInstruction)).not.toContain('2026-11-02');
    expect(JSON.stringify(body.systemInstruction)).not.toContain(SENTENCE);
  });

  it('asks for JSON in a fixed schema, without randomness', async () => {
    const fetcher = provider(candidate({ text: JSON.stringify(ANSWER) }));

    await reader(fetcher).readSentence(SENTENCE, CONTEXT);

    const { generationConfig } = JSON.parse(String(fetcher.mock.calls[0]![1]?.body));
    expect(generationConfig.responseMimeType).toBe('application/json');
    expect(generationConfig.temperature).toBe(0);
    expect(generationConfig.responseSchema.type).toBe('OBJECT');
    expect(Object.keys(generationConfig.responseSchema.properties).sort()).toEqual(
      ['amount', 'category', 'date', 'dateAmbiguous', 'kind', 'note'].sort(),
    );
    expect(generationConfig.responseSchema.properties.amount.nullable).toBe(true);
    expect(generationConfig.responseSchema.properties.note.nullable).toBe(true);
  });

  it('returns the parsed JSON, for the caller to validate, skipping the model’s thoughts', async () => {
    const json = JSON.stringify(ANSWER);
    const fetcher = provider(
      candidate(
        { text: 'thinking about dong', thought: true },
        { text: json.slice(0, 15) },
        { text: json.slice(15) },
      ),
    );

    expect(await reader(fetcher).readSentence(SENTENCE, CONTEXT)).toEqual(ANSWER);
  });

  it('throws its own fixed messages, never the sentence, the answer or the provider’s words', async () => {
    const notJson = await reader(provider(candidate({ text: `total is ${SENTENCE}` })))
      .readSentence(SENTENCE, CONTEXT)
      .catch((error: Error) => error);
    expect((notJson as Error).message).toBe('quick add model did not answer with JSON');

    const empty = await reader(provider({}))
      .readSentence(SENTENCE, CONTEXT)
      .catch((error: Error) => error);
    expect((empty as Error).message).toBe('quick add model gave no answer');

    const denied = await reader(
      provider({ error: { code: 403, message: 'API key AIza-secret not valid' } }, 403),
    )
      .readSentence(SENTENCE, CONTEXT)
      .catch((error: Error) => error);
    expect((denied as Error).message).toBe('quick add model answered 403');
    expect((denied as Error).message).not.toContain('AIza-secret');
  });

  it('is a quota error only when the daily limit is the one that was hit', async () => {
    const quota = (quotaId: string) => ({
      error: {
        code: 429,
        status: 'RESOURCE_EXHAUSTED',
        details: [{ violations: [{ quotaId }] }],
      },
    });

    await expect(
      reader(
        provider(quota('GenerateRequestsPerDayPerProjectPerModel-FreeTier'), 429),
      ).readSentence(SENTENCE, CONTEXT),
    ).rejects.toBeInstanceOf(ReaderQuotaError);

    const perMinute = await reader(
      provider(quota('GenerateRequestsPerMinutePerProjectPerModel-FreeTier'), 429),
    )
      .readSentence(SENTENCE, CONTEXT)
      .catch((error: Error) => error);
    expect(perMinute).not.toBeInstanceOf(ReaderQuotaError);
    expect((perMinute as Error).message).toBe('quick add model answered 429');
  });

  it('gives up when the provider hangs', async () => {
    const hanging: typeof fetch = (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(new DOMException('aborted', 'TimeoutError')),
        );
      });

    await expect(
      reader(hanging, { timeoutMs: 20 }).readSentence(SENTENCE, CONTEXT),
    ).rejects.toThrow();
  });
});

describe('QUICK_ADD_INSTRUCTION', () => {
  const text = QUICK_ADD_INSTRUCTION.toLowerCase();

  it.each([
    ['expands the shorthand for thousands and millions', 'nghìn'],
    ['expands the shorthand for millions', 'triệu'],
    ['asks for a plain number', 'plain number'],
    ['tells it not to convert currencies', 'do not convert'],
    ['tells it not to invent', 'do not invent'],
    ['tells it to treat the sentence as data', 'ignore any instructions'],
    ['says when it is income', 'income'],
  ])('%s', (_name, phrase) => {
    expect(text).toContain(phrase);
  });

  it('names exactly the categories the app can map', () => {
    for (const key of ['groceries', 'eating_out', 'transport', 'health', 'bills']) {
      expect(QUICK_ADD_INSTRUCTION).toContain(key);
    }
  });
});

describe('createQuickAddReader', () => {
  it('is off without a key', () => {
    expect(createQuickAddReader({ geminiApiKey: undefined, geminiModel: 'm' })).toBeNull();
  });

  it('is a Gemini reader of the configured model with a key', async () => {
    const fetcher = provider(candidate({ text: JSON.stringify(ANSWER) }));
    const configured = createQuickAddReader(
      { geminiApiKey: 'k', geminiModel: 'gemini-custom' },
      fetcher,
    );

    await configured!.readSentence(SENTENCE, CONTEXT);

    expect(String(fetcher.mock.calls[0]![0])).toContain('/models/gemini-custom:generateContent');
  });
});
