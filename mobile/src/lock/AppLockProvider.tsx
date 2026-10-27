import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AppState, StyleSheet, Text, View } from 'react-native';
import { Button } from '../components/Button';
import { COPY } from '../copy/strings';
import { META_KEYS, deleteMeta, writeMeta } from '../db/meta';
import type { SqliteDatabase } from '../db/sqlite';
import { space, type } from '../theme/tokens';
import { createStyles } from '../theme/ThemeProvider';
import { authenticate, canAuthenticate } from './biometrics';
import { shouldLockOnReturn } from './lockModel';

/**
 * The app lock.
 *
 * Children always stay mounted, with the cover drawn over them while locked, so unlocking
 * returns to exactly where the person was - a half-typed expense is still there - rather
 * than rebuilding the tree. The cover is opaque and also hidden from assistive technology
 * underneath, so a screen reader cannot read what the cover is hiding.
 *
 * Starts locked when the setting is on, because a cold start is the first thing a thief
 * would see. The system prompt is raised on its own as soon as the cover shows; the button
 * is for trying again after a cancel.
 */

export const LOCK_COVER_TEST_ID = 'app-lock-cover';
export const LOCK_UNLOCK_TEST_ID = 'app-lock-unlock';

/** `cancelled` is silent; `failed` carries the system's reason for a message. */
export type EnableResult =
  | { readonly status: 'ok' }
  | { readonly status: 'unavailable' }
  | { readonly status: 'cancelled' }
  | { readonly status: 'failed'; readonly code: string };

interface AppLockValue {
  readonly enabled: boolean;
  readonly locked: boolean;
  /** Turn the lock on or off, asking the system to verify the person first. */
  readonly setEnabled: (next: boolean) => Promise<EnableResult>;
}

const AppLockContext = createContext<AppLockValue>({
  enabled: false,
  locked: false,
  setEnabled: async () => ({ status: 'failed', code: 'no_provider' }),
});

export function useAppLock(): AppLockValue {
  return useContext(AppLockContext);
}

export function AppLockProvider({
  database,
  initialEnabled,
  children,
}: {
  readonly database: SqliteDatabase;
  readonly initialEnabled: boolean;
  readonly children: ReactNode;
}) {
  const styles = useStyles();
  const [enabled, setEnabledState] = useState(initialEnabled);
  const [locked, setLocked] = useState(initialEnabled);
  const [failed, setFailed] = useState(false);
  const backgroundedAt = useRef<number | null>(null);
  const prompting = useRef(false);

  const unlock = useCallback(async () => {
    if (prompting.current) return;
    prompting.current = true;
    try {
      const result = await authenticate(COPY.lock.reason);
      setFailed(!result.ok && !result.cancelled);
      if (result.ok) setLocked(false);
    } finally {
      prompting.current = false;
    }
  }, []);

  // Lock on a real trip to the background and unlock-prompt on return; `inactive` is ignored.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'background') {
        backgroundedAt.current = Date.now();
      } else if (state === 'active') {
        if (shouldLockOnReturn(enabled, backgroundedAt.current, Date.now())) setLocked(true);
        backgroundedAt.current = null;
      }
    });
    return () => subscription.remove();
  }, [enabled]);

  // The prompt comes up by itself whenever the cover does.
  useEffect(() => {
    if (locked && enabled) void unlock();
  }, [locked, enabled, unlock]);

  const setEnabled = useCallback(
    async (next: boolean): Promise<EnableResult> => {
      if (next && !(await canAuthenticate())) return { status: 'unavailable' };
      // Both directions ask: turning a lock off is as sensitive as getting past it.
      const result = await authenticate(next ? COPY.lock.enableReason : COPY.lock.disableReason);
      if (!result.ok) {
        return result.cancelled ? { status: 'cancelled' } : { status: 'failed', code: result.code };
      }
      if (next) await writeMeta(database, META_KEYS.appLockEnabled, '1');
      else await deleteMeta(database, [META_KEYS.appLockEnabled]);
      setEnabledState(next);
      setLocked(false);
      return { status: 'ok' };
    },
    [database],
  );

  const value = useMemo(() => ({ enabled, locked, setEnabled }), [enabled, locked, setEnabled]);
  const covered = enabled && locked;

  return (
    <AppLockContext.Provider value={value}>
      <View style={styles.fill}>
        <View
          style={styles.fill}
          importantForAccessibility={covered ? 'no-hide-descendants' : 'auto'}
          accessibilityElementsHidden={covered}
        >
          {children}
        </View>
        {covered ? (
          <View style={styles.cover} testID={LOCK_COVER_TEST_ID} accessibilityViewIsModal>
            <Text style={styles.title} accessibilityRole="header">
              {COPY.lock.title}
            </Text>
            <Text style={styles.body}>{failed ? COPY.lock.failed : COPY.lock.body}</Text>
            <Button
              testID={LOCK_UNLOCK_TEST_ID}
              label={COPY.lock.unlock}
              variant="primary"
              onPress={() => void unlock()}
            />
          </View>
        ) : null}
      </View>
    </AppLockContext.Provider>
  );
}

const useStyles = createStyles((color) =>
  StyleSheet.create({
    fill: { flex: 1 },
    cover: {
      position: 'absolute',
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
      backgroundColor: color.bg.canvas,
      alignItems: 'center',
      justifyContent: 'center',
      gap: space[4],
      padding: space[6],
    },
    title: { ...type.title1, color: color.text.primary, textAlign: 'center' },
    body: { ...type.body, color: color.text.secondary, textAlign: 'center' },
  }),
);
