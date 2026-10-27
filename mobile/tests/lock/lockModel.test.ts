import { LOCK_AFTER_MS, shouldLockOnReturn } from '@/lock/lockModel';

describe('shouldLockOnReturn', () => {
  const t0 = 1_000_000;

  it('never locks when the setting is off', () => {
    expect(shouldLockOnReturn(false, t0, t0 + 10 * LOCK_AFTER_MS)).toBe(false);
  });

  it('does not lock without a recorded trip to the background', () => {
    // `inactive` (Control Centre, a banner) never records one.
    expect(shouldLockOnReturn(true, null, t0 + 10 * LOCK_AFTER_MS)).toBe(false);
  });

  it('stays unlocked for a quick switch away and back', () => {
    expect(shouldLockOnReturn(true, t0, t0 + LOCK_AFTER_MS - 1)).toBe(false);
  });

  it('locks once the grace period has passed', () => {
    expect(shouldLockOnReturn(true, t0, t0 + LOCK_AFTER_MS)).toBe(true);
    expect(shouldLockOnReturn(true, t0, t0 + 5 * 60_000)).toBe(true);
  });

  it('takes a custom grace period', () => {
    expect(shouldLockOnReturn(true, t0, t0 + 999, 1000)).toBe(false);
    expect(shouldLockOnReturn(true, t0, t0 + 1000, 1000)).toBe(true);
  });
});
