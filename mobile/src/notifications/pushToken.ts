import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import type { ApiClient } from '../api/client';
import { META_KEYS, readMeta, writeMeta } from '../db/meta';
import type { SqliteDatabase } from '../db/sqlite';
import { hasPermission } from './budgetNotifier';

/**
 * Tells the server which device to push a price alert to, so an alert reaches a phone with the app closed.
 *
 * Only when there is something to push for (an alert exists) and the person has allowed notifications, and only when
 * the token is new: it is remembered, and the server is told again only if it changes. Where a push token cannot be
 * had (Expo Go, a build with no project id, no network) it quietly does nothing: the device's own check still runs
 * whenever the app does.
 */

function projectId(): string | undefined {
  const extra = Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined;
  return extra?.eas?.projectId ?? Constants.easConfig?.projectId;
}

export async function registerPushToken(
  api: Pick<ApiClient, 'registerPushToken'>,
  database: SqliteDatabase,
  hasAlerts: boolean,
): Promise<'sent' | 'skipped'> {
  if (!hasAlerts || !(await hasPermission())) return 'skipped';
  const id = projectId();
  if (id === undefined) return 'skipped';
  let token: string;
  try {
    token = (await Notifications.getExpoPushTokenAsync({ projectId: id })).data;
  } catch {
    return 'skipped';
  }
  if ((await readMeta(database, META_KEYS.pushToken)) === token) return 'skipped';
  await api.registerPushToken({ token, platform: Platform.OS === 'ios' ? 'ios' : 'android' });
  await writeMeta(database, META_KEYS.pushToken, token);
  return 'sent';
}
