import { z } from 'zod';
import { RECEIPT_CATEGORY_KEYS, type ParsedReceipt } from '../services/receiptParser.ts';

/**
 * The pure half of `pnpm scan:receipts`: its arguments, and scoring a reading against what a person
 * wrote down as the truth. `docs/design/14-ai-receipt-reading.md`, "Checking it is better".
 *
 * Wrong and missed are kept apart on purpose: a missing value costs the user a few taps, a wrong one
 * costs them money if they do not notice.
 */

export const READERS = ['gemini', 'ocr', 'both'] as const;
export type ReaderChoice = (typeof READERS)[number];

export interface ScanArgs {
  readonly folder: string;
  readonly currency: string;
  readonly reader: ReaderChoice;
}

const USAGE =
  'usage: pnpm scan:receipts <folder> [currency, default USD] [--reader gemini|ocr|both, default ocr]';

export function parseScanArgs(argv: readonly string[]): ScanArgs {
  const positional: string[] = [];
  let reader: ReaderChoice = 'ocr';
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (!arg.startsWith('--')) {
      positional.push(arg);
      continue;
    }
    const [flag, inline] = arg.split('=', 2) as [string, string | undefined];
    if (flag !== '--reader') throw new Error(`unknown option ${flag}\n${USAGE}`);
    const value = inline ?? argv[++index];
    if (value === undefined) throw new Error(`--reader needs a value: gemini|ocr|both`);
    const choice = READERS.find((name) => name === value);
    if (choice === undefined) throw new Error(`--reader must be gemini|ocr|both, not "${value}"`);
    reader = choice;
  }
  const [folder, currency = 'USD'] = positional;
  if (folder === undefined) throw new Error(USAGE);
  return { folder, currency, reader };
}

// --- Expected values --------------------------------------------------------------------

/** `<photo>.expected.json`. A field that is left out is not scored; `null` means "none on this receipt". */
const ExpectedFile = z.strictObject({
  amountMinor: z.number().int().positive().nullable().optional(),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
  merchant: z.string().min(1).nullable().optional(),
  category: z.enum(RECEIPT_CATEGORY_KEYS).nullable().optional(),
});

export type Expected = z.infer<typeof ExpectedFile>;

export function parseExpected(text: string): Expected {
  const parsed = ExpectedFile.safeParse(JSON.parse(text));
  if (!parsed.success) {
    throw new Error(
      `bad expected file: ${parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'} ${i.message}`).join('; ')}`,
    );
  }
  // `exactOptionalPropertyTypes` aside, keep only what was written.
  return Object.fromEntries(Object.entries(parsed.data).filter(([, v]) => v !== undefined));
}

// --- Scoring ----------------------------------------------------------------------------

export const FIELDS = ['amountMinor', 'date', 'merchant', 'category'] as const;
export type Field = (typeof FIELDS)[number];
export type Outcome = 'correct' | 'wrong' | 'missed';
export type Score = Partial<Record<Field, Outcome>>;

const LABEL: Record<Field, string> = {
  amountMinor: 'amount',
  date: 'date',
  merchant: 'merchant',
  category: 'category',
};

/** Case, accents, punctuation and spacing do not make a shop a different shop. */
function foldName(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function sameMerchant(actual: string, expected: string): boolean {
  const a = foldName(actual);
  const e = foldName(expected);
  if (a === e) return true;
  const [short, long] = a.length <= e.length ? [a, e] : [e, a];
  return short.length >= 3 && long.includes(short);
}

function outcome(field: Field, actual: ParsedReceipt, expected: Expected): Outcome | undefined {
  if (!(field in expected)) return undefined;
  const want = expected[field] ?? null;
  const got = actual[field];
  if (got === null) return want === null ? 'correct' : 'missed';
  if (want === null) return 'wrong';
  if (field === 'merchant') return sameMerchant(String(got), String(want)) ? 'correct' : 'wrong';
  return got === want ? 'correct' : 'wrong';
}

export function scoreReading(actual: ParsedReceipt, expected: Expected): Score {
  const score: Score = {};
  for (const field of FIELDS) {
    const result = outcome(field, actual, expected);
    if (result !== undefined) score[field] = result;
  }
  return score;
}

export type Tally = Record<Field, Record<Outcome, number>>;

export function newTally(): Tally {
  const counts = () => ({ correct: 0, wrong: 0, missed: 0 });
  return {
    amountMinor: counts(),
    date: counts(),
    merchant: counts(),
    category: counts(),
  };
}

export function recordScore(tally: Tally, score: Score): void {
  for (const field of FIELDS) {
    const result = score[field];
    if (result !== undefined) tally[field][result] += 1;
  }
}

/** One line per scored field per reader. */
export function formatSummary(tallies: Readonly<Record<string, Tally>>): string {
  const lines: string[] = [];
  for (const field of FIELDS) {
    for (const [reader, tally] of Object.entries(tallies)) {
      const { correct, wrong, missed } = tally[field];
      if (correct + wrong + missed === 0) continue;
      lines.push(
        `${LABEL[field].padEnd(9)} ${reader.padEnd(7)} correct ${correct}   wrong ${wrong}   missed ${missed}`,
      );
    }
  }
  return lines.length > 0
    ? lines.join('\n')
    : 'No .expected.json files found, so nothing was scored.';
}
