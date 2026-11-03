import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo-modules-core';

/**
 * Android only: the notifications of MoMo and ZaloPay, kept by a small native service
 * (`modules/payment-notifications/android`) until the app asks. Absent on iOS and in tests, where
 * every call answers "nothing".
 */

interface Native {
  isEnabled(): boolean;
  openSettings(): void;
  drain(): string;
  setAlerts(enabled: boolean, title: string, body: string): void;
  alertsEnabled(): boolean;
}

const native: Native | null =
  Platform.OS === 'android' ? requireOptionalNativeModule<Native>('PaymentNotifications') : null;

export interface QueuedNotification {
  readonly packageName: string;
  readonly key: string;
  readonly postTime: number;
  readonly title: string;
  readonly text: string;
}

export function paymentNotificationsSupported(): boolean {
  return native !== null;
}

export function paymentNotificationsEnabled(): boolean {
  return native?.isEnabled() ?? false;
}

export function openPaymentNotificationSettings(): void {
  native?.openSettings();
}

export function drainPaymentNotifications(): readonly QueuedNotification[] {
  if (native === null) return [];
  try {
    const parsed: unknown = JSON.parse(native.drain());
    return Array.isArray(parsed) ? (parsed as QueuedNotification[]) : [];
  } catch {
    return [];
  }
}

export function paymentAlertsEnabled(): boolean {
  return native?.alertsEnabled() ?? false;
}

export function setPaymentAlerts(enabled: boolean, title: string, body: string): void {
  native?.setAlerts(enabled, title, body);
}
