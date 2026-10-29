/**
 * Writes `docs/i18n/vietnamese-review.csv`: every string the app shows, in English and in
 * Vietnamese, with where it appears, for a native speaker to check. They fill the last column; a
 * developer applies the corrections to `src/copy/vi.ts`.
 *
 * Run from `mobile/`:  npx tsx scripts/export-copy-review.ts
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ENGLISH_COPY } from '../src/i18n/apply';
import { VIETNAMESE_COPY } from '../src/copy/vi';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function flatten(value: unknown, path: string[] = []): [string, string][] {
  if (typeof value === 'string') return [[path.join('.'), value]];
  if (typeof value !== 'object' || value === null) return [];
  return Object.entries(value).flatMap(([key, next]) => flatten(next, [...path, key]));
}

/** Where each string appears, from the copy deck's tables: `| \`key\` | text | where |`. */
function deckContexts(): Map<string, string> {
  const deck = readFileSync(join(ROOT, 'docs/design/09-copy-deck.md'), 'utf8');
  const where = new Map<string, string>();
  for (const line of deck.split('\n')) {
    const cells = line.split('|').map((cell) => cell.trim());
    const key = /^`([^`]+)`$/.exec(cells[1] ?? '')?.[1];
    const context = cells[cells.length - 2];
    if (key !== undefined && context !== undefined && context !== '') where.set(key, context);
  }
  return where;
}

const csv = (cell: string): string => `"${cell.replace(/"/g, '""')}"`;

const english = new Map(flatten(ENGLISH_COPY));
const vietnamese = new Map(flatten(VIETNAMESE_COPY));
const contexts = deckContexts();

const rows = [...english.entries()].map(([path, en]) => {
  const key = path.replace(/^[A-Z_]+\./, '');
  const vi = vietnamese.get(path) ?? '';
  const flag = vi === '' ? 'MISSING' : vi === en ? 'same as English' : '';
  return [path, contexts.get(key) ?? '', en, vi, flag, ''];
});

const header = ['key', 'where it appears', 'English', 'Tiếng Việt', 'note', 'corrected Tiếng Việt'];
const out = [header, ...rows].map((row) => row.map(csv).join(',')).join('\n') + '\n';

const target = join(ROOT, 'docs/i18n/vietnamese-review.csv');
mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, '﻿' + out);
console.log(`${rows.length} strings -> ${target}`);
