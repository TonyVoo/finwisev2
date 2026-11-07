import type { TradeListItem } from '@/db/queries';
import {
  normalizeHeader,
  parseNumber,
  parseSide,
  parseTradeDate,
  planTradeImport,
} from '@/invest/importTrades';

describe('headers', () => {
  it('match loosely: case, diacritics and spacing do not matter', () => {
    expect(normalizeHeader('  Khối  lượng ')).toBe('khoi luong');
    expect(normalizeHeader('Mã CK')).toBe('ma ck');
    expect(normalizeHeader('Đơn giá')).toBe('don gia');
  });
});

describe('dates', () => {
  it.each([
    ['2026-11-04', '2026-11-04'],
    ['04/11/2026', '2026-11-04'],
    ['4-11-2026', '2026-11-04'],
    ['04.11.2026', '2026-11-04'],
    ['2026-11-04 09:15:00', '2026-11-04'],
  ])('reads %s', (input, expected) => expect(parseTradeDate(input)).toBe(expected));

  it.each(['', 'yesterday', '31/02/2026', '2026-13-01', '1/1/26'])('refuses %j', (input) =>
    expect(parseTradeDate(input)).toBeNull(),
  );
});

describe('numbers', () => {
  it.each([
    ['1.250.000', 1250000],
    ['1,250,000', 1250000],
    ['1 250 000', 1250000],
    ['56.8', 56.8],
    ['56,8', 56.8],
    ['1.250,50', 1250.5],
    ['1,250.50', 1250.5],
    ['100', 100],
    ['56.800', 56800],
    ['5.000 ₫', 5000],
  ])('reads %s', (input, expected) => expect(parseNumber(input)).toBeCloseTo(expected));

  it.each(['', 'abc', '--', '1.2.x'])('refuses %j', (input) =>
    expect(parseNumber(input)).toBeNull(),
  );
});

describe('sides', () => {
  it('reads Vietnamese and English words', () => {
    expect(['Mua', 'BUY', 'b'].map(parseSide)).toEqual(['buy', 'buy', 'buy']);
    expect(['Bán', 'Sell', 's'].map(parseSide)).toEqual(['sell', 'sell', 'sell']);
    expect(['Cổ tức', 'Dividend'].map(parseSide)).toEqual(['dividend', 'dividend']);
    expect(parseSide('hold')).toBeNull();
  });
});

const existing = (over: Partial<TradeListItem>): TradeListItem => ({
  id: 'e1',
  symbol: 'VNM',
  side: 'buy',
  quantity: 100,
  price: 56800,
  fee: 0,
  date: '2026-11-04',
  note: null,
  pending: false,
  ...over,
});

describe('planTradeImport', () => {
  const statement = [
    'Ngày GD,Mã CK,Loại lệnh,Khối lượng,Giá khớp,Phí,Thuế',
    '04/11/2026,VNM,Mua,"1,000",56.8,8520,0',
    '05/11/2026,fpt,Bán,200,"120,000",18000,18000',
    '06/11/2026,HPG,Mua,300,27500,,',
  ].join('\n');

  it('reads a Vietnamese statement: columns by name, prices in thousands scaled, fee and tax summed', () => {
    const plan = planTradeImport(statement, []);

    expect(plan.unreadable).toBe(false);
    expect(plan.skipped).toEqual([]);
    expect(plan.trades.map((t) => t.trade)).toEqual([
      { symbol: 'VNM', side: 'buy', quantity: 1000, price: 56800, fee: 8520, date: '2026-11-04' },
      { symbol: 'FPT', side: 'sell', quantity: 200, price: 120000, fee: 36000, date: '2026-11-05' },
      { symbol: 'HPG', side: 'buy', quantity: 300, price: 27500, fee: 0, date: '2026-11-06' },
    ]);
    expect(plan.trades.map((t) => t.scaled)).toEqual([true, false, false]);
    expect(plan.trades.map((t) => t.line)).toEqual([2, 3, 4]);
  });

  it('reads an English statement with semicolons and a note', () => {
    const plan = planTradeImport(
      'Date;Symbol;Side;Qty;Price;Fee;Note\n2026-11-04;VNM;Buy;100;56800;8520;#breakout',
      [],
    );
    expect(plan.trades[0]?.trade).toMatchObject({ symbol: 'VNM', note: '#breakout' });
  });

  it('reports each row it cannot read, by line and reason, and still takes the rest', () => {
    const plan = planTradeImport(
      [
        'date,symbol,side,quantity,price',
        'nope,VNM,buy,100,56800',
        '2026-11-04,V-N,buy,100,56800',
        '2026-11-04,VNM,swap,100,56800',
        '2026-11-04,VNM,buy,0,56800',
        '2026-11-04,VNM,buy,100,abc',
        '',
        '2026-11-04,VNM,buy,100,56800',
      ].join('\n'),
      [],
    );

    expect(plan.skipped).toEqual([
      { line: 2, reason: 'date' },
      { line: 3, reason: 'symbol' },
      { line: 4, reason: 'side' },
      { line: 5, reason: 'quantity' },
      { line: 6, reason: 'price' },
    ]);
    // Blank lines are dropped before reading, so a row is numbered by its place among the non-blank ones.
    expect(plan.trades.map((t) => t.line)).toEqual([7]);
  });

  it('leaves out what is already in the portfolio, one existing trade excusing one row', () => {
    const twice = [
      'date,symbol,side,quantity,price',
      '2026-11-04,VNM,buy,100,56800',
      '2026-11-04,VNM,buy,100,56800',
    ].join('\n');

    const plan = planTradeImport(twice, [existing({})]);

    expect(plan.skipped).toEqual([{ line: 2, reason: 'duplicate' }]);
    expect(plan.trades).toHaveLength(1);
    expect(planTradeImport(twice, [existing({}), existing({ id: 'e2' })]).trades).toEqual([]);
  });

  it('says so when there is no header it can read', () => {
    expect(planTradeImport('a,b,c\n1,2,3', []).unreadable).toBe(true);
    expect(planTradeImport('', []).unreadable).toBe(true);
    expect(planTradeImport('date,symbol,side,quantity\n2026-11-04,VNM,buy,1', []).unreadable).toBe(
      true,
    );
  });

  it('refuses a negative or oversized fee instead of storing it', () => {
    const plan = planTradeImport(
      'date,symbol,side,quantity,price,fee\n2026-11-04,VNM,buy,100,56800,-5',
      [],
    );
    expect(plan.skipped).toEqual([{ line: 2, reason: 'fee' }]);
  });
});
