import { yearReportHtml } from '@/year/yearReportHtml';
import { buildYearReport } from '@/year/yearReport';

const report = buildYearReport({
  year: 2026,
  todayMonth: '2026-12',
  spendByMonth: [{ month: '2026-03', totalMinor: 12345 }],
  incomeByMonth: [{ month: '2026-03', totalMinor: 50000 }],
  categories: [
    {
      categoryId: 'a',
      name: '<b>Food</b> & drink',
      color: '#112233',
      monthlyBudgetMinor: null,
      totalMinor: 12345,
      expenseCount: 1,
    },
  ],
  previousCategories: [],
});

describe('the year report as a document', () => {
  const html = yearReportHtml(report, 'USD', 'en');

  it('is a complete page with the year as its title', () => {
    expect(html).toMatch(/^<!doctype html>/i);
    expect(html).toContain('<title>');
    expect(html).toContain('2026');
  });

  it('shows the amounts formatted for the currency', () => {
    expect(html).toContain('$123.45');
    expect(html).toContain('$500.00');
  });

  it('lists every month', () => {
    expect(html.match(/class="month"/g)).toHaveLength(12);
  });

  it('escapes what the person typed, so a category name cannot become markup', () => {
    expect(html).not.toContain('<b>Food</b>');
    expect(html).toContain('&lt;b&gt;Food&lt;/b&gt; &amp; drink');
  });
});
