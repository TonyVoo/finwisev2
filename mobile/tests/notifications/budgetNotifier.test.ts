import { notificationKey, shouldNotify } from '../../src/notifications/budgetNotifier';
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
