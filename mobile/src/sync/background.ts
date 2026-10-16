import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';
import type { SyncEngine } from './engine';

/**
 * Background sync, over `expo-background-task`.
 *
 * Confirmed against the pinned SDK rather than from memory: Expo 57 ships
 * `expo-background-task@57.0.21`, which is what replaced the deprecated
 * `expo-background-fetch`, and the API is `TaskManager.defineTask` at module scope plus
 * `registerTaskAsync(name, { minimumInterval })`. `expo-background-fetch` is not in this
 * tree at all.
 *
 * ### It is an optimisation and nothing more
 *
 * Both platforms throttle this hard - iOS runs background work in windows of its own
 * choosing, often overnight, and Android's `minimumInterval` is a floor of 15 minutes
 * that the system is free to ignore. So **the app has to be fully correct if this never
 * fires once**, and it is: every correctness-carrying trigger is in the foreground
 * (`SyncProvider`), and this path only ever runs the same `sync()` they do. Nothing is
 * conditional on having been woken.
 *
 * ### Why the task is defined at module scope
 *
 * A background wake-up starts the JS runtime without mounting the React tree, so a
 * `defineTask` call inside a component would not have run by the time the system looks
 * for the handler. Module scope is the documented placement. The handler then asks for
 * whatever engine the app has, which is null in a headless wake-up - see below.
 */

export const SYNC_TASK_NAME = 'expense-tracker/sync';

/**
 * How often to *ask* to be woken. Fifteen minutes is Android's floor and the smallest
 * value that means anything; it is a request, never a schedule.
 */
const MINIMUM_INTERVAL_MINUTES = 15;

let engine: SyncEngine | null = null;

/**
 * Hand the running app's engine to the background task, or clear it on teardown.
 *
 * The engine is shared rather than rebuilt because a second one would open a second
 * sync against the same store and the same outbox entries - the single-flight guard is
 * per engine, so two engines are two concurrent drains.
 */
export function setBackgroundSyncEngine(next: SyncEngine | null): void {
  engine = next;
}

/**
 * The task body, exported so it can be tested without the native scheduler.
 *
 * A headless wake-up has no engine: the app's providers never mounted, so nothing
 * called {@link setBackgroundSyncEngine}. That returns `Success` and does nothing, and
 * the honest reading of it is that on this SDK the useful background case is the one
 * where the app is still resident. Building a second container here to cover the
 * headless case would need a session, a database handle and a transport of its own,
 * and would race the real ones the moment the app came back - for an optimisation the
 * app is required to work without.
 */
export async function runBackgroundSync(): Promise<BackgroundTask.BackgroundTaskResult> {
  if (engine === null) return BackgroundTask.BackgroundTaskResult.Success;

  const result = await engine.sync('background');
  // `skipped` is not a failure: it means netinfo says there is nothing to reach, which
  // is the single most likely reason the system woke us and found nothing to do.
  return result.status === 'failed'
    ? BackgroundTask.BackgroundTaskResult.Failed
    : BackgroundTask.BackgroundTaskResult.Success;
}

TaskManager.defineTask(SYNC_TASK_NAME, runBackgroundSync);

/**
 * Ask the system to wake us periodically. Safe to call on every app start.
 *
 * Failures are swallowed deliberately. Registration fails on a simulator, on a device
 * with Background App Refresh switched off, and on web, and none of those is a problem
 * the user has or the app needs to react to - the foreground triggers cover correctness
 * either way.
 */
export async function registerBackgroundSync(): Promise<boolean> {
  try {
    const status = await BackgroundTask.getStatusAsync();
    if (status === BackgroundTask.BackgroundTaskStatus.Restricted) return false;

    await BackgroundTask.registerTaskAsync(SYNC_TASK_NAME, {
      minimumInterval: MINIMUM_INTERVAL_MINUTES,
    });
    return true;
  } catch {
    return false;
  }
}

export async function unregisterBackgroundSync(): Promise<void> {
  try {
    if (await TaskManager.isTaskRegisteredAsync(SYNC_TASK_NAME)) {
      await BackgroundTask.unregisterTaskAsync(SYNC_TASK_NAME);
    }
  } catch {
    // Same reasoning as registration: nothing downstream depends on this succeeding.
  }
}
