import { ASSISTANT_CONTEXT_MAX } from '@expense-tracker/shared';
import { buildDigest, holdingOf, type DigestInput } from '@/assistant/digest';

const base: DigestInput = {
  month: '2026-11',
  currency: 'VND',
  locale: 'vi-VN',
  spend: [
    {
      categoryId: 'a',
      name: 'Ăn uống',
      color: null,
      monthlyBudgetMinor: 3_000_000,
      totalMinor: 3_200_000,
      expenseCount: 20,
    },
    {
      categoryId: 'b',
      name: 'Đi lại',
      color: null,
      monthlyBudgetMinor: null,
      totalMinor: 800_000,
      expenseCount: 8,
    },
  ],
  incomeMinor: 15_000_000,
  limitMinor: 10_000_000,
  trend: [
    { month: '2026-10', totalMinor: 5_000_000 },
    { month: '2026-11', totalMinor: 4_000_000 },
  ],
  goals: [
    {
      id: 'g',
      name: 'Mua laptop',
      targetMinor: 30_000_000,
      savedMinor: 7_500_000,
      currency: 'VND',
      deadline: '2027-03-01',
      pending: false,
    },
  ],
  holdings: [],
  realized: 0,
  dividends: 0,
};

describe('buildDigest', () => {
  it('states the month, the totals, the limit and each category with its share', () => {
    const text = buildDigest(base);
    expect(text).toContain('Tháng 2026-11.');
    expect(text).toMatch(/Tổng chi: 4\.000\.000/);
    expect(text).toMatch(/Hạn mức chi cả tháng: 10\.000\.000/);
    expect(text).toMatch(/Ăn uống: 3\.200\.000.*\(80%, ngân sách 3\.000\.000/);
    expect(text).toMatch(/Đi lại: 800\.000.*\(20%\)/);
    expect(text).toMatch(/Mua laptop: 7\.500\.000.*\/ 30\.000\.000.*\(25%, hạn 2027-03-01\)/);
  });

  it('leaves out what there is none of', () => {
    const text = buildDigest({ ...base, spend: [], goals: [], limitMinor: null, trend: [] });
    expect(text).not.toMatch(
      /Hạn mức|Chi theo danh mục|Mục tiêu|Chi các tháng|Danh mục chứng khoán/,
    );
  });

  it('weighs holdings, values an unpriced one at cost and says it has no price', () => {
    const text = buildDigest({
      ...base,
      holdings: [
        { symbol: 'VNM', quantity: 100, cost: 5_000_000, marketValue: 6_000_000 },
        { symbol: 'ZZZ', quantity: 100, cost: 2_000_000, marketValue: null },
      ],
      realized: -100_000,
      dividends: 180_000,
    });
    expect(text).toMatch(/VNM: 100 cổ phiếu.*tỷ trọng 75%.*lãi\/lỗ chưa chốt .*1\.000\.000/);
    expect(text).toMatch(/ZZZ: .*tỷ trọng 25%, chưa có giá/);
    expect(text).toMatch(/Đã chốt lãi\/lỗ: -?.*100\.000.*Cổ tức đã nhận: .*180\.000/);
  });

  it('never exceeds the server cap and cuts at a whole line', () => {
    const many = Array.from({ length: 15 }, (_, i) => ({
      symbol: `S${i}`,
      quantity: 100,
      cost: 1_000_000,
      marketValue: 1_000_000,
    }));
    const goals = Array.from({ length: 8 }, (_, i) => ({
      ...base.goals[0]!,
      id: `g${i}`,
      name: `Mục tiêu rất dài ${'x'.repeat(600)} ${i}`,
    }));
    const text = buildDigest({ ...base, holdings: many, goals });
    expect(text.length).toBeLessThanOrEqual(ASSISTANT_CONTEXT_MAX);
    expect(text.endsWith('(đã lược bớt)')).toBe(true);
  });

  it('sends no notes or merchant text: only the fields it is given', () => {
    const text = buildDigest(base);
    expect(text).not.toMatch(/note|ghi chú/i);
  });
});

describe('holdingOf', () => {
  const position = {
    symbol: 'VNM',
    quantity: 100,
    cost: 5_000_000,
    avgCost: 50_000,
    realized: 0,
    dividends: 0,
    oversold: 0,
  };
  it('values at the close, or not at all', () => {
    expect(holdingOf(position, 56_000).marketValue).toBe(5_600_000);
    expect(holdingOf(position, null).marketValue).toBeNull();
  });
});
