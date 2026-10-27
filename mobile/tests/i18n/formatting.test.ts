import { applyLanguagePreference } from '@/i18n/apply';
import { monthLabel, monthName, monthShortLabel } from '@/lib/calendar';
import { formatMoney } from '@/lib/money';
import { relativeTime } from '@/lib/relativeTime';
import {
  categoryDeleteBody,
  categoryDeleted,
  emptyMonthHeadline,
  summaryExpenseCount,
  syncPillA11yLabel,
  syncPillLabel,
} from '@/copy/strings';

/**
 * Choosing a language changes how dates and money read, not just the words: someone who
 * picks Vietnamese on an English phone expects `11,19 US$` and `tháng 10`.
 */

afterEach(() => {
  applyLanguagePreference('en');
});

describe('amounts and dates follow the chosen language', () => {
  it('formats money the Vietnamese way, and back', () => {
    applyLanguagePreference('vi');
    // `Intl` puts a no-break space before the symbol, so a price never wraps from its unit.
    expect(formatMoney(1119, 'USD')).toBe('11,19\u00a0US$');
    expect(formatMoney(150000, 'VND')).toBe('150.000\u00a0₫');

    applyLanguagePreference('en');
    expect(formatMoney(1119, 'USD')).toBe('$11.19');
  });

  it('keeps an explicit locale argument, whatever the language', () => {
    applyLanguagePreference('vi');
    expect(formatMoney(1119, 'USD', 'en-US')).toBe('$11.19');
  });

  it('names months in Vietnamese', () => {
    applyLanguagePreference('vi');
    expect(monthLabel('2026-10')).toBe('tháng 10 năm 2026');
  });

  it('lower-cases a bare month name, because it is always inside a sentence', () => {
    applyLanguagePreference('vi');
    expect(monthName('2026-09')).toBe('tháng 9');
    applyLanguagePreference('en');
    expect(monthName('2026-09')).toBe('September');
  });

  it('abbreviates months in the chosen language', () => {
    applyLanguagePreference('vi');
    expect(monthShortLabel('2026-10')).toContain('10');
    applyLanguagePreference('en');
    expect(monthShortLabel('2026-10')).toBe('Oct');
  });

  it('writes a relative date in the chosen language', () => {
    applyLanguagePreference('vi');
    const now = new Date('2026-10-26T10:00:00.000Z');
    expect(relativeTime(new Date('2026-10-26T09:50:00.000Z'), now)).toBe('10 phút trước');
    expect(relativeTime(new Date('2026-10-10T09:50:00.000Z'), now)).toMatch(/^vào /);
  });
});

describe('the formatters speak Vietnamese too', () => {
  beforeEach(() => applyLanguagePreference('vi'));

  it('fills the count templates and leaves no placeholder behind', () => {
    const texts = [
      summaryExpenseCount(0),
      summaryExpenseCount(1),
      summaryExpenseCount(7),
      categoryDeleteBody(0, 'Chưa phân loại'),
      categoryDeleteBody(1, 'Chưa phân loại'),
      categoryDeleteBody(23, 'Chưa phân loại'),
      categoryDeleted('Ăn uống', 0, 'Chưa phân loại'),
      categoryDeleted('Ăn uống', 1, 'Chưa phân loại'),
      categoryDeleted('Ăn uống', 23, 'Chưa phân loại'),
      emptyMonthHeadline('tháng 10'),
      syncPillLabel('pending', 3) ?? '',
      syncPillA11yLabel('offline-pending', 1) ?? '',
      syncPillA11yLabel('offline-pending', 4) ?? '',
    ];
    for (const text of texts) {
      expect({ text, brace: /[{}]/.test(text) }).toEqual({ text, brace: false });
    }
    expect(summaryExpenseCount(7)).toBe('7 khoản chi');
    expect(categoryDeleteBody(23, 'Chưa phân loại')).toContain('23 khoản chi');
    expect(emptyMonthHeadline('tháng 10')).toBe('Không có gì trong tháng 10');
  });

  it('never reads a pending count as a plural form that does not exist', () => {
    expect(syncPillA11yLabel('offline-pending', 1)).toContain('1 thay đổi');
    expect(syncPillA11yLabel('offline-pending', 5)).toContain('5 thay đổi');
  });
});
