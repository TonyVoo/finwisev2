import type Feather from '@expo/vector-icons/Feather';
import type { ComponentProps } from 'react';

export type CategoryIconName = ComponentProps<typeof Feather>['name'];

export const CATEGORY_ICON_FALLBACK: CategoryIconName = 'tag';

/**
 * Keyword -> icon, first match wins. Keywords are lowercase with diacritics stripped, so
 * "Tạp hóa" is matched as `tap hoa`. The icon is derived from the name each time it is drawn:
 * nothing is stored, so a rename re-icons the category and existing data needs no migration.
 */
const RULES: ReadonlyArray<readonly [CategoryIconName, readonly string[]]> = [
  ['help-circle', ['uncategorized', 'chua phan loai']],
  ['shopping-cart', ['grocer', 'supermarket', 'tap hoa', 'sieu thi', 'cho']],
  ['coffee', ['eating', 'restaurant', 'food', 'coffee', 'cafe', 'dining', 'an ngoai', 'an uong']],
  ['navigation', ['transport', 'taxi', 'fuel', 'gas', 'di chuyen', 'xang', 'xe']],
  ['file-text', ['bill', 'utilit', 'rent', 'hoa don', 'dien', 'nuoc', 'tien nha']],
  ['heart', ['health', 'medic', 'doctor', 'pharmacy', 'suc khoe', 'thuoc']],
  ['film', ['entertain', 'movie', 'game', 'giai tri', 'phim']],
  ['shopping-bag', ['shopping', 'cloth', 'mua sam', 'quan ao']],
  ['book-open', ['education', 'school', 'book', 'giao duc', 'hoc']],
  ['gift', ['gift', 'qua tang']],
  ['home', ['home', 'house', 'nha']],
  ['briefcase', ['work', 'salary', 'income', 'cong viec', 'luong']],
];

function normalise(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .toLowerCase()
    .trim();
}

export function categoryIcon(name: string): CategoryIconName {
  const text = normalise(name);
  if (text === '') return CATEGORY_ICON_FALLBACK;
  const words = ` ${text} `;
  for (const [icon, keywords] of RULES) {
    // Short keywords (`cho`, `xe`, `gas`) only count as whole words, or "Chocolate" is a market.
    if (keywords.some((k) => (k.length <= 3 ? words.includes(` ${k} `) : text.includes(k)))) {
      return icon;
    }
  }
  return CATEGORY_ICON_FALLBACK;
}
