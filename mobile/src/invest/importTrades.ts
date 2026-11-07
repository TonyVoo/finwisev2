import { TRADE_NOTE_MAX } from '@expense-tracker/shared';
import type { NewTrade } from '../db/mutations';
import type { TradeListItem } from '../db/queries';
import { parseCsv } from '../import/parseCsv';
import { cleanSymbol } from './investModel';

/**
 * Trades from a broker's statement (a CSV export, or a table pasted from a spreadsheet), worked out before anything
 * is written. Pure: no database, no clock. Brokers name their columns in Vietnamese or English and write dates and
 * numbers their own way, so the headers are matched loosely and every row is read on its own: a row that cannot be
 * read is reported with its line number and left out, and never blocks the rest.
 *
 * Rows already in the portfolio (same day, symbol, side, shares and price) are left out, so importing the same
 * statement twice adds nothing the second time.
 */

export type SkipReason =
  'date' | 'symbol' | 'side' | 'quantity' | 'price' | 'fee' | 'duplicate' | 'columns';

export interface ImportedTrade {
  /** Which row of the file it came from, counting the header as row 1 and not counting blank lines. */
  readonly line: number;
  readonly trade: NewTrade;
  /** The price looked like it was in thousands of dong (`56.8`), as brokers quote it, and was scaled. */
  readonly scaled: boolean;
}

export interface TradeImportPlan {
  readonly trades: readonly ImportedTrade[];
  readonly skipped: ReadonlyArray<{ readonly line: number; readonly reason: SkipReason }>;
  /** True when the file has no header this could read: no date, symbol, side, shares and price columns. */
  readonly unreadable: boolean;
}

type Field = 'date' | 'symbol' | 'side' | 'quantity' | 'price' | 'fee' | 'tax' | 'note';

const ALIASES: Readonly<Record<Field, readonly string[]>> = {
  date: ['ngay', 'ngay giao dich', 'ngay gd', 'date', 'trade date', 'thoi gian', 'ngay khop'],
  symbol: [
    'ma',
    'ma ck',
    'ma cp',
    'ma co phieu',
    'ma chung khoan',
    'symbol',
    'ticker',
    'stock',
    'code',
  ],
  side: [
    'loai',
    'lenh',
    'loai lenh',
    'mua ban',
    'mua/ban',
    'giao dich',
    'side',
    'type',
    'action',
    'buy/sell',
  ],
  quantity: [
    'khoi luong',
    'so luong',
    'kl',
    'kl khop',
    'sl',
    'quantity',
    'qty',
    'volume',
    'shares',
    'amount',
  ],
  price: ['gia', 'gia khop', 'gia gd', 'don gia', 'price', 'gia mua', 'gia ban', 'avg price'],
  fee: ['phi', 'phi giao dich', 'phi gd', 'fee', 'fees', 'commission', 'hoa hong'],
  tax: ['thue', 'tax', 'thue tncn'],
  note: ['ghi chu', 'note', 'notes', 'comment', 'mo ta'],
};

/** Lower-case, no diacritics, single spaces: `Khối lượng` and `khoi  luong` are the same header. */
export function normalizeHeader(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9/ ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function columnsOf(header: readonly string[]): Partial<Record<Field, number>> {
  const found: Partial<Record<Field, number>> = {};
  header.forEach((cell, index) => {
    const name = normalizeHeader(cell);
    for (const field of Object.keys(ALIASES) as Field[]) {
      if (found[field] === undefined && ALIASES[field].includes(name)) found[field] = index;
    }
  });
  return found;
}

/** `2026-11-04`, `04/11/2026`, `04-11-2026` or `4.11.2026`, with an optional time after: a calendar date or null. */
export function parseTradeDate(text: string): string | null {
  const t = text.trim().split(/[ T]/)[0] ?? '';
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
  const dmy = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(t);
  const [year, month, day] = iso
    ? [iso[1], iso[2], iso[3]]
    : dmy
      ? [dmy[3], dmy[2], dmy[1]]
      : [undefined, undefined, undefined];
  if (year === undefined || month === undefined || day === undefined) return null;
  const y = Number(year);
  const m = Number(month);
  const d = Number(day);
  const real = new Date(Date.UTC(y, m - 1, d));
  if (y < 1990 || m < 1 || m > 12 || real.getUTCMonth() !== m - 1 || real.getUTCDate() !== d)
    return null;
  return `${year}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/**
 * A number as a spreadsheet may write it: `1.250.000`, `1,250,000`, `1 250 000`, `56.8` or `56,8`. With one kind of
 * separator and exactly three digits after the last, it is a thousands mark; otherwise the last one is a decimal.
 */
export function parseNumber(text: string): number | null {
  const t = text.replace(/[\s ₫đ]|vnd|vnđ/gi, '');
  if (!/^[-+]?[\d.,]+$/.test(t) || !/\d/.test(t)) return null;
  const lastDot = t.lastIndexOf('.');
  const lastComma = t.lastIndexOf(',');
  let normalized: string;
  if (lastDot >= 0 && lastComma >= 0) {
    const decimal = lastDot > lastComma ? '.' : ',';
    const thousands = decimal === '.' ? ',' : '.';
    normalized = t.split(thousands).join('').replace(decimal, '.');
  } else {
    const mark = lastDot >= 0 ? '.' : lastComma >= 0 ? ',' : '';
    if (mark === '') normalized = t;
    else {
      const parts = t.split(mark);
      const last = parts[parts.length - 1] ?? '';
      normalized = parts.length > 2 || last.length === 3 ? parts.join('') : `${parts[0]}.${last}`;
    }
  }
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

const BUY = new Set(['mua', 'buy', 'b', 'm', 'bought', 'purchase']);
const SELL = new Set(['ban', 'sell', 's', 'sold', 'sale']);
const DIVIDEND = new Set(['co tuc', 'dividend', 'div', 'cash dividend', 'co tuc tien mat']);

export function parseSide(text: string): 'buy' | 'sell' | 'dividend' | null {
  const t = normalizeHeader(text);
  if (BUY.has(t)) return 'buy';
  if (SELL.has(t)) return 'sell';
  if (DIVIDEND.has(t)) return 'dividend';
  return null;
}

const WHOLE_MAX = { quantity: 1_000_000_000, price: 1_000_000_000, fee: 1_000_000_000_000 };

/**
 * Read a statement into trades. `existing` are the trades already in the portfolio, for leaving out what is
 * already there.
 */
export function planTradeImport(text: string, existing: readonly TradeListItem[]): TradeImportPlan {
  const rows = parseCsv(text);
  const header = rows[0];
  const columns = header === undefined ? {} : columnsOf(header);
  const required: Field[] = ['date', 'symbol', 'side', 'quantity', 'price'];
  if (header === undefined || required.some((field) => columns[field] === undefined)) {
    return { trades: [], skipped: [], unreadable: true };
  }

  // What is already held, as a count per key, so each existing trade excuses exactly one row of the file.
  const held = new Map<string, number>();
  const keyOf = (t: {
    date: string;
    symbol: string;
    side: string;
    quantity: number;
    price: number;
  }) => `${t.date}|${t.symbol}|${t.side}|${t.quantity}|${t.price}`;
  for (const trade of existing) held.set(keyOf(trade), (held.get(keyOf(trade)) ?? 0) + 1);

  const trades: ImportedTrade[] = [];
  const skipped: Array<{ line: number; reason: SkipReason }> = [];
  const cell = (row: readonly string[], field: Field): string =>
    (columns[field] === undefined ? '' : (row[columns[field] as number] ?? '')).trim();

  rows.slice(1).forEach((row, offset) => {
    const line = offset + 2;
    const skip = (reason: SkipReason) => skipped.push({ line, reason });
    if (row.every((value) => value.trim() === '')) return;

    const date = parseTradeDate(cell(row, 'date'));
    if (date === null) return skip('date');
    const symbol = cleanSymbol(cell(row, 'symbol'));
    if (symbol === null) return skip('symbol');
    const side = parseSide(cell(row, 'side'));
    if (side === null) return skip('side');

    const quantityRaw = parseNumber(cell(row, 'quantity'));
    const quantity = quantityRaw === null ? null : Math.round(Math.abs(quantityRaw));
    if (quantity === null || quantity < 1 || quantity > WHOLE_MAX.quantity) return skip('quantity');

    const priceRaw = parseNumber(cell(row, 'price'));
    if (priceRaw === null || priceRaw <= 0) return skip('price');
    // Brokers quote prices in thousands of dong (`56.8`); no listed share trades under 1.000 dong.
    const scaled = priceRaw < 1000;
    const price = Math.round(scaled ? priceRaw * 1000 : priceRaw);
    if (price < 1 || price > WHOLE_MAX.price) return skip('price');

    const feeParts = [cell(row, 'fee'), cell(row, 'tax')].filter((part) => part !== '');
    let fee = 0;
    for (const part of feeParts) {
      const value = parseNumber(part);
      if (value === null || value < 0) return skip('fee');
      fee += Math.round(value);
    }
    if (fee > WHOLE_MAX.fee) return skip('fee');

    const key = keyOf({ date, symbol, side, quantity, price });
    const already = held.get(key) ?? 0;
    if (already > 0) {
      held.set(key, already - 1);
      return skip('duplicate');
    }

    const note = cell(row, 'note').slice(0, TRADE_NOTE_MAX);
    trades.push({
      line,
      scaled,
      trade: { symbol, side, quantity, price, fee, date, ...(note === '' ? {} : { note }) },
    });
  });

  return { trades, skipped, unreadable: false };
}
