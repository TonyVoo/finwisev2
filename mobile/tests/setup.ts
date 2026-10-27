import { DEFAULT_FONT_SCALE, setFontScale } from './support/fontScale';
import '@testing-library/react-native';

// Jest only defaults `NODE_ENV` to `test` when it is unset, so a shell that exports
// `NODE_ENV=development` (CI images and some agent harnesses do) leaks that value into the
// test workers. React Native reads it at call time to decide whether a native-driver
// animation may skip the native view lookup: `Animated/nodes/AnimatedProps.js`
// `#connectAnimatedView` substitutes a placeholder view tag when `NODE_ENV === 'test'` and
// otherwise throws `Unable to locate attached view in the native tree`. There is no native
// tree under jest, so any `useNativeDriver: true` animation - `SwipeToDelete` settling a
// row back to rest - fails for a reason that has nothing to do with the component.
//
// Normalising it here rather than dropping to `useNativeDriver: false` keeps the
// transform on the UI thread where a 60fps drag needs it. This runs before any test body,
// and `test` picks the same development React build as `development` did, so nothing else
// about the environment shifts.
process.env.NODE_ENV = 'test';

// `expo-secure-store` is a native module with no JS fallback under jest. The token
// store is the only thing that touches it, so a tiny in-memory stand-in is enough to
// exercise the real adapter (key names, round-tripping, delete-on-clear).
jest.mock('expo-secure-store', () => {
  const store = new Map<string, string>();
  return {
    __store: store,
    getItemAsync: jest.fn(async (key: string) => store.get(key) ?? null),
    setItemAsync: jest.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    deleteItemAsync: jest.fn(async (key: string) => {
      store.delete(key);
    }),
    WHEN_UNLOCKED: 'whenUnlocked',
    AFTER_FIRST_UNLOCK: 'afterFirstUnlock',
  };
});

// netinfo is a native module too, and the package ships its own jest mock: a connected
// `cellular` state, a `fetch` that resolves it and an `addEventListener` that records the
// listener without ever calling it. That is the right default here - a suite that is about
// connectivity builds a `createMemoryReachability` instead and says what it wants, rather
// than reaching through to a mock nothing in the test can see.
jest.mock('@react-native-community/netinfo', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('@react-native-community/netinfo/jest/netinfo-mock.js'),
);

// The text scale every case starts from. The preset's own window reports `fontScale: 2`,
// which is a user with the accessibility text slider near its maximum - so without this,
// the three components that branch on it would only ever be rendered in their large-text
// layout and never in the ordinary one. `tests/support/fontScale.ts` has the full note.
//
// `beforeEach` rather than once, so a case that raises the scale cannot leak it into the
// next one.
beforeEach(() => {
  setFontScale(DEFAULT_FONT_SCALE);
});

// `expo-local-authentication` is native. Everything but the lock's own tests wants it to say
// "available, and the person passed", which keeps a locked app from blocking a screen test.
jest.mock('expo-local-authentication', () => ({
  hasHardwareAsync: jest.fn(async () => true),
  isEnrolledAsync: jest.fn(async () => true),
  getEnrolledLevelAsync: jest.fn(async () => 2),
  authenticateAsync: jest.fn(async () => ({ success: true })),
  SecurityLevel: { NONE: 0, SECRET: 1, BIOMETRIC_WEAK: 2, BIOMETRIC_STRONG: 3 },
}));

// `expo-notifications` is native; the budget notifier is the only caller and its tests pass
// their own fake, so everywhere else a no-op that reports permission as granted is enough.
jest.mock('expo-notifications', () => ({
  getPermissionsAsync: jest.fn(async () => ({ granted: true, canAskAgain: true })),
  requestPermissionsAsync: jest.fn(async () => ({ granted: true, canAskAgain: true })),
  scheduleNotificationAsync: jest.fn(async () => 'id'),
  setNotificationHandler: jest.fn(),
  setNotificationChannelAsync: jest.fn(async () => null),
  getAllScheduledNotificationsAsync: jest.fn(async () => []),
  cancelScheduledNotificationAsync: jest.fn(async () => undefined),
  SchedulableTriggerInputTypes: { DATE: 'date' },
  AndroidImportance: { DEFAULT: 3 },
}));
