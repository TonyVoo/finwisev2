import { parseQuickAdd, type QuickAddContext } from '@/quickAdd/parseQuickAdd';

/**
 * Reading a typed sentence into an expense (`docs/design/15-quick-add.md`). The table below is the
 * specification: each row is a sentence a person might type and what must come out of it, English and
 * Vietnamese. The rule it shows most often is the cautious one: when the sentence does not clearly say,
 * the answer is "unsure" (no amount, `confident: false`), never a guess.
 *
 * `today` is Monday 2026-11-02 throughout, so every weekday and "yesterday" has one answer.
 */

const CATEGORIES = ['Groceries', 'Eating out', 'Transport', 'Health', 'Bills', 'Pets'].map(
  (name) => ({ id: name, name }),
);
const TODAY = '2026-11-02';
const USD: QuickAddContext = { currency: 'USD', today: TODAY, categories: CATEGORIES };
const VND: QuickAddContext = { currency: 'VND', today: TODAY, categories: CATEGORIES };

type Row = [text: string, expected: Record<string, unknown>];

function check(context: QuickAddContext, rows: readonly Row[]) {
  it.each(rows)('%s', (text, expected) => {
    expect(parseQuickAdd(text, context)).toMatchObject(expected);
  });
}

describe('dollars (two decimals)', () => {
  check(USD, [
    [
      'coffee 4.50',
      {
        amountMinor: 450,
        date: null,
        note: 'Coffee',
        categoryId: 'Eating out',
        type: 'expense',
        confident: true,
      },
    ],
    ['coffee $4.5 yesterday', { amountMinor: 450, date: '2026-11-01', note: 'Coffee' }],
    ['lunch 12', { amountMinor: 1200, note: 'Lunch', categoryId: 'Eating out', confident: true }],
    [
      'groceries 56.20 on 28/10',
      { amountMinor: 5620, date: '2026-10-28', note: 'Groceries', categoryId: 'Groceries' },
    ],
    [
      'uber 23.40 last friday',
      { amountMinor: 2340, date: '2026-10-30', note: 'Uber', categoryId: 'Transport' },
    ],
    ['rent 1.5k', { amountMinor: 150000, note: 'Rent', categoryId: 'Bills' }],
    ['spent 45 on gas', { amountMinor: 4500, note: 'Gas', categoryId: 'Transport' }],
    [
      'pharmacy 8.99 today',
      { amountMinor: 899, date: '2026-11-02', note: 'Pharmacy', categoryId: 'Health' },
    ],
    [
      'dinner at pho 24 monday',
      { amountMinor: 2400, date: '2026-11-02', note: 'Dinner at pho', categoryId: 'Eating out' },
    ],
    ['gym 40 14/10/2026', { amountMinor: 4000, date: '2026-10-14', note: 'Gym' }],
    [
      'water bill 32.10 11/1',
      { amountMinor: 3210, date: '2026-11-01', note: 'Water bill', categoryId: 'Bills' },
    ],
    ['9am coffee 3', { amountMinor: 300, note: 'Coffee' }],
    ['tea 3 dollars', { amountMinor: 300, note: 'Tea', categoryId: 'Eating out' }],
    ['coffee 45k', { amountMinor: 4500000 }],
  ]);
});

describe('income', () => {
  check(USD, [
    [
      'salary 3000 on 1 nov',
      { type: 'income', amountMinor: 300000, date: '2026-11-01', note: 'Salary' },
    ],
    ['+250 freelance', { type: 'income', amountMinor: 25000, note: 'Freelance' }],
    ['got paid 1,200.50', { type: 'income', amountMinor: 120050, note: null }],
  ]);
  check(VND, [
    ['lương 15tr', { type: 'income', amountMinor: 15000000, note: 'Lương' }],
    ['Salary 20tr', { type: 'income', amountMinor: 20000000 }],
  ]);
});

describe("the person's own categories", () => {
  check(USD, [
    ['pets 200', { amountMinor: 20000, note: 'Pets', categoryId: 'Pets' }],
    ['pets groceries 20', { categoryId: 'Groceries' }],
  ]);
});

describe('when the sentence does not clearly say', () => {
  check(USD, [
    ['coffee 4.50 tip 1.00', { amountMinor: null, confident: false, categoryId: 'Eating out' }],
    // Two bare numbers: a quantity and a price, or two prices? Only a clear amount settles it.
    ['2 coffees 9', { amountMinor: null, confident: false }],
    ['coffee 3 and bagel 4', { amountMinor: null, confident: false }],
    ['2 coffees 9.50', { amountMinor: 950, confident: true }],
    ['bought a $5 coffee and a $7 sandwich', { amountMinor: null, confident: false }],
    ['hello', { amountMinor: null, confident: false, note: 'Hello', type: 'expense' }],
    ['', { amountMinor: null, date: null, note: null, categoryId: null, confident: false }],
    ['    ', { amountMinor: null, note: null, confident: false }],
    ['!!!', { amountMinor: null, note: null, categoryId: null, confident: false }],
    ['??? - ,', { note: null }],
    ['house 99999999999999', { amountMinor: null, confident: false }],
  ]);
  check(VND, [
    // A bare number under a thousand might be 45 dong or 45k: not a thing to guess.
    ['cafe 45', { amountMinor: null, confident: false, categoryId: 'Eating out' }],
    ['cafe 12.5', { amountMinor: null, confident: false }],
  ]);
});

describe('dates', () => {
  check(USD, [
    ['coffee 3 tuesday', { date: '2026-10-27' }],
    ['coffee 3 last monday', { date: '2026-10-26' }],
    ['coffee 3 sunday', { date: '2026-11-01' }],
    ['coffee 3 day before yesterday', { date: '2026-10-31' }],
    // United States order is month first, and a day above 12 can only be a day.
    ['coffee 3 10/11', { date: '2026-10-11' }],
    // Never after today, and never more than two years back.
    ['movie 15 5 nov', { amountMinor: 1500, date: null, note: 'Movie' }],
    ['old 10 1/1/2020', { amountMinor: 1000, date: null }],
  ]);

  it('reads a day near New Year as last year, when that is the recent one', () => {
    expect(parseQuickAdd('taxi 18 28/12', { ...USD, today: '2026-01-03' })).toMatchObject({
      amountMinor: 1800,
      date: '2025-12-28',
    });
  });

  check(VND, [
    ['10/11 cafe 30k', { amountMinor: 30000, date: null }],
    ['ăn tối 250k 14/10', { amountMinor: 250000, date: '2026-10-14', note: 'Ăn tối' }],
  ]);
});

describe('Vietnamese, dong (no decimals)', () => {
  check(VND, [
    [
      'cà phê 45k',
      { amountMinor: 45000, date: null, note: 'Cà phê', categoryId: 'Eating out', confident: true },
    ],
    [
      'ăn trưa 50k hôm qua',
      { amountMinor: 50000, date: '2026-11-01', note: 'Ăn trưa', categoryId: 'Eating out' },
    ],
    ['grab 120.000', { amountMinor: 120000, note: 'Grab', categoryId: 'Transport' }],
    ['tiền nhà 3tr5', { amountMinor: 3500000, note: 'Tiền nhà', categoryId: 'Bills' }],
    [
      'mua rau 85 nghìn hôm kia',
      { amountMinor: 85000, date: '2026-10-31', note: 'Rau', categoryId: 'Groceries' },
    ],
    [
      'đổ xăng 70k thứ sáu',
      { amountMinor: 70000, date: '2026-10-30', note: 'Đổ xăng', categoryId: 'Transport' },
    ],
    ['trà sữa 2 ly 60k', { amountMinor: 60000, note: 'Trà sữa 2 ly', categoryId: 'Eating out' }],
    ['thuốc cảm 35.000đ', { amountMinor: 35000, note: 'Thuốc cảm', categoryId: 'Health' }],
    [
      'tiền điện tháng 10 650k',
      { amountMinor: 650000, note: 'Tiền điện tháng 10', categoryId: 'Bills' },
    ],
    ['1.5tr tiền nhà', { amountMinor: 1500000, note: 'Tiền nhà' }],
    ['ngày 14 tháng 10 mua sách 120k', { amountMinor: 120000, date: '2026-10-14', note: 'Sách' }],
    [
      'chủ nhật ăn phở 55k',
      { amountMinor: 55000, date: '2026-11-01', note: 'Ăn phở', categoryId: 'Eating out' },
    ],
    ['xem phim 2 vé 200k', { amountMinor: 200000, note: 'Xem phim 2 vé' }],
    ['cà phê 25.000', { amountMinor: 25000 }],
    ['1,5tr', { amountMinor: 1500000, note: null }],
    ['cafe 30k hôm nay lúc 9:30', { amountMinor: 30000, date: '2026-11-02', note: 'Cafe' }],
    ['45000', { amountMinor: 45000, note: null, confident: true }],
  ]);
});

describe('the note', () => {
  it('is cut to the 500 characters an expense note may hold', () => {
    const result = parseQuickAdd(`${'a'.repeat(600)} 5`, USD);
    expect(result.note).toHaveLength(500);
    expect(result.amountMinor).toBe(500);
  });
});

describe('what it never does', () => {
  it('reads the same sentence the same way every time', () => {
    const once = parseQuickAdd('coffee 4.50 yesterday', USD);
    expect(parseQuickAdd('coffee 4.50 yesterday', USD)).toEqual(once);
  });

  it('never returns a date after today', () => {
    for (const text of ['x 5 3/11', 'x 5 tomorrow', 'x 5 31/12', 'x 5 2030-01-01']) {
      const { date } = parseQuickAdd(text, USD);
      expect(date === null || date <= TODAY).toBe(true);
    }
  });
});
