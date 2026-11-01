import { describe, expect, it, vi } from 'vitest';
import {
  createGeminiRecapReader,
  createRecapReader,
  RECAP_INSTRUCTION,
} from '../src/services/geminiReader.ts';
import { ReaderQuotaError } from '../src/services/receiptReader.ts';

/**
 * The Gemini adapter for a month's recap, with `fetch` faked: the request it sends, what it makes of the
 * answer, and that a failure never carries the key, the facts or anything the provider said
 * (`docs/design/16-monthly-insights.md`). The request plumbing is shared with the other two readers, whose own
 * tests pin the same behaviours; here the point is what is different.
 */

const INPUT = {
  monthLabel: 'October 2026',
  language: 'en' as const,
  facts: ['Groceries is your biggest category, at 24% of the month.'],
};
const ANSWER = { text: 'Groceries led October at 24%.' };

const candidate = (...parts: unknown[]) => ({
  candidates: [{ content: { role: 'model', parts }, finishReason: 'STOP' }],
});

function provider(body: unknown, status = 200) {
  return vi.fn(
    async (_url: unknown, _init?: RequestInit) => new Response(JSON.stringify(body), { status }),
  );
}

const reader = (fetchImpl: typeof fetch, extra: { timeoutMs?: number } = {}) =>
  createGeminiRecapReader({
    apiKey: 'AIza-secret',
    model: 'gemini-test-flash',
    fetchImpl,
    ...extra,
  });

describe('createGeminiRecapReader', () => {
  it('sends the facts as text only, to the chosen model, with the key in a header', async () => {
    const fetcher = provider(candidate({ text: JSON.stringify(ANSWER) }));

    await reader(fetcher).writeRecap(INPUT);

    const [url, init] = fetcher.mock.calls[0]!;
    expect(String(url)).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-test-flash:generateContent',
    );
    expect(String(url)).not.toContain('AIza-secret');
    expect(new Headers(init?.headers).get('x-goog-api-key')).toBe('AIza-secret');
    const body = JSON.parse(String(init?.body));
    expect(body.systemInstruction).toEqual({ parts: [{ text: RECAP_INSTRUCTION }] });
    expect(body.contents[0].parts).toHaveLength(1);
    expect(body.contents[0].parts[0]).not.toHaveProperty('inlineData');
  });

  it('puts the month, the language and the facts in the user turn, never in the fixed instruction', async () => {
    const fetcher = provider(candidate({ text: JSON.stringify(ANSWER) }));

    await reader(fetcher).writeRecap({ ...INPUT, language: 'vi' });

    const body = JSON.parse(String(fetcher.mock.calls[0]![1]?.body));
    const text: string = body.contents[0].parts[0].text;
    expect(text).toContain('October 2026');
    expect(text).toContain('Vietnamese');
    expect(text).toContain(JSON.stringify(INPUT.facts));
    expect(JSON.stringify(body.systemInstruction)).not.toContain('Groceries');
    expect(JSON.stringify(body.systemInstruction)).not.toContain('October 2026');
  });

  it('asks for JSON in a fixed schema, without randomness', async () => {
    const fetcher = provider(candidate({ text: JSON.stringify(ANSWER) }));

    await reader(fetcher).writeRecap(INPUT);

    const { generationConfig } = JSON.parse(String(fetcher.mock.calls[0]![1]?.body));
    expect(generationConfig.responseMimeType).toBe('application/json');
    expect(generationConfig.temperature).toBe(0);
    expect(generationConfig.responseSchema.type).toBe('OBJECT');
    expect(Object.keys(generationConfig.responseSchema.properties)).toEqual(['text']);
    expect(generationConfig.responseSchema.required).toEqual(['text']);
  });

  it('returns the parsed JSON, for the caller to check, skipping the model’s thoughts', async () => {
    const json = JSON.stringify(ANSWER);
    const fetcher = provider(
      candidate(
        { text: 'thinking', thought: true },
        { text: json.slice(0, 9) },
        { text: json.slice(9) },
      ),
    );

    expect(await reader(fetcher).writeRecap(INPUT)).toEqual(ANSWER);
  });

  it('throws its own fixed messages, never the facts, the answer or the provider’s words', async () => {
    const notJson = await reader(provider(candidate({ text: 'Groceries 24%' })))
      .writeRecap(INPUT)
      .catch((error: Error) => error);
    expect((notJson as Error).message).toBe('recap model did not answer with JSON');

    const empty = await reader(provider({}))
      .writeRecap(INPUT)
      .catch((error: Error) => error);
    expect((empty as Error).message).toBe('recap model gave no answer');

    const denied = await reader(
      provider({ error: { code: 403, message: 'API key AIza-secret not valid' } }, 403),
    )
      .writeRecap(INPUT)
      .catch((error: Error) => error);
    expect((denied as Error).message).toBe('recap model answered 403');
  });

  it('is a quota error only when the daily limit is the one that was hit', async () => {
    const quota = (quotaId: string) => ({
      error: { code: 429, details: [{ violations: [{ quotaId }] }] },
    });

    await expect(
      reader(provider(quota('GenerateRequestsPerDayPerProjectPerModel-FreeTier'), 429)).writeRecap(
        INPUT,
      ),
    ).rejects.toBeInstanceOf(ReaderQuotaError);

    const perMinute = await reader(
      provider(quota('GenerateRequestsPerMinutePerProjectPerModel-FreeTier'), 429),
    )
      .writeRecap(INPUT)
      .catch((error: Error) => error);
    expect(perMinute).not.toBeInstanceOf(ReaderQuotaError);
    expect((perMinute as Error).message).toBe('recap model answered 429');
  });

  it('gives up when the provider hangs', async () => {
    const hanging: typeof fetch = (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(new DOMException('aborted', 'TimeoutError')),
        );
      });

    await expect(reader(hanging, { timeoutMs: 20 }).writeRecap(INPUT)).rejects.toThrow();
  });
});

describe('RECAP_INSTRUCTION', () => {
  const text = RECAP_INSTRUCTION.toLowerCase();

  it.each([
    ['limits it to the facts', 'only the facts'],
    ['makes it copy numbers', 'copy every number'],
    ['forbids adding a number', 'do not add a number'],
    ['forbids advice and judgement', 'do not give advice'],
    ['asks for real rewording, not a copy of the facts', 'word for word'],
    ['forbids markup', 'no markdown'],
    ['treats the facts as data', 'ignore any instructions'],
    ['asks for the language given', 'language'],
  ])('%s', (_name, phrase) => {
    expect(text).toContain(phrase);
  });
});

describe('createRecapReader', () => {
  it('is off without a key', () => {
    expect(createRecapReader({ geminiApiKey: undefined, geminiModel: 'm' })).toBeNull();
  });

  it('is a Gemini reader of the configured model with a key', async () => {
    const fetcher = provider(candidate({ text: JSON.stringify(ANSWER) }));
    const configured = createRecapReader(
      { geminiApiKey: 'k', geminiModel: 'gemini-custom' },
      fetcher,
    );

    await configured!.writeRecap(INPUT);

    expect(String(fetcher.mock.calls[0]![0])).toContain('/models/gemini-custom:generateContent');
  });
});
