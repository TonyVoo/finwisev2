import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo-modules-core';

/**
 * Android only: the home-screen widget (today's total and an Add button). Absent on iOS and in tests, where every
 * call does nothing.
 */

interface Native {
  update(title: string, amount: string, add: string, link: string): void;
  clear(): void;
  requestPin(): boolean;
}

const native: Native | null =
  Platform.OS === 'android' ? requireOptionalNativeModule<Native>('HomeWidget') : null;

export const homeWidgetSupported = (): boolean => native !== null;
/** `link` is where a tap opens the app: a link the app already answers to. */
export const updateHomeWidget = (title: string, amount: string, add: string, link: string): void =>
  native?.update(title, amount, add, link);
export const clearHomeWidget = (): void => native?.clear();
export const requestHomeWidgetPin = (): boolean => native?.requestPin() ?? false;
