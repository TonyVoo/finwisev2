import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo-modules-core';

/**
 * Android only: the home-screen widget (today's total and an Add button). Absent on iOS and in tests, where every
 * call does nothing.
 */

interface Native {
  update(title: string, amount: string, add: string): void;
  clear(): void;
  requestPin(): boolean;
}

const native: Native | null =
  Platform.OS === 'android' ? requireOptionalNativeModule<Native>('HomeWidget') : null;

export const homeWidgetSupported = (): boolean => native !== null;
export const updateHomeWidget = (title: string, amount: string, add: string): void =>
  native?.update(title, amount, add);
export const clearHomeWidget = (): void => native?.clear();
export const requestHomeWidgetPin = (): boolean => native?.requestPin() ?? false;
