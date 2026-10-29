import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, parse } from 'node:path';
import { parseReceiptText } from '../services/receiptParser.ts';
import { createTextReader } from '../services/textReader.ts';

/**
 * `pnpm scan:receipts <folder> [currency]` - read every JPEG in a folder the way the app does, and
 * print what the reader saw and what the parser made of it.
 *
 * For tuning the parser on real receipts: drop photos in a folder, run this, and see exactly where
 * a total, a date or a shop name went wrong. Beside each photo it writes `<name>.txt` holding the
 * raw text, which is the thing to share when a receipt misreads - the parser's rules are tuned on it.
 *
 * Photos are shrunk like the app shrinks them (1600px, 70% quality; macOS `sips`) when they are over
 * the free OCR plan's 1 MB, so what is read here is what a phone would send. Uses the same key as the
 * server (`OCR_SPACE_API_KEY` or `GOOGLE_VISION_API_KEY` in `.env`). Each photo is one request to the
 * provider, and the photos leave this machine for it.
 */

const LIMIT_BYTES = 900_000;

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

async function main(): Promise<void> {
  const [folder, currency = 'USD'] = process.argv.slice(2);
  if (folder === undefined) {
    console.error('usage: pnpm scan:receipts <folder> [currency, default USD]');
    process.exitCode = 2;
    return;
  }
  const reader = createTextReader();
  if (reader === null) {
    console.error(
      'No reader configured: set OCR_SPACE_API_KEY (or GOOGLE_VISION_API_KEY) in .env.',
    );
    process.exitCode = 2;
    return;
  }

  const files = readdirSync(folder)
    .filter((name) => /\.jpe?g$/i.test(name))
    .sort();
  if (files.length === 0) console.error(`No .jpg or .jpeg files in ${folder}.`);
  const workDir = mkdtempSync(join(tmpdir(), 'scan-receipts-'));

  try {
    for (const name of files) {
      const path = join(folder, name);
      console.log(`\n=== ${name} (${(statSync(path).size / 1000).toFixed(0)} KB)`);
      try {
        const started = Date.now();
        const text = await reader.readText(shrunk(path, workDir));
        const found = parseReceiptText(text, { currency, today: new Date() });
        writeFileSync(join(folder, `${parse(name).name}.txt`), text);
        console.log(`--- text (${Date.now() - started} ms), tabs shown as →`);
        console.log(text.replace(/\t/g, '→').trimEnd() || '(nothing read)');
        console.log('--- parsed');
        console.log(JSON.stringify(found, null, 2));
      } catch (error) {
        console.log(`failed: ${(error as Error).message}`);
      }
    }
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

await main();
