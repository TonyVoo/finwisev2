import { describe, expect, it, vi } from 'vitest';
import {
  createGoogleVisionReader,
  createOcrSpaceReader,
  createTextReader,
} from '../src/services/textReader.ts';

/**
 * The Google Vision adapter, with `fetch` faked. What matters is the request it sends, what it
 * makes of the answer, and that a failure never carries the key (which travels in the URL).
 */

const IMAGE = new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3]);

function provider(body: unknown, status = 200) {
  return vi.fn(
    async (_url: unknown, _init?: RequestInit) => new Response(JSON.stringify(body), { status }),
  );
}

describe('createGoogleVisionReader', () => {
  it('sends the image for document text detection, with the key', async () => {
    const fetcher = provider({ responses: [{ fullTextAnnotation: { text: 'TOTAL 6.50' } }] });
    const reader = createGoogleVisionReader({ apiKey: 'k e/y', fetchImpl: fetcher });

    await reader.readText(IMAGE);

    const [url, init] = fetcher.mock.calls[0]!;
    expect(String(url)).toBe('https://vision.googleapis.com/v1/images:annotate?key=k%20e%2Fy');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual({
      requests: [
        {
          image: { content: Buffer.from(IMAGE).toString('base64') },
          features: [{ type: 'DOCUMENT_TEXT_DETECTION' }],
        },
      ],
    });
  });

  it('returns the text it found', async () => {
    const fetcher = provider({
      responses: [{ fullTextAnnotation: { text: 'Milk Mart\nTOTAL 6.50' } }],
    });
    const reader = createGoogleVisionReader({ apiKey: 'k', fetchImpl: fetcher });

    expect(await reader.readText(IMAGE)).toBe('Milk Mart\nTOTAL 6.50');
  });

  it('returns an empty string when the photo has no text', async () => {
    const reader = createGoogleVisionReader({
      apiKey: 'k',
      fetchImpl: provider({ responses: [{}] }),
    });

    expect(await reader.readText(IMAGE)).toBe('');
  });

  it('throws on a non-2xx answer, without the key in the message', async () => {
    const reader = createGoogleVisionReader({
      apiKey: 'AIza-secret',
      fetchImpl: provider({ error: { message: 'API key AIza-secret not valid' } }, 403),
    });

    const failure = await reader.readText(IMAGE).catch((error: Error) => error);

    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe('text provider answered 403');
    expect((failure as Error).message).not.toContain('AIza-secret');
  });

  it('throws when the answer carries a per-image error', async () => {
    const reader = createGoogleVisionReader({
      apiKey: 'AIza-secret',
      fetchImpl: provider({
        responses: [{ error: { code: 3, message: 'bad image AIza-secret' } }],
      }),
    });

    const failure = await reader.readText(IMAGE).catch((error: Error) => error);

    expect((failure as Error).message).toBe('text provider reported an error');
  });

  it('gives up when the provider hangs', async () => {
    const hanging: typeof fetch = (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(new DOMException('aborted', 'TimeoutError')),
        );
      });
    const reader = createGoogleVisionReader({ apiKey: 'k', fetchImpl: hanging, timeoutMs: 20 });

    await expect(reader.readText(IMAGE)).rejects.toThrow();
  });
});

describe('createOcrSpaceReader', () => {
  const ok = (text: string) => ({
    OCRExitCode: 1,
    IsErroredOnProcessing: false,
    ParsedResults: [{ ParsedText: text, FileParseExitCode: 1 }],
  });

  it('sends the image as a form, with the key in a header', async () => {
    const fetcher = provider(ok('TOTAL 6.50'));
    const reader = createOcrSpaceReader({ apiKey: 'K123', fetchImpl: fetcher });

    await reader.readText(IMAGE);

    const [url, init] = fetcher.mock.calls[0]!;
    expect(String(url)).toBe('https://api.ocr.space/parse/image');
    expect(init?.method).toBe('POST');
    expect(new Headers(init?.headers).get('apikey')).toBe('K123');
    const form = init?.body as FormData;
    expect(form.get('base64Image')).toBe(
      `data:image/jpeg;base64,${Buffer.from(IMAGE).toString('base64')}`,
    );
    // Line-by-line output is what a receipt parser wants.
    expect(form.get('isTable')).toBe('true');
    expect(form.get('OCREngine')).toBe('2');
    expect(String(url)).not.toContain('K123');
  });

  it('returns the text it found', async () => {
    const reader = createOcrSpaceReader({
      apiKey: 'k',
      fetchImpl: provider(ok('Milk Mart\r\nTOTAL 6.50')),
    });

    expect(await reader.readText(IMAGE)).toBe('Milk Mart\r\nTOTAL 6.50');
  });

  it('joins the text of every result', async () => {
    const reader = createOcrSpaceReader({
      apiKey: 'k',
      fetchImpl: provider({
        OCRExitCode: 1,
        IsErroredOnProcessing: false,
        ParsedResults: [{ ParsedText: 'one' }, { ParsedText: 'two' }],
      }),
    });

    expect(await reader.readText(IMAGE)).toBe('one\ntwo');
  });

  it('returns an empty string when there is no text', async () => {
    const reader = createOcrSpaceReader({
      apiKey: 'k',
      fetchImpl: provider({ OCRExitCode: 1, IsErroredOnProcessing: false, ParsedResults: [] }),
    });

    expect(await reader.readText(IMAGE)).toBe('');
  });

  it('refuses an image over the free plan’s 1 MB without calling the provider', async () => {
    const fetcher = provider(ok('x'));
    const reader = createOcrSpaceReader({ apiKey: 'k', fetchImpl: fetcher });

    await expect(reader.readText(new Uint8Array(1_000_001))).rejects.toThrow('too large');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('throws on a non-2xx answer, without the key in the message', async () => {
    const reader = createOcrSpaceReader({ apiKey: 'SECRET-KEY', fetchImpl: provider({}, 403) });

    const failure = (await reader.readText(IMAGE).catch((error: Error) => error)) as Error;

    expect(failure.message).toBe('text provider answered 403');
  });

  it.each([
    [{ OCRExitCode: 3, IsErroredOnProcessing: true, ErrorMessage: 'key SECRET-KEY over limit' }],
    [{ OCRExitCode: 4, IsErroredOnProcessing: true, ErrorMessage: ['quota'] }],
    [{ OCRExitCode: 1, IsErroredOnProcessing: true, ParsedResults: [] }],
  ])('throws when the provider reports an error: %j', async (body) => {
    const reader = createOcrSpaceReader({ apiKey: 'SECRET-KEY', fetchImpl: provider(body) });

    const failure = (await reader.readText(IMAGE).catch((error: Error) => error)) as Error;

    expect(failure.message).toBe('text provider reported an error');
  });

  it('gives up when the provider hangs', async () => {
    const hanging: typeof fetch = (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(new DOMException('aborted', 'TimeoutError')),
        );
      });
    const reader = createOcrSpaceReader({ apiKey: 'k', fetchImpl: hanging, timeoutMs: 20 });

    await expect(reader.readText(IMAGE)).rejects.toThrow();
  });
});

describe('createTextReader', () => {
  it('is null when no key is set', () => {
    expect(createTextReader({})).toBeNull();
  });

  it('uses OCR.space for its key, and Google Vision for its own', async () => {
    const seen: string[] = [];
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      seen.push(String(url));
      return new Response(JSON.stringify({ OCRExitCode: 1, ParsedResults: [], responses: [{}] }));
    });
    try {
      await createTextReader({ ocrSpaceApiKey: 'a' })!.readText(IMAGE);
      await createTextReader({ googleVisionApiKey: 'b' })!.readText(IMAGE);
      // With both, the free one wins.
      await createTextReader({ ocrSpaceApiKey: 'a', googleVisionApiKey: 'b' })!.readText(IMAGE);
    } finally {
      spy.mockRestore();
    }

    expect(seen[0]).toContain('api.ocr.space');
    expect(seen[1]).toContain('vision.googleapis.com');
    expect(seen[2]).toContain('api.ocr.space');
  });
});
