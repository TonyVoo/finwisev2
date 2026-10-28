import { getConfig } from '../config.ts';

/**
 * Reading the text off a photo, behind one small interface (like the mailer): the receipt
 * service asks "what does this image say" and does not know who answers. Swapping the provider
 * is a change to {@link createTextReader} and nothing else.
 *
 * Two providers, each one HTTPS request and no SDK: OCR.space (a free plan with a free key, so
 * the default to recommend) and Google Cloud Vision's `DOCUMENT_TEXT_DETECTION`. Vision's key
 * travels in the URL, so nothing here ever puts that URL, or a provider's own error text (which
 * can name a key or a quota), into a thrown message or a log line.
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

/** OCR.space's free plan refuses files over 1 MB; asking would only waste a request. */
const OCR_SPACE_MAX_BYTES = 1_000_000;
const OCR_SPACE_URL = 'https://api.ocr.space/parse/image';
const OCR_SPACE_TIMEOUT_MS = 15_000;

export function createOcrSpaceReader(options: {
  apiKey: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): TextReader {
  const doFetch = options.fetchImpl ?? fetch;
  return {
    async readText(image) {
      if (image.length > OCR_SPACE_MAX_BYTES) throw new Error('image too large for the provider');
      const form = new FormData();
      form.set('base64Image', `data:image/jpeg;base64,${Buffer.from(image).toString('base64')}`);
      form.set('OCREngine', '2');
      // Line by line, which is how a receipt reads and what the parser expects.
      form.set('isTable', 'true');
      form.set('scale', 'true');
      form.set('detectOrientation', 'true');
      const response = await doFetch(OCR_SPACE_URL, {
        method: 'POST',
        headers: { apikey: options.apiKey },
        body: form,
        signal: AbortSignal.timeout(options.timeoutMs ?? OCR_SPACE_TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(`text provider answered ${response.status}`);
      const body = (await response.json()) as {
        OCRExitCode?: number;
        IsErroredOnProcessing?: boolean;
        ParsedResults?: { ParsedText?: unknown }[];
      };
      if (body.IsErroredOnProcessing === true || (body.OCRExitCode ?? 1) >= 3) {
        throw new Error('text provider reported an error');
      }
      return (body.ParsedResults ?? [])
        .map((result) => (typeof result.ParsedText === 'string' ? result.ParsedText : ''))
        .join('\n');
    },
  };
}

export interface OcrConfig {
  readonly ocrSpaceApiKey?: string | undefined;
  readonly googleVisionApiKey?: string | undefined;
}

/** The configured reader, or null when receipt reading is not set up. OCR.space wins when both are. */
export function createTextReader(config: OcrConfig = getConfig().ocr): TextReader | null {
  if (config.ocrSpaceApiKey !== undefined) {
    return createOcrSpaceReader({ apiKey: config.ocrSpaceApiKey });
  }
  if (config.googleVisionApiKey !== undefined) {
    return createGoogleVisionReader({ apiKey: config.googleVisionApiKey });
  }
  return null;
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
