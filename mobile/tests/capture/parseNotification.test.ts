import {
  CAPTURE_PACKAGES,
  parseNotification,
  type RawNotification,
} from '@/capture/parseNotification';

/**
 * Reading a MoMo or ZaloPay notification as a payment to suggest. The wording below is what these apps are
 * known to use, written without relying on exact phrases: the parser looks for an amount in dong and for words
 * that say which way the money went, and says nothing about anything else (codes, promotions, reminders).
 */

const MOMO = 'com.mservice.momotransfer';
const ZALO = 'vn.com.vng.zalopay';

function note(text: string, title = '', packageName = MOMO): RawNotification {
  return { packageName, title, text, postTime: Date.UTC(2026, 10, 2, 5, 30) };
}

describe('which apps are read', () => {
  it('names MoMo and ZaloPay, and nothing else', () => {
    expect(Object.keys(CAPTURE_PACKAGES).sort()).toEqual([MOMO, ZALO].sort());
  });

  it('ignores a notification from any other app', () => {
    expect(
      parseNotification(note('Thanh toán 50.000đ tại Circle K', '', 'com.whatsapp')),
    ).toBeNull();
  });
});

describe('a payment you made', () => {
  it.each([
    ['Bạn đã thanh toán thành công 65.000đ tại HighLands Coffee', 65000, 'HighLands Coffee'],
    ['Thanh toán thành công 120,000 VND cho Grab', 120000, 'Grab'],
    ['Bạn đã chuyển 500.000đ đến Nguyễn Văn A', 500000, 'Nguyễn Văn A'],
    ['Giao dịch thành công: -45.000₫ tại Circle K.', 45000, 'Circle K'],
  ])('reads %s', (text, amountMinor, counterparty) => {
    expect(parseNotification(note(text))).toMatchObject({
      direction: 'spend',
      amountMinor,
      currency: 'VND',
      counterparty,
      source: 'MoMo',
    });
  });

  it('reads the title and the text together, and the app from the package', () => {
    const result = parseNotification(
      note('Số tiền 89.000đ, tại Phúc Long', 'Thanh toán thành công', ZALO),
    );
    expect(result).toMatchObject({
      direction: 'spend',
      amountMinor: 89000,
      counterparty: 'Phúc Long',
      source: 'ZaloPay',
    });
  });

  it('keeps the time the notification arrived', () => {
    expect(parseNotification(note('Thanh toán 10.000đ tại X'))?.postTime).toBe(
      Date.UTC(2026, 10, 2, 5, 30),
    );
  });
});

describe('money you received', () => {
  it.each([
    ['Bạn đã nhận 2.000.000đ từ Công Ty ABC', 2000000, 'Công Ty ABC'],
    ['Bạn nhận được +300.000 VND từ Trần B', 300000, 'Trần B'],
    ['Hoàn tiền 25.000đ từ Shopee', 25000, 'Shopee'],
  ])('reads %s', (text, amountMinor, counterparty) => {
    expect(parseNotification(note(text))).toMatchObject({
      direction: 'income',
      amountMinor,
      counterparty,
    });
  });
});

describe('what is not a payment', () => {
  it.each([
    'Mã xác thực (OTP) của bạn là 839201. Không chia sẻ mã này.',
    'Ưu đái: Giảm 50.000đ cho đơn hàng đầu tiên. Nhập mã PROMO50!',
    'Hóa đơn tiền điện 450.000đ sắp đến hạn. Thanh toán ngay!',
    'Bạn có 3 voucher sắp hết hạn, tổng giá trị 100.000đ',
    'Đăng nhập thành công trên thiết bị mới',
    'Ví của bạn có 1.200.000đ',
  ])('says nothing about %s', (text) => {
    expect(parseNotification(note(text))).toBeNull();
  });

  it('says nothing when there is no amount in dong', () => {
    expect(parseNotification(note('Bạn đã thanh toán thành công'))).toBeNull();
  });

  it('does not take a long number such as a reference for an amount', () => {
    expect(
      parseNotification(note('Thanh toán thành công. Mã giao dịch 123456789012 tại X, 20.000đ')),
    ).toMatchObject({ amountMinor: 20000 });
  });
});

describe('amounts in their usual spellings', () => {
  it.each([
    ['Thanh toán 1.250.000đ tại X', 1250000],
    ['Thanh toán 1,250,000 VND tại X', 1250000],
    ['Thanh toán 1250000đ tại X', 1250000],
    ['Thanh toán VND 5.000 tại X', 5000],
    ['Thanh toán 5.000 đồng tại X', 5000],
    ['Thanh toán 5.000 vnđ tại X', 5000],
  ])('reads %s', (text, amountMinor) => {
    expect(parseNotification(note(text))?.amountMinor).toBe(amountMinor);
  });
});
