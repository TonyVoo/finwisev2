import {
  getSearchParams,
  routerMock,
  routerRecord,
} from '../tests/support/router';

/**
 * The manual mock for `expo-router`, used by the screen tests via a bare
 * `jest.mock('expo-router')`.
 *
 * It lives in a file rather than in a `jest.mock` factory for a boring reason: a factory
 * is hoisted above the imports, so it can only reach its dependencies through
 * `require()`, which this repo's lint rules forbid. A manual mock module can use ordinary
 * imports, and the state it is built on stays in `tests/support/router.ts` where the
 * tests can read and reset it.
 *
 * The real module needs a route tree, a navigation container and a native stack; a screen
 * test has none of those and does not want them. What the auth screens actually use is
 * three verbs, one hook and the two guards' `<Redirect>`.
 */

export const useRouter = () => routerMock;

export const useLocalSearchParams = () => getSearchParams();

/**
 * Records the destination and renders nothing.
 *
 * A route guard's whole output is "where should this user be instead", and that is a
 * value, not a side effect — which is why the guards render `<Redirect>` rather than
 * calling `router.replace` in an effect. An effect runs after the first paint, so an
 * unauthenticated user would see a frame of Home, and with a session that just expired, a
 * frame of someone else's data. Recording the element instead of navigating is what lets
 * a test assert on that.
 */
export function Redirect({ href }: { readonly href: unknown }): null {
  routerRecord.redirects.push(href);
  return null;
}

/**
 * Stands in for the navigator as "render the routes below me", which is all either guard
 * uses it for — enough to tell a gate open from a gate shut.
 */
export const Stack = Object.assign(
  ({ children }: { readonly children?: React.ReactNode }) => children ?? null,
  { Screen: (): null => null },
);
