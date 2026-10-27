import * as Haptics from 'expo-haptics';
import { keyHaptic, savedHaptic, warnHaptic } from '@/lib/haptics';

/** Haptics are feedback, never a dependency: a missing motor must not break a save. */
describe('haptics', () => {
  beforeEach(() => jest.clearAllMocks());

  it('ticks lightly for a key press', () => {
    keyHaptic();
    expect(Haptics.selectionAsync).toHaveBeenCalledTimes(1);
  });

  it('confirms a save with the success pattern', () => {
    savedHaptic();
    expect(Haptics.notificationAsync).toHaveBeenCalledWith('success');
  });

  it('warns with the warning pattern', () => {
    warnHaptic();
    expect(Haptics.notificationAsync).toHaveBeenCalledWith('warning');
  });

  it('swallows a device that cannot vibrate', async () => {
    (Haptics.selectionAsync as jest.Mock).mockRejectedValueOnce(new Error('no motor'));
    expect(() => keyHaptic()).not.toThrow();
    await Promise.resolve();
  });
});
