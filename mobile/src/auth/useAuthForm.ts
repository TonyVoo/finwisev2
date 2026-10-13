import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import type { TextInput } from 'react-native';
import type { AuthResponse } from '@expense-tracker/shared';
import { useSessionController } from './SessionProvider';
import { type AuthField, type AuthScreen, presentAuthError } from './authErrors';
import {
  type AuthFormAction,
  type AuthFormState,
  type Validator,
  authFormReducer,
  initialAuthFormState,
} from './formState';
import type { Credentials } from './validation';

/**
 * Drives one auth form: the field state, the request, and what happens to the session
 * afterwards.
 *
 * Signup and login differ in three things - the validator, the request, and the copy -
 * so those are arguments and everything else is here once. What is *not* here is any
 * navigation: on success this adopts the session and stops. The `(auth)` route guard
 * redirects an authenticated user to `/(app)/(tabs)`, so pushing a route here as well
 * would mean two places decide where a signed-in user lands, and they would eventually
 * disagree.
 *
 * Note what happens to `busy` on success: **nothing**. `docs/design/03-auth.md` §1.3
 * States says the Busy state persists through the replace, and Home then owns the
 * hydrating state. Clearing it would flash an idle button on a screen that is being
 * replaced.
 */

export interface UseAuthFormOptions {
  /** Which screen, for the offline copy. The two strings differ on purpose. */
  readonly screen: AuthScreen;
  readonly validate: Validator;
  /** Performs the request. `validate`'s normalised values are passed, not the raw ones. */
  readonly request: (credentials: Credentials) => Promise<AuthResponse>;
  /** Prefilled email, when arriving from the `Log in instead` link (§1.2 rule 4). */
  readonly initialEmail?: string;
}

export interface UseAuthFormResult {
  readonly state: AuthFormState;
  readonly busy: boolean;
  readonly setField: (field: AuthField, value: string) => void;
  readonly blurField: (field: AuthField) => void;
  readonly submit: () => void;
  /** Attach to the inputs so focus can be moved to the first field in error. */
  readonly fieldRefs: Readonly<Record<AuthField, React.RefObject<TextInput | null>>>;
}

export function useAuthForm({
  screen,
  validate,
  request,
  initialEmail = '',
}: UseAuthFormOptions): UseAuthFormResult {
  const session = useSessionController();
  const [state, rawDispatch] = useReducer(
    (current: AuthFormState, action: AuthFormAction) => authFormReducer(current, action, validate),
    initialEmail,
    initialAuthFormState,
  );
  const [busy, setBusy] = useState(false);

  const fieldRefs = {
    email: useRef<TextInput | null>(null),
    password: useRef<TextInput | null>(null),
  };

  // A submit that resolves after the screen has gone - the guard redirects on a
  // successful sign-in - must not set state on an unmounted component.
  const mounted = useRef(true);
  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );

  /**
   * Move focus to the field the reducer nominated.
   *
   * §1.2 Accessibility: focus moves to the **first** field in error and its message is
   * announced. The announcement is not a separate call - the field's
   * `accessibilityLabel` already reads `<Label>, invalid: <error>`, so focusing it reads
   * exactly one message. Announcing as well would read it twice.
   */
  useEffect(() => {
    if (state.focusRequest === null) return;
    fieldRefs[state.focusRequest].current?.focus();
    rawDispatch({ kind: 'focusHandled' });
    // Keyed on the request alone: `fieldRefs` is rebuilt every render, but the ref
    // objects inside it are stable, so they are not a dependency worth re-running on.
  }, [state.focusRequest]);

  const submit = useCallback(() => {
    // Ignore a second tap while the first request is in flight. The button also ignores
    // taps while busy; this is the guard for a hardware keyboard's Go key, which does
    // not go through the button at all.
    if (busy) return;

    // Validated here rather than read back from the reducer: `dispatch` is asynchronous,
    // so the post-submit state is not available in this tick, and the decision to send
    // has to be made now.
    const { errors, values } = validate(state.values);
    rawDispatch({ kind: 'submit' });

    if (Object.keys(errors).length > 0) return;

    setBusy(true);
    void (async () => {
      try {
        const auth = await request(values);
        // Adopts the local store, writes the user row and persists the tokens. The route
        // guard takes it from here. `busy` stays set through that transition on purpose.
        await session.signIn(auth);
      } catch (error) {
        if (!mounted.current) return;
        rawDispatch({ kind: 'failed', presentation: presentAuthError(error, screen) });
        setBusy(false);
      }
    })();
  }, [busy, request, screen, session, state.values, validate]);

  return {
    state,
    busy,
    setField: useCallback(
      (field, value) => rawDispatch({ kind: 'change', field, value }),
      [],
    ),
    blurField: useCallback((field) => rawDispatch({ kind: 'blur', field }), []),
    submit,
    fieldRefs,
  };
}
