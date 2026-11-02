import {
  countSuggestions,
  dismiss,
  ingestNotifications,
  listRecent,
  listSuggestions,
  markAdded,
  pruneCaptured,
} from '@/capture/store';
import { migrate } from '@/db/migrations';
import { createTestDatabase, type TestDatabase } from '../support/sqlite';
import { categoryId, seedCategory, seedExpense, seedFallbackCategory } from '../support/seed';

const MOMO = 'com.mservice.momotransfer';
const T = new Date(2026, 10, 2, 12, 30).getTime();

let database: TestDatabase;
beforeEach(async () => {
  database = await createTestDatabase();
  await migrate(database);
});

const pay = (text: string, extra: object = {}) => ({
  packageName: MOMO,
  title: '',
  text,
  postTime: T,
  ...extra,
});

describe('reading notifications', () => {
  it('turns a payment into a suggestion and logs anything else as ignored', async () => {
    const added = await ingestNotifications(database, [
      pay('Thanh toán thành công 65.000đ tại Circle K'),
      pay('Nhập mã PROMO50 để được giảm 50%', { postTime: T + 1 }),
    ]);

    expect(added).toBe(1);
    expect(await countSuggestions(database)).toBe(1);
    const log = await listRecent(database);
    expect(log.map((row) => row.status).sort()).toEqual(['ignored', 'new']);
  });

  it('reads the same notification only once', async () => {
    const one = pay('Thanh toán thành công 65.000đ tại Circle K');
    await ingestNotifications(database, [one]);
    const again = await ingestNotifications(database, [one]);

    expect(again).toBe(0);
    expect(await countSuggestions(database)).toBe(1);
  });

  it('keeps nothing from any other app', async () => {
    await ingestNotifications(database, [
      { packageName: 'com.whatsapp', title: 'Mum', text: 'Thanh toán 50.000đ', postTime: T },
    ]);
    expect(await listRecent(database)).toEqual([]);
  });
});

describe('suggestions', () => {
  it('says when an entry for the same amount already exists on that day', async () => {
    await seedFallbackCategory(database);
    await seedCategory(database, { id: categoryId(1), name: 'Food', color: '#2F8044' });
    await seedExpense(database, {
      id: '0192f5a0-0000-7000-8000-0000000000e1',
      categoryId: categoryId(1),
      amountMinor: 65000,
      currency: 'VND',
      date: '2026-11-02',
    });
    await ingestNotifications(database, [
      pay('Thanh toán thành công 65.000đ tại Circle K'),
      pay('Thanh toán thành công 70.000đ tại Circle K', { postTime: T + 1 }),
    ]);

    const [seventy, sixtyFive] = await listSuggestions(database);
    expect(seventy).toMatchObject({ amountMinor: 70000, duplicate: false });
    expect(sixtyFive).toMatchObject({ amountMinor: 65000, duplicate: true });
  });

  it('leaves the list once added or dismissed', async () => {
    await ingestNotifications(database, [
      pay('Thanh toán thành công 65.000đ tại A'),
      pay('Thanh toán thành công 70.000đ tại B', { postTime: T + 1 }),
    ]);
    const [first, second] = await listSuggestions(database);

    await markAdded(database, first!.id, 'expense-1');
    await dismiss(database, second!.id);

    expect(await listSuggestions(database)).toEqual([]);
    const log = await listRecent(database);
    expect(log.find((row) => row.id === first!.id)).toMatchObject({
      status: 'added',
      expenseId: 'expense-1',
    });
  });
});

describe('pruning', () => {
  it('drops old log lines but never a waiting suggestion', async () => {
    await ingestNotifications(database, [
      pay('Thanh toán thành công 65.000đ tại A'),
      pay('Quảng cáo', { postTime: T + 1 }),
    ]);

    await pruneCaptured(database, T + 40 * 24 * 3600 * 1000);

    const log = await listRecent(database);
    expect(log.map((row) => row.status)).toEqual(['new']);
  });
});
