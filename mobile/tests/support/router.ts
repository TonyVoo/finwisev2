/**
 * The state behind the `expo-router` manual mock in `mobile/__mocks__/expo-router.ts`.
 *
 * The real module needs a route tree, a navigation container and a native stack; a
 * screen test has none of those and does not want them. What the auth screens actually
 * use is three verbs (`push`, `replace`, `back`) and one hook for the prefilled email,
 * so those are recorded here and asserted on directly.
 *
 * Recording navigation rather than performing it is also what keeps the tests honest
 * about where navigation *lives*. On a successful sign-in the screens do not navigate at
 * all - the `(auth)` route guard reacts to the session becoming authenticated
 * (`src/auth/useAuthForm.ts`). A test that drove a real router could not tell the
 * difference between the guard working and the screen pushing a route behind its back;
 * here, `replace` staying empty after a successful login is the evidence.
 */

export interface RouterRecord {
  readonly push: unknown[];
  readonly replace: unknown[];
  back: number;
  /** Every `<Redirect href>` the guards rendered, in order. */
  readonly redirects: unknown[];
}

export const routerRecord: RouterRecord = {
  push: [],
  replace: [],
  back: 0,
  redirects: [],
};

let searchParams: Readonly<Record<string, string>> = {};

export const routerMock = {
  push: (href: unknown) => {
    routerRecord.push.push(href);
  },
  replace: (href: unknown) => {
    routerRecord.replace.push(href);
  },
  navigate: (href: unknown) => {
    routerRecord.push.push(href);
  },
  back: () => {
    routerRecord.back += 1;
  },
  canGoBack: () => true,
  setParams: () => undefined,
};

/** The params the next render of a screen will read. Set before `render`. */
export function setSearchParams(next: Readonly<Record<string, string>>): void {
  searchParams = next;
}

export function getSearchParams(): Readonly<Record<string, string>> {
  return searchParams;
}

export function resetRouter(): void {
  routerRecord.push.length = 0;
  routerRecord.replace.length = 0;
  routerRecord.redirects.length = 0;
  routerRecord.back = 0;
  searchParams = {};
}
