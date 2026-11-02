import { LIMITS } from '@expense-tracker/shared';

/**
 * Reading a payment out of a MoMo or ZaloPay notification (`docs/design/20-payment-detection.md`).
 *
 * Everything here runs on the phone, on text that never leaves it. The wording of these apps' notifications
 * is not published and changes, so the parser does not match whole sentences: it looks for an amount in dong,
 * for words that say which way the money went, and for a name after "at / to / from". Anything it cannot tell
 * is left alone (`null`) rather than guessed - a missed payment costs a few taps, a wrong one is a wrong entry.
 */

/** The only apps whose notifications are read, by Android package name. */
export const CAPTURE_PACKAGES: Readonly<Record<string, string>> = {
  'com.mservice.momotransfer': 'MoMo',
  'vn.com.vng.zalopay': 'ZaloPay',
};

export interface RawNotification {
  readonly packageName: string;
  readonly title: string;
  readonly text: string;
  /** When the notification arrived, in epoch milliseconds. */
  readonly postTime: number;
}

export interface DetectedPayment {
  readonly direction: 'spend' | 'income';
  /** Dong have no minor unit, so this is a whole number of dong. */
  readonly amountMinor: number;
  readonly currency: 'VND';
  readonly counterparty: string | null;
  readonly source: string;
  readonly postTime: number;
}

/** Lower-cased, accents removed, `đ` as `d` - one output character per input character, so indexes line up. */
function plain(text: string): string {
  const composed = text.normalize('NFC');
  let out = '';
  for (let i = 0; i < composed.length; i++) {
    const c = composed.charAt(i);
    if (c === 'đ' || c === 'Đ') out += 'd';
    else out += c.normalize('NFD').charAt(0).toLowerCase();
  }
  return out;
}

const NOISE = [
  /\b(otp|ma xac thuc|ma xac nhan|ma bao mat)\b/,
  /(uu dai|khuyen mai|voucher|nhap ma|ma giam|qua tang|giam \d|giam gia|tang ban)/,
  /(den han|can thanh toan|nhac nho|chua thanh toan|thanh toan ngay|han thanh toan|het han)/,
  /(dang nhap|thiet bi moi)/,
];
const INCOME = /(ban da nhan|nhan duoc|da nhan|nhan tien|hoan tien|tien ve|\+\s?\d)/;
const SPEND =
  /(thanh toan|da chuyen|chuyen tien|chuyen khoan|da gui|nap tien|\bmua\b|da tra|giao dich thanh cong|-\s?\d)/;

// `[sign] 1.250.000 d` and `vnd 5.000`. Not preceded or followed by anything that makes it part of a longer number or word.
const AMOUNT_AFTER =
  /(?<![\d.,])([+-]?)\s?(\d{1,3}(?:[.,]\d{3})+|\d{1,12})\s?(?:d|dong|vnd|₫)(?![a-z0-9])/;
const AMOUNT_BEFORE = /(?<![a-z])vnd\s?([+-]?)\s?(\d{1,3}(?:[.,]\d{3})+|\d{1,12})(?![\d.,]\d)/;

function amountOf(plainText: string): { minor: number; sign: string } | null {
  const match = AMOUNT_AFTER.exec(plainText) ?? AMOUNT_BEFORE.exec(plainText);
  if (match === null) return null;
  const minor = Number((match[2] ?? '').replace(/[.,]/g, ''));
  if (!Number.isSafeInteger(minor) || minor < 1 || minor > LIMITS.AMOUNT_MINOR_MAX) return null;
  return { minor, sign: match[1] ?? '' };
}

const NAME_AFTER = {
  spend: ['tai', 'den', 'toi', 'cho'],
  income: ['tu'],
} as const;
const NAME_END = /[.,;:!\n(]| (?:luc|voi|so tien|vao|ngay|ma|qua|bang|thanh cong) /;

function counterpartyOf(original: string, plainText: string, direction: 'spend' | 'income') {
  for (const word of NAME_AFTER[direction]) {
    const keyword = new RegExp(`(?:^|[^a-z])${word}\\s+`).exec(plainText);
    if (keyword === null) continue;
    const start = keyword.index + keyword[0].length;
    const tail = original.slice(start);
    const end = NAME_END.exec(tail);
    const name = (end === null ? tail : tail.slice(0, end.index)).trim();
    if (name.length === 0 || /^\d/.test(name)) continue;
    return name.slice(0, 60);
  }
  return null;
}

export function parseNotification(raw: RawNotification): DetectedPayment | null {
  const source = CAPTURE_PACKAGES[raw.packageName];
  if (source === undefined) return null;

  const original = [raw.title, raw.text].filter((part) => part.trim() !== '').join('. ');
  const text = plain(original);
  if (NOISE.some((pattern) => pattern.test(text))) return null;

  const amount = amountOf(text);
  if (amount === null) return null;

  const income = INCOME.test(text);
  const spend = SPEND.test(text);
  let direction: 'spend' | 'income';
  if (income && spend) direction = amount.sign === '+' ? 'income' : 'spend';
  else if (income) direction = 'income';
  else if (spend) direction = 'spend';
  else return null;

  return {
    direction,
    amountMinor: amount.minor,
    currency: 'VND',
    counterparty: counterpartyOf(original.normalize('NFC'), text, direction),
    source,
    postTime: raw.postTime,
  };
}
