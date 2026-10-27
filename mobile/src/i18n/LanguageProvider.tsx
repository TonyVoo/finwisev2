import {
  Fragment,
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react';
import { META_KEYS, writeMeta } from '../db/meta';
import type { SqliteDatabase } from '../db/sqlite';
import { applyLanguagePreference } from './apply';
import { type Language, type LanguagePreference, resolveLanguage } from './language';

/**
 * The language setting, and the one thing a change of it has to do: render again.
 *
 * The words live in the copy objects (`i18n/apply.ts`), which are overwritten in place, but
 * React does not know that - a screen that has already rendered keeps the words it drew.
 * So a change remounts everything under this provider by changing a `key`. That is heavier
 * than a re-render and deliberately so: it is the only way to be sure no component, however
 * it memoised, is still showing the old language. The route survives (it lives in the router,
 * above this), the open screen restarts, and a language change is rare enough that this costs
 * nothing anyone notices.
 *
 * It sits **inside** the month provider, so changing language does not forget which month
 * the person was looking at, and outside every screen.
 *
 * The first language is applied while the provider's first state is being created, before
 * any child renders, so a Vietnamese phone never flashes a frame of English.
 */

interface LanguageValue {
  readonly preference: LanguagePreference;
  /** The language actually in use, after `system` has been resolved. */
  readonly language: Language;
  readonly setPreference: (next: LanguagePreference) => void;
}

const LanguageContext = createContext<LanguageValue>({
  preference: 'system',
  language: 'en',
  setPreference: () => undefined,
});

export function useLanguage(): LanguageValue {
  return useContext(LanguageContext);
}

export function LanguageProvider({
  database,
  initialPreference,
  children,
}: {
  readonly database: SqliteDatabase;
  readonly initialPreference: LanguagePreference;
  readonly children: ReactNode;
}) {
  const [state, setState] = useState(() => ({
    preference: initialPreference,
    language: applyLanguagePreference(initialPreference),
    version: 0,
  }));

  const setPreference = useCallback(
    (next: LanguagePreference) => {
      const language = applyLanguagePreference(next);
      setState((current) => ({
        preference: next,
        language,
        version: current.version + 1,
      }));
      // Fire-and-forget, like the theme: a failed write must not undo a choice already on
      // screen, and the next launch simply reads the previous one.
      void writeMeta(database, META_KEYS.languagePreference, next).catch(() => undefined);
    },
    [database],
  );

  const value = useMemo(
    () => ({
      preference: state.preference,
      language: resolveLanguage(state.preference),
      setPreference,
    }),
    [state.preference, setPreference],
  );

  return (
    <LanguageContext.Provider value={value}>
      <Fragment key={state.version}>{children}</Fragment>
    </LanguageContext.Provider>
  );
}
