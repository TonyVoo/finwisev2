import { ReceiptCategoryKey } from '@expense-tracker/shared';
import { describe, expect, it } from 'vitest';
import { RECEIPT_CATEGORY_KEYS, parseReceiptText } from '../src/services/receiptParser.ts';

/**
 * Turning the text an OCR provider read off a receipt into suggestions. Pure, so every rule in
 * `docs/design/11-receipt-scan.md` is pinned here without a network. Anything the text does not
 * clearly say is `null`: a wrong suggestion costs more than a missing one.
 */

const TODAY = new Date('2026-10-20T12:00:00Z');
const parse = (text: string, currency = 'USD') =>
  parseReceiptText(text, { currency, today: TODAY });

describe('amount', () => {
  it('reads the line that says total', () => {
    const text = 'MILK MART\nMilk 2.50\nEggs 4.00\nTOTAL 6.50\nThank you';
    expect(parse(text).amountMinor).toBe(650);
  });

  it('skips subtotal, tax, cash and change lines', () => {
    const text = [
      'Cafe Rio',
      'Subtotal 10.00',
      'Tax 0.80',
      'Total 10.80',
      'Cash 20.00',
      'Change 9.20',
    ].join('\n');
    expect(parse(text).amountMinor).toBe(1080);
  });

  it('takes the last total when there are several', () => {
    const text = 'Total 5.00\nTip 1.00\nTotal due 6.00';
    expect(parse(text).amountMinor).toBe(600);
  });

  it('reads the amount on the next line when the label stands alone', () => {
    expect(parse('Shop\nTOTAL\n12.50').amountMinor).toBe(1250);
  });

  it('falls back to the largest amount when nothing says total', () => {
    expect(parse('Shop\nBread 3.20\nCheese 8.40').amountMinor).toBe(840);
  });

  it('reads Vietnamese total lines', () => {
    expect(parse('Cua hang\nTong cong: 150.000', 'VND').amountMinor).toBe(150000);
    expect(parse('Cua hang\nThanh toan 85.000', 'VND').amountMinor).toBe(85000);
  });

  it.each([
    ['1.234,50', 123450],
    ['1,234.50', 123450],
    ['12,50', 1250],
    ['12.50', 1250],
    ['1,234', 123400],
    ['0.99', 99],
  ])('reads %s in a two-decimal currency', (written, minor) => {
    expect(parse(`Total ${written}`).amountMinor).toBe(minor);
  });

  it('reads whole numbers in a zero-decimal currency', () => {
    expect(parse('Total 1,500', 'JPY').amountMinor).toBe(1500);
    expect(parse('Total 150.000', 'VND').amountMinor).toBe(150000);
  });

  it('ignores a currency symbol and code around the number', () => {
    expect(parse('TOTAL $12.50').amountMinor).toBe(1250);
    expect(parse('TOTAL USD 12.50').amountMinor).toBe(1250);
    expect(parse('TOTAL 12.50 USD').amountMinor).toBe(1250);
  });

  it('is null when there is no amount', () => {
    expect(parse('Just words here').amountMinor).toBeNull();
    expect(parse('').amountMinor).toBeNull();
  });

  it('is null for an amount of zero', () => {
    expect(parse('Total 0.00').amountMinor).toBeNull();
  });
});

describe('date', () => {
  it.each([
    ['2026-10-14', '2026-10-14'],
    ['14/10/2026', '2026-10-14'],
    ['10/14/2026', '2026-10-14'],
    ['14 Oct 2026', '2026-10-14'],
    ['Oct 14, 2026', '2026-10-14'],
    ['14-Oct-2026', '2026-10-14'],
    ['14.10.2026', '2026-10-14'],
    ['14/10/26', '2026-10-14'],
  ])('reads %s', (written, iso) => {
    expect(parse(`Shop\nDate: ${written}\nTotal 5.00`).date).toBe(iso);
  });

  it('puts the month first for US dollars when both parts could be a month', () => {
    expect(parse('Date 03/04/2026', 'USD').date).toBe('2026-03-04');
  });

  it('puts the day first for other currencies', () => {
    expect(parse('Date 03/04/2026', 'EUR').date).toBe('2026-04-03');
    expect(parse('Date 03/04/2026', 'VND').date).toBe('2026-04-03');
  });

  it('drops a date in the future', () => {
    expect(parse('Date 2026-10-22').date).toBeNull();
  });

  it('allows today and tomorrow, for a receipt printed across midnight', () => {
    expect(parse('Date 2026-10-20').date).toBe('2026-10-20');
    expect(parse('Date 2026-10-21').date).toBe('2026-10-21');
  });

  it('drops a date more than two years back', () => {
    expect(parse('Date 2024-10-01').date).toBeNull();
    expect(parse('Date 2024-10-21').date).toBe('2024-10-21');
  });

  it('drops an impossible date', () => {
    expect(parse('Date 31/02/2026').date).toBeNull();
    expect(parse('Date 2026-13-01').date).toBeNull();
  });

  it('ignores a time of day and a phone number', () => {
    expect(parse('Tel 555-123-4567\n14:35:10\nTotal 5.00').date).toBeNull();
  });
});

describe('merchant', () => {
  it('is the first line that reads as a name', () => {
    expect(parse('Milk Mart\n123 Main St\nTotal 5.00').merchant).toBe('Milk Mart');
  });

  it('skips boilerplate and number-only lines', () => {
    const text =
      'RECEIPT\n  \n0123456789\nTel: 555 1234\nwww.example.com\nBlue Bottle Coffee\nTotal 4.00';
    expect(parse(text).merchant).toBe('Blue Bottle Coffee');
  });

  it('is cut at 80 characters', () => {
    const long = 'A'.repeat(120);
    expect(parse(`${long}\nTotal 1.00`).merchant).toBe('A'.repeat(80));
  });

  it('is null when no line reads as a name', () => {
    expect(parse('12345\n67.89').merchant).toBeNull();
    expect(parse('').merchant).toBeNull();
  });

  it('only looks near the top of the receipt', () => {
    const text = `${'12345\n'.repeat(8)}Late Name\nTotal 1.00`;
    expect(parse(text).merchant).toBeNull();
  });
});

describe('category', () => {
  it.each([
    ['Fresh Supermarket\nMilk 2.00', 'groceries'],
    ['Sunrise Coffee House\nLatte 4.00', 'eating_out'],
    ['Joe Pizza Restaurant', 'eating_out'],
    ['Grab ride\nTrip 8.00', 'transport'],
    ['Shell Fuel Station', 'transport'],
    ['City Pharmacy\nAspirin', 'health'],
    ['Metro Electric Company\nBill', 'bills'],
  ])('%j suggests %s', (text, category) => {
    expect(parse(text).category).toBe(category);
  });

  it('is null when no keyword matches', () => {
    expect(parse('Acme Widgets\nWidget 5.00').category).toBeNull();
  });

  it('does not match inside another word', () => {
    // "bar" in "barcode" and "gas" in "vegas" are not a bar or a gas station.
    expect(parse('Barcode Vegas Ltd\nItem 5.00').category).toBeNull();
  });
});

describe('a whole receipt', () => {
  it('fills every field from one realistic text', () => {
    const text = [
      'FRESH SUPERMARKET',
      '12 High Street',
      'Tel 555 0100',
      '14/10/2026 18:42',
      'Milk 2L          2.50',
      'Eggs             4.00',
      'SUBTOTAL         6.50',
      'TAX              0.00',
      'TOTAL            6.50',
      'CARD             6.50',
    ].join('\n');

    expect(parse(text, 'EUR')).toEqual({
      amountMinor: 650,
      date: '2026-10-14',
      merchant: 'FRESH SUPERMARKET',
      category: 'groceries',
    });
  });
});

describe('the contract', () => {
  it('suggests only categories the contract names', () => {
    expect([...RECEIPT_CATEGORY_KEYS]).toEqual(ReceiptCategoryKey.options);
  });
});
