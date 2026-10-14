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
import { AccessibilityInfo, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { HIT_SLOP_44, a11y, color, elevation, radius, size, space, type } from '../theme/tokens';

/**
 * The snackbar, as `docs/design/00-foundations.md` §6 specifies it, plus the one rule that
 * makes it a provider rather than a component: **one at a time, and a new one replaces the
 * current one.**
 *
 * That rule is why showing a snackbar is a function call on a context instead of state in
 * each screen. Two screens holding their own would be able to stack them, and the
 * replacement semantics the expense list depends on - "deleting a second expense while a
 * snackbar is showing replaces it, and the first delete stands" (`04-expense-list.md`
 * rule 9, `EXP-15`) - would have nowhere to live.
 *
 * Three further details from the spec, each of which has a reason the implementation must
 * not round off:
 *
 * - **Auto-dismiss is 5s, or 10s when a screen reader is on.** A screen reader user needs
 *   time to hear the message *and* reach the action, which is the whole point of the
 *   longer window (§6, §8 rule 9).
 * - **Every snackbar is announced** via `announceForAccessibility`, because a message that
 *   is only rendered is invisible to the user most likely to need it (§8 rule 7).
 * - **An action's target is 44**, even though the label is `type.bodyStrong` text.
 *
 * What the snackbar deliberately does **not** do is hold state the app needs. A delete is
 * committed to SQLite before its snackbar appears; the snackbar offers an undo, it does
 * not defer the delete. So if the app is killed while one is up, the delete stands
 * (`04-expense-list.md` rule 9, `SYNC-27`).
 */

export interface SnackbarRequest {
  readonly message: string;
  /** Optional action - `Undo`, `View`. One at most; the spec never shows two. */
  readonly action?: { readonly label: string; readonly onPress: () => void };
}

export type ShowSnackbar = (request: SnackbarRequest) => void;

const SnackbarContext = createContext<ShowSnackbar | null>(null);

interface ActiveSnackbar extends SnackbarRequest {
  /** Distinguishes two identical messages, so the second one restarts the timer. */
  readonly token: number;
}

export function SnackbarProvider({ children }: { readonly children: ReactNode }) {
  const [active, setActive] = useState<ActiveSnackbar | null>(null);
  const token = useRef(0);

  const show = useCallback<ShowSnackbar>((request) => {
    token.current += 1;
    setActive({ ...request, token: token.current });
    // Announced on show rather than on render, so it fires once per snackbar and not
    // once per re-render of the tree below it.
    AccessibilityInfo.announceForAccessibility(request.message);
  }, []);

  const value = useMemo(() => show, [show]);

  return (
    <SnackbarContext.Provider value={value}>
      {children}
      {active === null ? null : (
        <SnackbarHost
          key={active.token}
          snackbar={active}
          onDismiss={() => {
            setActive((current) => (current?.token === active.token ? null : current));
          }}
        />
      )}
    </SnackbarContext.Provider>
  );
}

/**
 * Show a snackbar. Available everywhere below {@link SnackbarProvider}.
 *
 * Returns a no-op outside a provider rather than throwing: a snackbar is a confirmation of
 * something that has already happened, so a missing provider must not be able to turn a
 * completed save into a crash.
 */
export function useSnackbar(): ShowSnackbar {
  const show = useContext(SnackbarContext);
  return show ?? noop;
}

const noop: ShowSnackbar = () => undefined;

function SnackbarHost({
  snackbar,
  onDismiss,
}: {
  readonly snackbar: ActiveSnackbar;
  readonly onDismiss: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [duration, setDuration] = useState<number | null>(null);

  // The visible window depends on whether a screen reader is on, which is an async read -
  // so the timer starts only once the answer is in, rather than starting at 5s and
  // extending.
  useEffect(() => {
    let cancelled = false;
    void AccessibilityInfo.isScreenReaderEnabled().then(
      (enabled) => {
        if (!cancelled) setDuration(enabled ? a11y.snackbarScreenReaderMs : a11y.snackbarMs);
      },
      () => {
        if (!cancelled) setDuration(a11y.snackbarMs);
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (duration === null) return undefined;
    const timer = setTimeout(onDismiss, duration);
    return () => clearTimeout(timer);
  }, [duration, onDismiss]);

  return (
    <View
      testID="snackbar"
      style={[styles.snackbar, { bottom: insets.bottom + space[4] }]}
      // Announced once on show (see `show`), so the host itself is not a live region -
      // which would announce it a second time.
      accessibilityLiveRegion="none"
    >
      <Text style={styles.message}>{snackbar.message}</Text>

      {snackbar.action === undefined ? null : (
        <Pressable
          testID="snackbar-action"
          hitSlop={HIT_SLOP_44}
          accessibilityRole="button"
          accessibilityLabel={snackbar.action.label}
          onPress={() => {
            // Dismiss first: the action may itself show a snackbar - Undo announces
            // `Expense restored.` - and this one must not outlive it.
            onDismiss();
            snackbar.action?.onPress();
          }}
          style={styles.action}
        >
          <Text style={styles.actionLabel}>{snackbar.action.label}</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  snackbar: {
    ...elevation[2],
    position: 'absolute',
    left: space[4],
    right: space[4],
    backgroundColor: color.bg.surface,
    borderRadius: radius.md,
    padding: space[4],
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
  },
  message: {
    ...type.callout,
    color: color.text.primary,
    flex: 1,
  },
  action: {
    minHeight: size.tapTargetMin,
    justifyContent: 'center',
  },
  actionLabel: {
    ...type.bodyStrong,
    color: color.primary.default,
  },
});
