import '@testing-library/react-native';

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
