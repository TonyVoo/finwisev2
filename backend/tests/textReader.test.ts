import { describe, expect, it, vi } from 'vitest';
import { createGoogleVisionReader } from '../src/services/textReader.ts';

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
