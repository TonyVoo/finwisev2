import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, parse } from 'node:path';
import { createReceiptReader } from '../services/geminiReader.ts';
import { normalizeModelReading } from '../services/modelReading.ts';
import { parseReceiptText, type ParsedReceipt } from '../services/receiptParser.ts';
import { createTextReader } from '../services/textReader.ts';
import {
  formatSummary,
  newTally,
  parseExpected,
  parseScanArgs,
  recordScore,
  scoreReading,
  type Expected,
  type Tally,
} from './receiptScoring.ts';

/**
 * `pnpm scan:receipts <folder> [currency] [--reader gemini|ocr|both]` - read every JPEG in a folder
 * the way the app does, and print what each reader made of it.
 *
 * - `ocr` (the default): OCR text through the parser. Beside each photo it writes `<name>.txt` with
 *   the raw text, which is the thing to share when a receipt misreads - the parser is tuned on it.
 * - `gemini`: the vision model, through the same validation the server applies. Writes the model's
 *   raw answer to `<name>.model.json`.
 * - `both`: the two side by side.
 *
 * Put a `<name>.expected.json` beside a photo to score it: any of `amountMinor` (minor units),
 * `date` (YYYY-MM-DD), `merchant`, `category`, with `null` for "none on this receipt"; fields left
 * out are not scored. The run ends with correct / wrong / missed counts per field per reader, which
 * is how to decide whether the model beats OCR on your receipts (`docs/design/14-ai-receipt-reading.md`).
 *
 * Photos are shrunk like the app shrinks them (1600px, 70% quality; macOS `sips`) when they are over
 * the free OCR plan's 1 MB, so what is read here is what a phone would send. Uses the server's keys
 * (`OCR_SPACE_API_KEY` / `GOOGLE_VISION_API_KEY` / `GEMINI_API_KEY` in `.env`). Each photo is one
 * request per reader, and the photos leave this machine for it.
 */

const LIMIT_BYTES = 900_000;
/** The free tier has a per-minute limit; a short pause keeps a folder of photos under it. */
const GEMINI_PAUSE_MS = 2_000;

function shrunk(path: string, workDir: string): Uint8Array {
  const bytes = readFileSync(path);
  if (bytes.length <= LIMIT_BYTES) return bytes;
  if (process.platform !== 'darwin') {
    throw new Error(`${bytes.length} bytes is over the limit and only macOS can shrink it here`);
  }
  const out = join(workDir, 'shrunk.jpg');
  execFileSync('sips', ['-Z', '1600', '--setProperty', 'formatOptions', '70', path, '--out', out], {
    stdio: 'ignore',
  });
  return readFileSync(out);
}

function loadExpected(folder: string, name: string): Expected | undefined {
  const path = join(folder, `${parse(name).name}.expected.json`);
  if (!existsSync(path)) return undefined;
  try {
    return parseExpected(readFileSync(path, 'utf8'));
  } catch (error) {
    console.log(`(ignoring ${parse(path).base}: ${(error as Error).message})`);
    return undefined;
  }
}

function report(
  label: string,
  found: ParsedReceipt,
  expected: Expected | undefined,
  tally: Tally,
): void {
  console.log(`--- ${label}`);
  console.log(JSON.stringify(found, null, 2));
  if (expected === undefined) return;
  const score = scoreReading(found, expected);
  recordScore(tally, score);
  console.log(`scored: ${JSON.stringify(score)}`);
}

async function main(): Promise<void> {
  let args;
  try {
    args = parseScanArgs(process.argv.slice(2));
  } catch (error) {
    console.error((error as Error).message);
    process.exitCode = 2;
    return;
  }
  const { folder, currency, reader } = args;
  const ocr = reader === 'gemini' ? null : createTextReader();
  const gemini = reader === 'ocr' ? null : createReceiptReader();
  if (reader !== 'gemini' && ocr === null) {
    console.error('No OCR reader: set OCR_SPACE_API_KEY (or GOOGLE_VISION_API_KEY) in .env.');
    process.exitCode = 2;
    return;
  }
  if (reader !== 'ocr' && gemini === null) {
    console.error('No Gemini reader: set GEMINI_API_KEY (and optionally GEMINI_MODEL) in .env.');
    process.exitCode = 2;
    return;
  }

  const files = readdirSync(folder)
    .filter((name) => /\.jpe?g$/i.test(name))
    .sort();
  if (files.length === 0) console.error(`No .jpg or .jpeg files in ${folder}.`);
  const workDir = mkdtempSync(join(tmpdir(), 'scan-receipts-'));
  const tallies: Record<string, Tally> = {};
  if (ocr !== null) tallies.ocr = newTally();
  if (gemini !== null) tallies.gemini = newTally();

  try {
    for (const name of files) {
      const path = join(folder, name);
      console.log(`\n=== ${name} (${(statSync(path).size / 1000).toFixed(0)} KB)`);
      const expected = loadExpected(folder, name);
      let image: Uint8Array;
      try {
        image = shrunk(path, workDir);
      } catch (error) {
        console.log(`failed: ${(error as Error).message}`);
        continue;
      }
      const today = new Date();

      if (ocr !== null) {
        try {
          const started = Date.now();
          const text = await ocr.readText(image);
          writeFileSync(join(folder, `${parse(name).name}.txt`), text);
          console.log(`--- ocr text (${Date.now() - started} ms), tabs shown as →`);
          console.log(text.replace(/\t/g, '→').trimEnd() || '(nothing read)');
          report('ocr parsed', parseReceiptText(text, { currency, today }), expected, tallies.ocr!);
        } catch (error) {
          console.log(`ocr failed: ${(error as Error).message}`);
        }
      }

      if (gemini !== null) {
        try {
          const started = Date.now();
          const answer = await gemini.readReceipt(image, { currency, today });
          writeFileSync(
            join(folder, `${parse(name).name}.model.json`),
            JSON.stringify(answer, null, 2),
          );
          console.log(`--- gemini answer (${Date.now() - started} ms)`);
          console.log(JSON.stringify(answer, null, 2));
          const { receipt, currencyMismatch } = normalizeModelReading(answer, { currency, today });
          if (currencyMismatch)
            console.log(`(the receipt prints a currency other than ${currency})`);
          report('gemini normalized', receipt, expected, tallies.gemini!);
        } catch (error) {
          console.log(`gemini failed: ${(error as Error).message}`);
        }
        await new Promise((resolve) => setTimeout(resolve, GEMINI_PAUSE_MS));
      }
    }
    console.log(`\n=== summary (${files.length} photos)\n${formatSummary(tallies)}`);
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

await main();
