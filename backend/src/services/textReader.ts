import { getConfig } from '../config.ts';

/**
 * Reading the text off a photo, behind one small interface (like the mailer): the receipt
 * service asks "what does this image say" and does not know who answers. Swapping the provider
 * is a change to {@link createTextReader} and nothing else.
 *
 * The provider is Google Cloud Vision's `DOCUMENT_TEXT_DETECTION` over HTTPS with an API key -
 * one request, no SDK. Its key travels in the URL, so nothing here ever puts that URL, or a
 * provider's own error text, into a thrown message or a log line.
 */
export interface TextReader {
  /** The text found in a JPEG, line by line, or an empty string when there is none. */
  readText(image: Uint8Array): Promise<string>;
}

const VISION_URL = 'https://vision.googleapis.com/v1/images:annotate';
const TIMEOUT_MS = 10_000;

export function createGoogleVisionReader(options: {
  apiKey: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): TextReader {
  const doFetch = options.fetchImpl ?? fetch;
  return {
    async readText(image) {
      const response = await doFetch(`${VISION_URL}?key=${encodeURIComponent(options.apiKey)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requests: [
            {
              image: { content: Buffer.from(image).toString('base64') },
              features: [{ type: 'DOCUMENT_TEXT_DETECTION' }],
            },
          ],
        }),
        signal: AbortSignal.timeout(options.timeoutMs ?? TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(`text provider answered ${response.status}`);
      const body = (await response.json()) as {
        responses?: { error?: unknown; fullTextAnnotation?: { text?: unknown } }[];
      };
      const first = body.responses?.[0];
      if (first === undefined || first.error !== undefined) {
        throw new Error('text provider reported an error');
      }
      const text = first.fullTextAnnotation?.text;
      return typeof text === 'string' ? text : '';
    },
  };
}

/** The configured reader, or null when receipt reading is not set up. */
export function createTextReader(): TextReader | null {
  const { googleVisionApiKey } = getConfig().ocr;
  return googleVisionApiKey === undefined
    ? null
    : createGoogleVisionReader({ apiKey: googleVisionApiKey });
}

let current: TextReader | null | undefined;

/** The process's reader, built on first use. Null means receipt reading is off. */
export function getTextReader(): TextReader | null {
  if (current === undefined) current = createTextReader();
  return current;
}

/** Test seam: a reader, `null` for "not configured", or `undefined` to rebuild the default. */
export function setTextReaderForTests(reader: TextReader | null | undefined): void {
  current = reader;
}
