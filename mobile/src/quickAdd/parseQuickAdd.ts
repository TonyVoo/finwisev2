import { LIMITS, categoryKeyFor, foldText } from '@expense-tracker/shared';
import { currencyDecimals } from '../lib/money';
import { matchCategory } from '../receipts/receiptSuggestion';

/**
 * Reading a typed sentence ("coffee 45k yesterday") into an expense: `docs/design/15-quick-add.md`.
 *
 * Pure: text in, a reading out, no network and no clock beyond the `today` it is handed. English and
 * Vietnamese. The one rule that shapes everything is that a sentence which does not clearly say gets
 * **no answer**, not a guess: two amounts it cannot tell apart, or a bare `45` in a currency without
 * decimals (45 dong, or 45k?), come back as `amountMinor: null` and `confident: false`, so a person
 * sees a gap to fill rather than a wrong number to miss.
 *
 * How it works: the sentence is folded to lower-case without accents, one character for one, so a
 * span found in the folded text is the same span in the original. Each part found (a time, a date, the
 * amount) is masked, and what is left, tidied, is the note.
 */

export interface QuickAddContext {
  /** The account's currency: how many decimals an amount has, and which date order to prefer. */
  readonly currency: string;
  /** The form's today, `YYYY-MM-DD`. */
  readonly today: string;
  /** The person's own categories, matched by name on the phone. */
  readonly categories: readonly { readonly id: string; readonly name: string }[];
}

export interface QuickAddReading {
  readonly type: 'expense' | 'income';
  readonly amountMinor: number | null;
  /** `YYYY-MM-DD`, never after today. */
  readonly date: string | null;
  readonly note: string | null;
  readonly categoryId: string | null;
  /** An amount was found and nothing about it is ambiguous: no need to ask anything else. */
  readonly confident: boolean;
}

const NOTE_MAX = LIMITS.EXPENSE_NOTE_MAX;
/** A date with no year may reach back into last year, but only this far: "28/12" in early January. */
const LAST_YEAR_REACH_DAYS = 180;
const DAY_MS = 24 * 60 * 60 * 1000;

// --- Dates --------------------------------------------------------------------------------

const MONTH_NAMES = [
  'january',
  'jan',
  'february',
  'feb',
  'march',
  'mar',
  'april',
  'apr',
  'may',
  'june',
  'jun',
  'july',
  'jul',
  'august',
  'aug',
  'september',
  'sept',
  'sep',
  'october',
  'oct',
  'november',
  'nov',
  'december',
  'dec',
];
const MONTH = `(${MONTH_NAMES.join('|')})\\.?`;

function monthNumber(name: string): number {
  const index = [
    'jan',
    'feb',
    'mar',
    'apr',
    'may',
    'jun',
    'jul',
    'aug',
    'sep',
    'oct',
    'nov',
    'dec',
  ];
  return index.indexOf(name.slice(0, 3)) + 1;
}

function isoOf(year: number, month: number, day: number): string | null {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date.toISOString().slice(0, 10);
}

function dayNumber(iso: string): number {
  return Math.round(Date.parse(`${iso}T00:00:00Z`) / DAY_MS);
}

function shiftDays(iso: string, days: number): string {
  return new Date((dayNumber(iso) + days) * DAY_MS).toISOString().slice(0, 10);
}

/** A date inside the window a receipt or an expense may carry: two years back, to today. */
function withinWindow(iso: string | null, today: string): string | null {
  if (iso === null || iso > today) return null;
  const year = Number(today.slice(0, 4));
  const earliest = `${year - 2}${today.slice(4)}`;
  return iso >= earliest ? iso : null;
}

/** With no year said, this year; but a date still ahead may mean the recent past, just before New Year. */
function withOptionalYear(
  year: number | null,
  month: number,
  day: number,
  today: string,
): string | null {
  if (year !== null) return withinWindow(isoOf(year, month, day), today);
  const thisYear = Number(today.slice(0, 4));
  const candidate = isoOf(thisYear, month, day);
  if (candidate === null) return null;
  if (candidate <= today) return withinWindow(candidate, today);
  const previous = isoOf(thisYear - 1, month, day);
  if (previous !== null && dayNumber(today) - dayNumber(previous) <= LAST_YEAR_REACH_DAYS) {
    return withinWindow(previous, today);
  }
  return null;
}

const WEEKDAYS: Readonly<Record<string, number>> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
  'chu nhat': 0,
  'thu hai': 1,
  'thu 2': 1,
  'thu ba': 2,
  'thu 3': 2,
  'thu tu': 3,
  'thu 4': 3,
  'thu nam': 4,
  'thu 5': 4,
  'thu sau': 5,
  'thu 6': 5,
  'thu bay': 6,
  'thu 7': 6,
};

const RELATIVE: Readonly<Record<string, number>> = {
  'day before yesterday': -2,
  yesterday: -1,
  today: 0,
  'hom kia': -2,
  'hom qua': -1,
  'hom nay': 0,
};

interface DateHit {
  readonly start: number;
  readonly end: number;
  readonly iso: string | null;
}

/** The first date phrase in the sentence. A phrase that is a date in shape but not a usable one still counts. */
function findDate(folded: string, context: QuickAddContext): DateHit | null {
  const { today } = context;
  const monthFirst = context.currency.toUpperCase() === 'USD';
  const hits: DateHit[] = [];
  const add = (match: RegExpExecArray | null, iso: (m: RegExpExecArray) => string | null) => {
    if (match !== null)
      hits.push({ start: match.index, end: match.index + match[0].length, iso: iso(match) });
  };

  add(/(?<![0-9])(\d{4})-(\d{2})-(\d{2})(?![0-9])/.exec(folded), (m) =>
    withinWindow(isoOf(Number(m[1]), Number(m[2]), Number(m[3])), today),
  );

  add(/(?<![0-9/-])(\d{1,2})[/-](\d{1,2})(?:[/-](\d{4}|\d{2}))?(?![0-9/-])/.exec(folded), (m) => {
    const first = Number(m[1]);
    const second = Number(m[2]);
    // The currency picks the order, and a number above 12 can only be a day.
    let [day, month] = monthFirst ? [second, first] : [first, second];
    if (month > 12 && day <= 12) [day, month] = [month, day];
    const year = m[3] === undefined ? null : m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    return withOptionalYear(year, month, day, today);
  });

  add(
    new RegExp(
      `(?<![a-z0-9])(\\d{1,2})(?:st|nd|rd|th)?\\s+${MONTH}(?:\\s+(\\d{4}))?(?![a-z0-9])`,
    ).exec(folded),
    (m) =>
      withOptionalYear(
        m[3] === undefined ? null : Number(m[3]),
        monthNumber(m[2]!),
        Number(m[1]),
        today,
      ),
  );

  add(
    new RegExp(
      `(?<![a-z0-9])${MONTH}\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?(?![a-z0-9])`,
    ).exec(folded),
    (m) =>
      withOptionalYear(
        m[3] === undefined ? null : Number(m[3]),
        monthNumber(m[1]!),
        Number(m[2]),
        today,
      ),
  );

  add(
    /(?:ngay\s+)?(?<![0-9])(\d{1,2})\s+thang\s+(\d{1,2})(?:\s+(?:nam\s+)?(\d{4}))?(?![0-9])/.exec(
      folded,
    ),
    (m) =>
      withOptionalYear(m[3] === undefined ? null : Number(m[3]), Number(m[2]), Number(m[1]), today),
  );

  add(
    /(?<![a-z])(day before yesterday|yesterday|today|hom kia|hom qua|hom nay)(?![a-z])/.exec(
      folded,
    ),
    (m) => withinWindow(shiftDays(today, RELATIVE[m[1]!]!), today),
  );

  add(
    /(?<![a-z])(?:(last)\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday|thu\s+(?:hai|ba|tu|nam|sau|bay|[2-7])|chu\s+nhat)(?![a-z0-9])/.exec(
      folded,
    ),
    (m) => {
      const target = WEEKDAYS[m[2]!.replace(/\s+/g, ' ')]!;
      const todayDow = new Date(`${today}T00:00:00Z`).getUTCDay();
      let back = (todayDow - target + 7) % 7;
      if (back === 0 && m[1] !== undefined) back = 7;
      return withinWindow(shiftDays(today, -back), today);
    },
  );

  hits.sort((a, b) => a.start - b.start);
  return hits[0] ?? null;
}

// --- Amounts ------------------------------------------------------------------------------

const UNIT: Readonly<Record<string, number>> = {
  k: 1_000,
  nghin: 1_000,
  ngan: 1_000,
  tr: 1_000_000,
  trieu: 1_000_000,
};

const AMOUNT =
  /(?<![a-z0-9.,])([$€£¥₫])?\s?(\d{1,3}(?:[.,]\d{3})+(?:[.,]\d+)?|\d+(?:[.,]\d+)?)(?:\s?(trieu|tr|nghin|ngan|k)(?![a-z])(\d{1,3})?)?(?:\s?(dollars?|bucks?|usd|eur|vnd|dong|d|[$€£¥₫])(?![a-z0-9]))?(?![a-z0-9])/g;

interface Candidate {
  readonly start: number;
  readonly end: number;
  /** A suffix (45k), a currency (4 dollars), a separator (45.000) or a decimal: said to be an amount. */
  readonly strong: boolean;
  /** Minor units, or null when the number cannot be read as an amount in this currency. */
  readonly minor: number | null;
}

/** A number as written, in major units, using the account currency's decimals to tell a separator's meaning. */
function majorUnits(raw: string, hasUnit: boolean, decimals: number): number | null {
  const parts = raw.split(/[.,]/);
  if (parts.length === 1) return Number(raw);
  const last = parts[parts.length - 1]!;
  const groups = parts.slice(1).every((part) => part.length === 3);
  if (parts.length === 2) {
    if (hasUnit || (decimals > 0 && last.length <= decimals)) return Number(`${parts[0]}.${last}`);
    if (last.length === 3) return Number(parts.join(''));
    return null;
  }
  if (groups) return Number(parts.join(''));
  const middle = parts.slice(1, -1).every((part) => part.length === 3);
  if (middle && (hasUnit || last.length <= decimals)) {
    return Number(`${parts.slice(0, -1).join('')}.${last}`);
  }
  return null;
}

function candidatesIn(folded: string, used: readonly boolean[], decimals: number): Candidate[] {
  const found: Candidate[] = [];
  for (const match of folded.matchAll(AMOUNT)) {
    const start = match.index;
    const end = start + match[0].length;
    if (used.slice(start, end).some(Boolean)) continue;
    const raw = match[2]!;
    const unit = match[3];
    const fraction = match[4];
    const hasCurrency = match[1] !== undefined || match[5] !== undefined;
    const hasSeparator = /[.,]/.test(raw);

    let major = majorUnits(raw, unit !== undefined, decimals);
    if (major !== null && unit !== undefined) {
      const multiplier = UNIT[unit]!;
      if (fraction !== undefined) {
        // "3tr5" is 3.5 million: the digits after the unit are its fraction.
        major = hasSeparator ? null : major * multiplier + Number(`0.${fraction}`) * multiplier;
      } else {
        major *= multiplier;
      }
    }
    let minor =
      major === null ? null : Math.round(Number((major * 10 ** decimals).toPrecision(12)));
    if (minor !== null && (minor < 1 || minor >= LIMITS.AMOUNT_MINOR_MAX)) minor = null;

    const bare = unit === undefined && !hasCurrency && !hasSeparator;
    // Without decimals, a bare number under a thousand could be that many dong or that many thousand.
    const unsureBare = bare && decimals === 0 && major !== null && major < 1000;
    if (unsureBare) minor = null;
    const strong = !bare || (decimals === 0 && !unsureBare);

    found.push({
      start,
      end,
      strong,
      minor,
    });
  }
  return found;
}

interface AmountChoice {
  readonly candidate: Candidate | null;
  readonly sure: boolean;
}

function chooseAmount(candidates: readonly Candidate[]): AmountChoice {
  const strong = candidates.filter((candidate) => candidate.strong);
  if (strong.length === 1) return { candidate: strong[0]!, sure: strong[0]!.minor !== null };
  if (strong.length > 1) return { candidate: null, sure: false };
  // Only bare numbers left. One is the amount; two or more could be a quantity and a price, or two
  // prices ("coffee 3 and bagel 4"), and only a clear amount (45k, 4.50, $4) settles that.
  if (candidates.length !== 1) return { candidate: null, sure: false };
  return { candidate: candidates[0]!, sure: candidates[0]!.minor !== null };
}

// --- Note, type, category ------------------------------------------------------------------

const INCOME =
  /(?<![a-z])(salary|paycheck|paycheque|wages?|bonus|income|received|got paid|luong|thu nhap)(?![a-z])/;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** The person's own category whose name appears in the sentence as a whole word; the longest name wins. */
function ownCategory(folded: string, categories: QuickAddContext['categories']): string | null {
  let best: { id: string; length: number } | null = null;
  for (const category of categories) {
    const name = foldText(category.name).trim();
    if (name.length < 3) continue;
    if (!new RegExp(`(?<![a-z0-9])${escapeRegExp(name)}(?![a-z0-9])`).test(folded)) continue;
    if (best === null || name.length > best.length) best = { id: category.id, length: name.length };
  }
  return best?.id ?? null;
}

const LEADING_FILLER = /^(?:(?:spent|paid|pay|bought|buy|got|mua)|(?:on|for|at))(?![a-z])/;
const TRAILING_FILLER = /(?<![a-z])(?:on|at|for|vao|ngay|luc)$/;
const EDGE_PUNCTUATION = /^[\s,;:.\-–—·]+|[\s,;:.\-–—·]+$/g;

function tidyNote(rest: string): string | null {
  let note = rest.replace(/\s+/g, ' ').trim();
  for (let pass = 0; pass < 6; pass += 1) {
    const folded = foldText(note);
    const lead = LEADING_FILLER.exec(folded);
    if (lead !== null) {
      note = note.slice(lead[0].length).replace(EDGE_PUNCTUATION, '');
      continue;
    }
    const trail = TRAILING_FILLER.exec(folded);
    if (trail !== null) {
      note = note.slice(0, trail.index).replace(EDGE_PUNCTUATION, '');
      continue;
    }
    const trimmed = note.replace(EDGE_PUNCTUATION, '');
    if (trimmed === note) break;
    note = trimmed;
  }
  // Nothing but punctuation or symbols is not a note.
  if (!/[\p{L}\p{N}]/u.test(note)) return null;
  return (note.charAt(0).toLocaleUpperCase() + note.slice(1)).slice(0, NOTE_MAX);
}

// --- The reading --------------------------------------------------------------------------

export function parseQuickAdd(text: string, context: QuickAddContext): QuickAddReading {
  const folded = foldText(text);
  const used = new Array<boolean>(text.length).fill(false);
  const mask = (start: number, end: number) => used.fill(true, start, end);
  const decimals = currencyDecimals(context.currency);

  const plus = /^\s*\+/.exec(folded);
  if (plus !== null) mask(0, plus[0].length);

  for (const time of folded.matchAll(
    /(?<![a-z0-9])\d{1,2}:\d{2}(?::\d{2})?(?:\s?(?:am|pm))?(?![a-z0-9])|(?<![a-z0-9])\d{1,2}\s?(?:am|pm)(?![a-z0-9])/g,
  )) {
    mask(time.index, time.index + time[0].length);
  }

  const dateHit = findDate(folded, context);
  if (dateHit !== null) mask(dateHit.start, dateHit.end);

  const choice = chooseAmount(candidatesIn(folded, used, decimals));
  if (choice.candidate !== null && choice.sure) mask(choice.candidate.start, choice.candidate.end);

  let rest = '';
  for (let index = 0; index < text.length; index += 1) {
    rest += used[index] ? ' ' : text[index];
  }

  const categoryId =
    ownCategory(folded, context.categories) ??
    matchCategory(categoryKeyFor(text), context.categories);

  const sure = choice.candidate !== null && choice.sure;
  return {
    type: plus !== null || INCOME.test(folded) ? 'income' : 'expense',
    amountMinor: sure ? choice.candidate!.minor : null,
    date: dateHit?.iso ?? null,
    note: tidyNote(rest),
    categoryId,
    confident: sure,
  };
}
