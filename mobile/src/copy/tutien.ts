/**
 * The words of the cultivation ("tu tiên") skin: a handful of headings and labels renamed in the voice of a
 * cultivation novel, laid over the language in use while that appearance is chosen.
 *
 * Only names are changed, never anything a person needs to read to act on their money: amounts, dates, buttons that
 * save or delete, errors and every sentence with a figure in it stay as they are. Each key must already exist in the
 * app's copy and keep its `{placeholders}` (`tests/copy/tutien.test.ts`), so an overlay cannot add a string the app does
 * not render, or lose a number from one it does.
 */

type Overlay = { readonly [key: string]: string | Overlay };

export const TUTIEN_VI: Overlay = {
  home: {
    title: 'Linh thạch',
    total: { current: 'Linh thạch tiêu hao tháng này', other: 'Linh thạch tiêu hao' },
  },
  summary: { title: 'Đạo cảnh', suggest: { title: 'Thiên cơ ngân sách' } },
  invest: { title: 'Thiên cơ' },
  settings: { title: 'Động phủ' },
  goals: { title: 'Đột phá cảnh giới' },
  portfolio: { title: 'Tàng bảo các' },
  assistant: { title: 'Hỏi thiên cơ', placeholder: 'Tìm khoản chi hoặc hỏi thiên cơ' },
  notifications: {
    title: 'Truyền âm phù',
    open: 'Truyền âm phù',
    openNew: 'Truyền âm phù, {count} mới',
  },
  netWorth: { title: 'Căn cơ' },
};

export const TUTIEN_EN: Overlay = {
  home: {
    title: 'Lingshi',
    total: { current: 'Spirit stones spent this month', other: 'Spirit stones spent' },
  },
  summary: { title: 'Dao Realm', suggest: { title: 'Heavenly budget omens' } },
  invest: { title: 'Heaven’s Secrets' },
  settings: { title: 'Cave Abode' },
  goals: { title: 'Breakthroughs' },
  portfolio: { title: 'Treasure Pavilion' },
  assistant: { title: 'Ask the Heavens', placeholder: 'Search expenses or ask the heavens' },
  notifications: {
    title: 'Talisman Inbox',
    open: 'Talisman Inbox',
    openNew: 'Talisman Inbox, {count} new',
  },
  netWorth: { title: 'Foundation' },
};

/** The cultivation realms, from the first breath to ascension: what a savings goal is called as it fills. */
export const REALMS_VI = [
  'Luyện Khí',
  'Trúc Cơ',
  'Kim Đan',
  'Nguyên Anh',
  'Hóa Thần',
  'Phi Thăng',
] as const;
export const REALMS_EN = [
  'Qi Refining',
  'Foundation',
  'Golden Core',
  'Nascent Soul',
  'Spirit Transformation',
  'Ascension',
] as const;

/** Which realm a goal is in at `percent` saved (0-100): a fifth of the way per realm, the last for a goal reached. */
export function realmIndex(percent: number): number {
  if (percent >= 100) return REALMS_VI.length - 1;
  return Math.max(0, Math.min(REALMS_VI.length - 2, Math.floor(percent / 20)));
}
