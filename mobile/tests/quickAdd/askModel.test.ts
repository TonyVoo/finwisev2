import type { QuickAddReading } from '@/quickAdd/parseQuickAdd';
import { shouldAskModel } from '@/quickAdd/askModel';
import {
  isQuickAddUnavailable,
  markQuickAddUnavailable,
  resetQuickAddAvailabilityForTests,
} from '@/quickAdd/quickAddAvailability';

/**
 * When the phone asks the server for help (`docs/design/15-quick-add.md`): only when its own rules were
 * unsure, the device is online, and the server has not already said it cannot.
 */

const reading = (confident: boolean): QuickAddReading => ({
  type: 'expense',
  amountMinor: confident ? 450 : null,
  date: null,
  note: null,
  categoryId: null,
  confident,
});

describe('shouldAskModel', () => {
  it('asks when the rules were unsure, the device is online and the server may help', () => {
    expect(shouldAskModel({ reading: reading(false), unavailable: false, offline: false })).toBe(
      true,
    );
  });

  it('does not ask when the rules were confident: nothing is sent', () => {
    expect(shouldAskModel({ reading: reading(true), unavailable: false, offline: false })).toBe(
      false,
    );
  });

  it('does not ask once the server has said it cannot, for the rest of the session', () => {
    expect(shouldAskModel({ reading: reading(false), unavailable: true, offline: false })).toBe(
      false,
    );
  });

  it('does not ask while the device is offline', () => {
    expect(shouldAskModel({ reading: reading(false), unavailable: false, offline: true })).toBe(
      false,
    );
  });
});

describe('quick add availability', () => {
  afterEach(() => resetQuickAddAvailabilityForTests());

  it('is available until the server says otherwise, then stays unavailable until a restart', () => {
    expect(isQuickAddUnavailable()).toBe(false);
    markQuickAddUnavailable();
    expect(isQuickAddUnavailable()).toBe(true);
  });
});
