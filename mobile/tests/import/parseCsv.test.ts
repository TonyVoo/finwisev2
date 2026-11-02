import { parseCsv } from '@/import/parseCsv';

describe('parseCsv', () => {
  it('reads rows and fields, with LF or CRLF between records', () => {
    expect(parseCsv('a,b,c\r\n1,2,3\n4,5,6')).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
      ['4', '5', '6'],
    ]);
  });

  it('reads quoted fields with commas, doubled quotes and line breaks', () => {
    expect(parseCsv('a,"b, c","say ""hi""","x\ny"\n')).toEqual([['a', 'b, c', 'say "hi"', 'x\ny']]);
  });

  it('drops a byte-order mark and blank lines', () => {
    expect(parseCsv('﻿a,b\r\n\r\n1,2\r\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('keeps empty fields', () => {
    expect(parseCsv('a,,c\n,,')).toEqual([
      ['a', '', 'c'],
      ['', '', ''],
    ]);
  });

  it('reads a semicolon-separated file, as spreadsheets in many locales write it', () => {
    expect(parseCsv('Date;Amount\n05/10/2026;12,50')).toEqual([
      ['Date', 'Amount'],
      ['05/10/2026', '12,50'],
    ]);
  });

  it('reads nothing from an empty file', () => {
    expect(parseCsv('')).toEqual([]);
  });
});
