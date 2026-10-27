import { migrate } from '../../src/db/migrations';
import {
  notificationKey,
  notifyBudgetAlert,
  shouldNotify,
} from '../../src/notifications/budgetNotifier';
import { createTestDatabase, type TestDatabase } from '../support/sqlite';
import type { BudgetAlert } from '../../src/summary/budgetAlerts';

const near: BudgetAlert = { level: 'near', names: ['Food'], key: 'near:Food' };
const over: BudgetAlert = { level: 'over', names: ['Food'], key: 'over:Food' };

describe('shouldNotify', () => {
  it('stays quiet without an alert', () => {
    expect(shouldNotify('2026-10', null, null)).toBe(false);
  });

  it('announces a new alert', () => {
    expect(shouldNotify('2026-10', near, null)).toBe(true);
  });

  it('does not repeat the same alert', () => {
    expect(shouldNotify('2026-10', near, notificationKey('2026-10', near))).toBe(false);
  });

  it('announces again when near becomes over', () => {
    expect(shouldNotify('2026-10', over, notificationKey('2026-10', near))).toBe(true);
  });

  it('announces the same situation again in a new month', () => {
    expect(shouldNotify('2026-11', near, notificationKey('2026-10', near))).toBe(true);
  });
});

describe('notifyBudgetAlert', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Notifications = require('expo-notifications') as {
    scheduleNotificationAsync: jest.Mock;
    getPermissionsAsync: jest.Mock;
    requestPermissionsAsync: jest.Mock;
  };
  let database: TestDatabase;

  beforeEach(async () => {
    jest.clearAllMocks();
    Notifications.getPermissionsAsync.mockResolvedValue({ granted: true, canAskAgain: true });
    database = createTestDatabase();
    await migrate(database);
  });

  afterEach(() => database.close());

  it('notifies once for the same situation', async () => {
    expect(await notifyBudgetAlert(database, '2026-10', near)).toBe(true);
    expect(await notifyBudgetAlert(database, '2026-10', near)).toBe(false);
    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
  });

  it('notifies again when the level worsens', async () => {
    await notifyBudgetAlert(database, '2026-10', near);
    expect(await notifyBudgetAlert(database, '2026-10', over)).toBe(true);
    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(2);
  });

  it('does not ask again once the person has refused', async () => {
    Notifications.getPermissionsAsync.mockResolvedValue({ granted: false, canAskAgain: false });
    expect(await notifyBudgetAlert(database, '2026-10', near)).toBe(false);
    expect(await notifyBudgetAlert(database, '2026-10', near)).toBe(false);
    expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
    expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled();
  });

  it('asks for permission when it can, and notifies if granted', async () => {
    Notifications.getPermissionsAsync.mockResolvedValue({ granted: false, canAskAgain: true });
    Notifications.requestPermissionsAsync.mockResolvedValue({ granted: true });
    expect(await notifyBudgetAlert(database, '2026-10', near)).toBe(true);
  });

  it('does nothing without an alert', async () => {
    expect(await notifyBudgetAlert(database, '2026-10', null)).toBe(false);
  });
});
