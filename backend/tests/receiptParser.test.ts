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

describe('lines that say total but are not the amount', () => {
  it.each([
    'Total items 3',
    'TOTAL ITEMS: 3',
    'Total qty 4',
    'Total savings 2.00',
    'TOTAL POINTS EARNED 120',
    'Total number of items 5',
  ])('skips %j', (noise) => {
    expect(parse(`Shop\nBread 3.20\n${noise}\nTOTAL 3.20`).amountMinor).toBe(320);
  });

  it('still falls back to the largest amount when only such lines say total', () => {
    expect(parse('Shop\nBread 3.20\nCheese 8.40\nTotal items 2').amountMinor).toBe(840);
  });

  it('reads a total tucked between item and payment lines', () => {
    const text = [
      'Cafe',
      'Latte 4.50',
      'Total items 1',
      'TOTAL DUE 4.50',
      'VISA ****1234 4.50',
    ].join('\n');
    expect(parse(text).amountMinor).toBe(450);
  });
});

describe('Vietnamese receipts', () => {
  it.each([
    ['Tiền mặt 200.000', 150000],
    ['Tiền thừa 50.000', 150000],
    ['Khách đưa 200.000', 150000],
  ])('skips %j as the total', (noise, expected) => {
    expect(parse(`Cua hang\nTong cong 150.000\n${noise}`, 'VND').amountMinor).toBe(expected);
  });

  it('reads the accented total line', () => {
    expect(parse('Cửa hàng\nTổng cộng: 150.000đ', 'VND').amountMinor).toBe(150000);
    expect(parse('Quán cơm\nTổng tiền 85.000 VND', 'VND').amountMinor).toBe(85000);
  });
});

describe('more date writings', () => {
  it.each([
    ['2026/10/14', '2026-10-14'],
    ['2026.10.14', '2026-10-14'],
    ['14th Oct 2026', '2026-10-14'],
    ['1st October 2026', '2026-10-01'],
    ['Oct 14 2026', '2026-10-14'],
    ['Wed 14 Oct 2026', '2026-10-14'],
    ['14 OCTOBER 2026', '2026-10-14'],
  ])('reads %s', (written, iso) => {
    expect(parse(`Shop\nDate: ${written}\nTotal 5.00`).date).toBe(iso);
  });

  it('prefers the first date on the page that is plausible', () => {
    // A due or expiry date later on the receipt is in the future and is dropped.
    expect(parse('Shop\nDate 2026-10-14\nValid until 2027-10-14\nTotal 5.00').date).toBe(
      '2026-10-14',
    );
  });
});

/**
 * A screenshot of a bank or e-wallet transfer confirmation read by OCR: the amount transferred, the day, and who it
 * went to - never the fee, the balance after, or the account number.
 */
describe('a transfer confirmation', () => {
  const momo = [
    'Chuyển tiền thành công',
    '1.500.000đ',
    'Số tiền: 1.500.000 VND',
    'Phí giao dịch: 0đ',
    'Người nhận: NGUYEN VAN A',
    'Nội dung: tien an trua',
    'Thời gian: 14:35 - 09/10/2026',
    'Mã giao dịch: 7788990011',
    'Số dư: 9.250.000đ',
  ].join('\n');

  it('takes the amount transferred, not the fee, the balance or the transaction code', () => {
    expect(parse(momo, 'VND').amountMinor).toBe(1_500_000);
  });

  it('reads the day first, as Vietnamese screens write it', () => {
    expect(parse(momo, 'VND').date).toBe('2026-10-09');
  });

  it('takes the recipient as the name, ahead of the success banner at the top', () => {
    expect(parse(momo, 'VND').merchant).toBe('NGUYEN VAN A');
  });

  it('reads a recipient on the line under its label', () => {
    const text = [
      'Giao dịch thành công',
      'Số tiền',
      '250.000 VND',
      'Tên người nhận',
      'CONG TY ABC',
      '10/10/2026',
    ].join('\n');
    const r = parse(text, 'VND');
    expect(r.amountMinor).toBe(250_000);
    expect(r.merchant).toBe('CONG TY ABC');
  });

  it('falls back to the message when no recipient is shown', () => {
    const text = [
      'Chuyển khoản thành công',
      'Số tiền: 80.000 VND',
      'Nội dung: ca phe sang',
      '10/10/2026',
    ].join('\n');
    expect(parse(text, 'VND').merchant).toBe('ca phe sang');
  });

  it('is English too', () => {
    const text = [
      'Transfer successful',
      'Amount: 2,000,000 VND',
      'Fee: 0 VND',
      'Recipient: LE THI B',
      '2026-10-08',
    ].join('\n');
    const r = parse(text, 'VND');
    expect(r).toMatchObject({ amountMinor: 2_000_000, merchant: 'LE THI B', date: '2026-10-08' });
  });

  it('leaves an ordinary receipt as it was', () => {
    expect(parse('MILK MART\nMilk 2.50\nTOTAL 6.50').merchant).toBe('MILK MART');
  });
});
