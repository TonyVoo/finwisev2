import type { ReceiptCategoryKey } from './receipt.js';
import { ReceiptCategoryKey as ReceiptCategoryKeySchema } from './receipt.js';

/**
 * The words that point a piece of text at one of the five default categories, used wherever text is
 * guessed into a category: the receipt parser (OCR text, `docs/design/11-receipt-scan.md`) and quick add
 * (a typed sentence, `docs/design/15-quick-add.md`). One list, so the two cannot drift.
 *
 * Hints are lower-case and accent-free (see {@link foldText}), matched as whole words. A word belongs here
 * only if it is rare outside its meaning: `com` (rice) would match every `.com` on a receipt, `nuoc` (water)
 * every soft drink, and `hoa don` (invoice) every receipt, so none of those are hints.
 */

export const CATEGORY_HINTS: Readonly<Record<ReceiptCategoryKey, readonly string[]>> = {
  groceries: [
    'supermarket',
    'hypermarket',
    'minimart',
    'grocery',
    'groceries',
    'mart',
    'market',
    'costco',
    'walmart',
    'aldi',
    'lidl',
    'tesco',
    'butcher',
    'vegetables',
    'fruit',
    'sieu thi',
    'tap hoa',
    'rau',
    'thit',
    'trai cay',
  ],
  eating_out: [
    'restaurant',
    'cafe',
    'coffee',
    'pizza',
    'burger',
    'bistro',
    'diner',
    'grill',
    'kitchen',
    'bakery',
    'bar',
    'pub',
    'noodle',
    'pho',
    'sushi',
    'bbq',
    'breakfast',
    'brunch',
    'lunch',
    'dinner',
    'snack',
    'tea',
    'boba',
    'ca phe',
    'tra sua',
    'an sang',
    'an trua',
    'an toi',
    'an vat',
    'banh mi',
    'nha hang',
    'quan an',
  ],
  transport: [
    'taxi',
    'uber',
    'grab',
    'lyft',
    'fuel',
    'petrol',
    'gasoline',
    'gas',
    'parking',
    'toll',
    'subway',
    'airline',
    'bus',
    'train',
    'flight',
    'gojek',
    'xang',
    'xe om',
    've xe',
    'xe bus',
  ],
  health: [
    'pharmacy',
    'drugstore',
    'clinic',
    'hospital',
    'dental',
    'dentist',
    'medical',
    'doctor',
    'optical',
    'vitamin',
    'vitamins',
    'thuoc',
    'benh vien',
    'phong kham',
    'nha khoa',
    'kham benh',
  ],
  bills: [
    'electric',
    'electricity',
    'water',
    'internet',
    'telecom',
    'broadband',
    'utility',
    'utilities',
    'insurance',
    'rent',
    'wifi',
    'tien nha',
    'tien dien',
    'tien nuoc',
    'tien net',
  ],
};

/**
 * Lower-case and without accents, **one character for each**, so an index in the folded text is the same
 * index in the original (a parser can mask a span of the sentence it matched and keep the rest).
 * Characters with no plain-letter form are left as they are.
 */
export function foldText(text: string): string {
  let folded = '';
  for (const character of text) {
    if (character === 'đ' || character === 'Đ') {
      folded += 'd';
      continue;
    }
    const base = character.normalize('NFD').replace(/\p{M}+/gu, '');
    const lower = base.toLowerCase();
    folded += lower.length === character.length ? lower : character;
  }
  return folded;
}

/** The category whose hints appear most in `text`, or null. A tie goes to the earlier (more specific) key. */
export function categoryKeyFor(text: string): ReceiptCategoryKey | null {
  const folded = foldText(text);
  let best: ReceiptCategoryKey | null = null;
  let bestCount = 0;
  for (const key of ReceiptCategoryKeySchema.options) {
    const count = CATEGORY_HINTS[key].filter((hint) =>
      new RegExp(`(?<![a-z0-9])${hint}(?![a-z0-9])`).test(folded),
    ).length;
    if (count > bestCount) {
      best = key;
      bestCount = count;
    }
  }
  return best;
}
