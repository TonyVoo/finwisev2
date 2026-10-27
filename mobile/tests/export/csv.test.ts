import {
  CSV_HEADER,
  buildExpensesCsv,
  csvText,
  exportFileName,
  plainAmount,
  type ExportExpense,
} from '@/export/csv';

/**
 * The CSV format. Each case is a way an exporter produces a file that opens wrong, so the
 * assertions are on the bytes and not on a round trip through a parser of our own.
 */

const two = () => 2;

function expense(overrides: Partial<ExportExpense> = {}): ExportExpense {
  return {
    date: '2026-10-08',
    amountMinor: 1250,
    currency: 'USD',
    categoryName: 'Groceries',
    note: null,
    ...overrides,
  };
}

describe('plainAmount', () => {
  it.each([
    [1250, 2, '12.50'],
    [5, 2, '0.05'],
    [0, 2, '0.00'],
    [100, 2, '1.00'],
    [1250, 0, '1250'],
    [1234, 3, '1.234'],
    [999_999_999_999, 2, '9999999999.99'],
  ])('writes %i at %i decimals as %s, from the integer and not a float', (minor, d, expected) => {
    expect(plainAmount(minor, d)).toBe(expected);
  });

  it('keeps the sign on a negative amount', () => {
    expect(plainAmount(-1250, 2)).toBe('-12.50');
  });
});

describe('csvText', () => {
  it('leaves a plain field alone', () => {
    expect(csvText('Groceries')).toBe('Groceries');
  });

  it.each([
    ['a,b', '"a,b"'],
    ['say "hi"', '"say ""hi"""'],
    ['line\nbreak', '"line\nbreak"'],
    ['line\r\nbreak', '"line\r\nbreak"'],
  ])('quotes %j per RFC 4180', (input, expected) => {
    expect(csvText(input)).toBe(expected);
  });

  it.each(['=1+1', '+1', '-1', '@SUM(A1)', '\tx', '\rx'])(
    'defuses %j with a leading apostrophe so a spreadsheet does not run it',
    (input) => {
      expect(csvText(input).replace(/^"/, '').startsWith("'")).toBe(true);
    },
  );

  it('defuses and quotes a formula that also needs quoting', () => {
    expect(csvText('=HYPERLINK("http://x","y"),z')).toBe(`"'=HYPERLINK(""http://x"",""y""),z"`);
  });
});

describe('buildExpensesCsv', () => {
  it('starts with a UTF-8 byte-order mark and the header, and ends with a CRLF', () => {
    const csv = buildExpensesCsv([], two);
    expect(csv).toBe(`﻿${CSV_HEADER.join(',')}\r\n`);
  });

  it('writes one CRLF-separated record per expense, in the order given', () => {
    const csv = buildExpensesCsv(
      [expense(), expense({ date: '2026-10-09', amountMinor: 5, note: 'Coffee, large' })],
      two,
    );
    expect(csv.split('\r\n')).toEqual([
      `﻿Date,Amount,Currency,Category,Note,Type`,
      '2026-10-08,12.50,USD,Groceries,,expense',
      '2026-10-09,0.05,USD,Groceries,"Coffee, large",expense',
      '',
    ]);
  });

  it('uses each currency’s own decimals', () => {
    const csv = buildExpensesCsv([expense({ currency: 'JPY', amountMinor: 1250 })], (currency) =>
      currency === 'JPY' ? 0 : 2,
    );
    expect(csv).toContain('2026-10-08,1250,JPY,');
  });

  it('keeps non-ASCII text intact', () => {
    expect(buildExpensesCsv([expense({ note: 'Café – crème' })], two)).toContain('Café – crème');
  });

  it('defuses a malicious note and category name', () => {
    const csv = buildExpensesCsv([expense({ categoryName: '=cmd()', note: '+1+1' })], two);
    expect(csv).toContain(",'=cmd(),'+1+1,expense\r\n");
  });
});

describe('exportFileName', () => {
  it('uses the local calendar date', () => {
    expect(exportFileName(new Date(2026, 9, 6, 23, 59))).toBe('expenses-2026-10-06.csv');
  });
});

describe('income rows', () => {
  it('marks income in the trailing Type column', () => {
    const csv = buildExpensesCsv(
      [
        {
          date: '2026-10-01',
          amountMinor: 250000,
          currency: 'USD',
          categoryName: 'Salary',
          note: null,
          kind: 'income',
        },
      ],
      () => 2,
    );
    expect(csv).toContain('2026-10-01,2500.00,USD,Salary,,income\r\n');
  });
});
