import {
  SYNC_TASK_NAME,
  registerBackgroundSync,
  runBackgroundSync,
  setBackgroundSyncEngine,
  unregisterBackgroundSync,
} from '@/sync/background';
import type { SyncEngine, SyncRunResult, SyncRunStatus, SyncTrigger } from '@/sync/engine';

/**
 * The background task, without the native scheduler.
 *
 * Both Expo modules are mocked because neither has a JS fallback under jest and because
 * what matters here is not that they work - it is what this module asks of them. The
 * enum values are copied from `expo-background-task`'s own declarations (`Success = 1`,
 * `Failed = 2`, `Restricted = 1`, `Available = 2`), so an assertion on a returned result
 * is an assertion on the value the OS will actually receive.
 *
 * The case that earns this file is the first one: a headless wake-up, where the app's
 * providers never mounted and there is no engine to run. That is the normal state of a
 * background wake, not an edge case, and it must report success rather than fail and
 * teach the scheduler to stop waking us.
 */

jest.mock('expo-background-task', () => ({
  BackgroundTaskStatus: { Restricted: 1, Available: 2 },
  BackgroundTaskResult: { Success: 1, Failed: 2 },
  getStatusAsync: jest.fn(async () => 2),
  registerTaskAsync: jest.fn(async () => undefined),
  unregisterTaskAsync: jest.fn(async () => undefined),
}));

jest.mock('expo-task-manager', () => ({
  defineTask: jest.fn(),
  isTaskRegisteredAsync: jest.fn(async () => true),
}));

const BackgroundTask = jest.requireMock('expo-background-task') as {
  getStatusAsync: jest.Mock;
  registerTaskAsync: jest.Mock;
  unregisterTaskAsync: jest.Mock;
};

const TaskManager = jest.requireMock('expo-task-manager') as {
  defineTask: jest.Mock;
  isTaskRegisteredAsync: jest.Mock;
};

const SUCCESS = 1;
const FAILED = 2;
const RESTRICTED = 1;

function stubEngine(status: SyncRunStatus): { engine: SyncEngine; triggers: SyncTrigger[] } {
  const triggers: SyncTrigger[] = [];
  const engine: SyncEngine = {
    getStatus: () => {
      throw new Error('not used');
    },
    subscribe: () => () => undefined,
    sync: async (trigger) => {
      triggers.push(trigger);
      const result: SyncRunResult = { status, trigger, push: null, pull: null, error: null };
      return result;
    },
    start: async () => undefined,
    stop: () => undefined,
    refreshPending: async () => undefined,
  };
  return { engine, triggers };
}

afterEach(() => {
  setBackgroundSyncEngine(null);
  jest.clearAllMocks();
  BackgroundTask.getStatusAsync.mockResolvedValue(2);
  BackgroundTask.registerTaskAsync.mockResolvedValue(undefined);
  TaskManager.isTaskRegisteredAsync.mockResolvedValue(true);
});

describe('the background sync task', () => {
  it('is defined at module scope, before any component could mount', () => {
    expect(TaskManager.defineTask).toHaveBeenCalledWith(SYNC_TASK_NAME, runBackgroundSync);
  });

  it('succeeds without running anything when the app is not resident', async () => {
    // No engine handed over, because nothing mounted to hand one over: the headless wake.
    await expect(runBackgroundSync()).resolves.toBe(SUCCESS);
  });

  it('runs the resident engine under the background trigger', async () => {
    const { engine, triggers } = stubEngine('completed');
    setBackgroundSyncEngine(engine);

    await expect(runBackgroundSync()).resolves.toBe(SUCCESS);
    expect(triggers).toEqual(['background']);
  });

  it('reports a failed sync to the scheduler', async () => {
    const { engine } = stubEngine('failed');
    setBackgroundSyncEngine(engine);

    await expect(runBackgroundSync()).resolves.toBe(FAILED);
  });

  /**
   * `skipped` means netinfo says there is nothing to reach - the single most likely thing
   * a background wake finds. Reporting it as a failure would be a lie about the app and
   * would spend the task's budget on nothing.
   */
  it('does not report a skipped sync as a failure', async () => {
    const { engine } = stubEngine('skipped');
    setBackgroundSyncEngine(engine);

    await expect(runBackgroundSync()).resolves.toBe(SUCCESS);
  });

  it('stops running once the engine is withdrawn', async () => {
    const { engine, triggers } = stubEngine('completed');
    setBackgroundSyncEngine(engine);
    await runBackgroundSync();
    setBackgroundSyncEngine(null);

    await expect(runBackgroundSync()).resolves.toBe(SUCCESS);
    expect(triggers).toEqual(['background']);
  });
});

describe('registration', () => {
  it('asks for a fifteen minute interval, Android floor', async () => {
    await expect(registerBackgroundSync()).resolves.toBe(true);
    expect(BackgroundTask.registerTaskAsync).toHaveBeenCalledWith(SYNC_TASK_NAME, {
      minimumInterval: 15,
    });
  });

  it('does not register when the platform has restricted background work', async () => {
    BackgroundTask.getStatusAsync.mockResolvedValue(RESTRICTED);

    await expect(registerBackgroundSync()).resolves.toBe(false);
    expect(BackgroundTask.registerTaskAsync).not.toHaveBeenCalled();
  });

  /**
   * Registration fails on a simulator and on a device with Background App Refresh off.
   * Neither is a problem the user has: every correctness-carrying trigger is in the
   * foreground, so this resolves `false` rather than rejecting into whatever mounted it.
   */
  it('swallows a registration failure rather than breaking the launch', async () => {
    BackgroundTask.registerTaskAsync.mockRejectedValue(new Error('not available'));

    await expect(registerBackgroundSync()).resolves.toBe(false);
  });

  it('unregisters only a task that is registered', async () => {
    TaskManager.isTaskRegisteredAsync.mockResolvedValue(false);
    await unregisterBackgroundSync();
    expect(BackgroundTask.unregisterTaskAsync).not.toHaveBeenCalled();

    TaskManager.isTaskRegisteredAsync.mockResolvedValue(true);
    await unregisterBackgroundSync();
    expect(BackgroundTask.unregisterTaskAsync).toHaveBeenCalledWith(SYNC_TASK_NAME);
  });

  it('swallows an unregistration failure too', async () => {
    TaskManager.isTaskRegisteredAsync.mockRejectedValue(new Error('no task manager'));

    await expect(unregisterBackgroundSync()).resolves.toBeUndefined();
  });
});
