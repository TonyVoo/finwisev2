import * as Haptics from 'expo-haptics';

/**
 * Haptic feedback. Always fire-and-forget: a device without a motor, or with haptics turned
 * off, rejects, and that must never surface in the flow the buzz was decorating.
 */
function quietly(run: () => Promise<void>): void {
  try {
    run().catch(() => undefined);
  } catch {
    // Synchronous failure on a platform without the module: nothing to do.
  }
}

/** A light tick: a keypad key, a toggle. */
export function keyHaptic(): void {
  quietly(() => Haptics.selectionAsync());
}

/** The money was recorded. */
export function savedHaptic(): void {
  quietly(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success));
}

/** Something was refused or removed. */
export function warnHaptic(): void {
  quietly(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning));
}
