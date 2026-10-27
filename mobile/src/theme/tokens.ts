/**
 * The design tokens, as TypeScript.
 *
 * `docs/design/tokens.json` is the Designer's machine-readable export and the source of
 * truth: "import these; do not retype hex values into components". It cannot be imported
 * directly — it lives outside the Expo project root, so Metro will not resolve it — so it
 * is mirrored here and `tests/theme/tokens.test.ts` reads the JSON off disk and asserts
 * the two agree value for value. That is the same anti-drift shape `shared/` uses for the
 * wire contract: a token that changes in the design and not here fails the build rather
 * than shipping as a slightly-wrong colour nobody diffs.
 *
 * Components reference these by name. A raw hex or a raw spacing number in a component is
 * a spec violation (`docs/design/00-foundations.md` §1.1, §3).
 */

export const lightColor = {
  bg: {
    canvas: '#F7F8FA',
    surface: '#FFFFFF',
    sunken: '#EFF1F4',
    scrim: 'rgba(17,24,39,0.45)',
  },
  text: {
    primary: '#111827',
    secondary: '#4B5563',
    tertiary: '#6B7280',
    inverse: '#FFFFFF',
    disabled: '#8C939E',
  },
  primary: {
    default: '#0D7A64',
    pressed: '#0A5F4E',
    subtle: '#E6F4F1',
  },
  danger: { default: '#B3261E', subtle: '#FDECEA' },
  warning: { default: '#8A5300', subtle: '#FFF4E0' },
  success: { default: '#1B6B3A', subtle: '#E7F5EC' },
  info: { default: '#1A4FA0', subtle: '#E8F0FD' },
  border: {
    hairline: '#E2E5EA',
    strong: '#C8CDD6',
    input: '#8C939E',
    focus: '#0D7A64',
  },
} as const;

type Widen<T> = { readonly [K in keyof T]: { readonly [P in keyof T[K]]: string } };
export type ColorTokens = Widen<typeof lightColor>;

/**
 * Added after the MVP, by the developer rather than the Designer: contrast-checked in
 * `tests/theme/darkPalette.test.ts` but not design-reviewed. Mirrors `color.dark` in
 * `docs/design/tokens.json`. On dark the roles keep their meaning, not their lightness:
 * `primary` and the status hues are the *light* variants (text on a dark surface), and
 * `text.inverse` is near-black because it is what sits on those fills.
 */
export const darkColor: ColorTokens = {
  bg: {
    canvas: '#0F1115',
    surface: '#181B20',
    sunken: '#0A0C0F',
    scrim: 'rgba(0,0,0,0.6)',
  },
  text: {
    primary: '#F3F4F6',
    secondary: '#B4BAC4',
    tertiary: '#9AA1AD',
    inverse: '#06140F',
    disabled: '#6B7280',
  },
  primary: {
    default: '#3DBBA0',
    pressed: '#7FD9C5',
    subtle: '#12302A',
  },
  danger: { default: '#F27C73', subtle: '#3A1816' },
  warning: { default: '#F0B04A', subtle: '#33250C' },
  success: { default: '#5BC083', subtle: '#12281A' },
  info: { default: '#7BA7F2', subtle: '#14233D' },
  border: {
    hairline: '#2A2F37',
    strong: '#3B424C',
    input: '#7A8290',
    focus: '#3DBBA0',
  },
};

export type ColorScheme = 'light' | 'dark';

/** Anything the OS reports other than `dark` (including `null`, "no preference") is light. */
export function resolveScheme(raw: string | null | undefined): ColorScheme {
  return raw === 'dark' ? 'dark' : 'light';
}

/**
 * The light palette, under its old name.
 *
 * Components must not import this: it is one palette, fixed, and a component that read it
 * would stay light in dark mode. They call `useColors()` (`theme/ThemeProvider`) and an
 * ESLint rule keeps this import out of `src/` and `app/`. It remains for tests, which
 * render outside a provider and so see the light default, and for non-React code.
 */
export const color: ColorTokens = lightColor;

/**
 * The ten category hues. Separated by **hue, not lightness** — the closest two are 1.00:1
 * against each other — which is why colour is never the only carrier of category identity
 * (`00-foundations.md` §1.3). Every swatch sits beside the category's name.
 */
export const categoryColor = {
  green: '#2F8044',
  orange: '#A85C12',
  blue: '#2F6FD0',
  indigo: '#5B57C7',
  teal: '#277573',
  red: '#C73B3B',
  pink: '#BC4186',
  purple: '#8E4EC6',
  ochre: '#8A7012',
  slate: '#6B7280',
} as const;

/**
 * The same ten hues lifted for a dark surface (`categoryDark` in the JSON). A category's
 * colour is stored as its light hex, so dark mode maps it at render time instead of
 * rewriting data: `displayCategoryColor`.
 */
export const categoryColorDark = {
  green: '#3A9A54',
  orange: '#C4721F',
  blue: '#4A87E3',
  indigo: '#7370DB',
  teal: '#2F8F8C',
  red: '#DB5555',
  pink: '#D0589B',
  purple: '#A468DA',
  ochre: '#A68A1E',
  slate: '#8A919E',
} as const;

export type CategoryColorToken = keyof typeof categoryColor;

/** The colour to *draw* for a stored category hex. Unknown hexes pass through unchanged. */
export function displayCategoryColor(hex: string, dark: boolean): string {
  if (!dark) return hex;
  const lower = hex.toLowerCase();
  for (const key of Object.keys(categoryColor) as CategoryColorToken[]) {
    if (categoryColor[key].toLowerCase() === lower) return categoryColorDark[key];
  }
  return hex;
}

/**
 * The nine colours offered when creating a category, in the order the sheet lays them out.
 * `slate` is absent on purpose: it is reserved for the `isDefault` category so the
 * fallback stays visually consistent (`07-categories.md` §2 rule 1).
 */
export const CATEGORY_PICKER_ORDER = [
  'green',
  'orange',
  'blue',
  'indigo',
  'teal',
  'red',
  'pink',
  'purple',
  'ochre',
] as const satisfies readonly CategoryColorToken[];

/** The colour the `isDefault` category always wears, and which the picker never offers. */
export const CATEGORY_RESERVED_COLOR = categoryColor.slate;

/**
 * Human names for the swatches. The picker labels each swatch by colour name, because a
 * ring around the selected one is a purely visual cue (`07-categories.md` §5 rule 6).
 */
export const CATEGORY_COLOR_NAMES: Readonly<Record<CategoryColorToken, string>> = {
  green: 'Green',
  orange: 'Orange',
  blue: 'Blue',
  indigo: 'Indigo',
  teal: 'Teal',
  red: 'Red',
  pink: 'Pink',
  purple: 'Purple',
  ochre: 'Ochre',
  slate: 'Slate',
};

/**
 * Every money element sets `fontVariant: ['tabular-nums']` so a column of amounts aligns
 * and digits do not jitter as a total changes (`00-foundations.md` §2).
 */
const TABULAR = ['tabular-nums'] as const;

export const type = {
  amountHero: {
    fontSize: 34,
    lineHeight: 40,
    fontWeight: '700',
    letterSpacing: -0.6,
    fontVariant: TABULAR,
  },
  display: {
    fontSize: 32,
    lineHeight: 40,
    fontWeight: '700',
    letterSpacing: -0.5,
    fontVariant: TABULAR,
  },
  title1: { fontSize: 24, lineHeight: 32, fontWeight: '700', letterSpacing: -0.3 },
  title2: { fontSize: 20, lineHeight: 28, fontWeight: '600', letterSpacing: -0.2 },
  headline: { fontSize: 17, lineHeight: 24, fontWeight: '600', letterSpacing: 0 },
  body: { fontSize: 16, lineHeight: 24, fontWeight: '400', letterSpacing: 0 },
  bodyStrong: { fontSize: 16, lineHeight: 24, fontWeight: '600', letterSpacing: 0 },
  /** `bodyStrong` as used for an amount, which always carries tabular figures. */
  amountRow: {
    fontSize: 16,
    lineHeight: 24,
    fontWeight: '600',
    letterSpacing: 0,
    fontVariant: TABULAR,
  },
  callout: { fontSize: 15, lineHeight: 20, fontWeight: '400', letterSpacing: 0 },
  subhead: { fontSize: 14, lineHeight: 20, fontWeight: '500', letterSpacing: 0 },
  footnote: { fontSize: 13, lineHeight: 18, fontWeight: '400', letterSpacing: 0 },
  caption: { fontSize: 12, lineHeight: 16, fontWeight: '500', letterSpacing: 0.2 },
} as const;

/** 4pt base. `space[4]` is the screen gutter on both edges, always. */
export const space = {
  0: 0,
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  5: 20,
  6: 24,
  8: 32,
  10: 40,
  12: 48,
  16: 64,
} as const;

export const radius = { none: 0, sm: 6, md: 10, lg: 14, pill: 999 } as const;

export const elevation = {
  0: {},
  1: {
    shadowColor: '#111827',
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  2: {
    shadowColor: '#111827',
    shadowOpacity: 0.12,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
} as const;

/**
 * All three collapse to 0ms under Reduce Motion, and transitions become cross-fades.
 * No motion in this app is load-bearing for meaning (`00-foundations.md` §4).
 */
export const motion = {
  fast: { duration: 120 },
  base: { duration: 200 },
  slow: { duration: 280 },
} as const;

/** Row and button heights are **floors**, not fixed heights: they grow with font scale. */
export const size = {
  tapTargetMin: 44,
  rowMinHeight: 56,
  buttonHeight: 48,
  inputHeight: 48,
  fab: 56,
  appBarHeight: 56,
  swatch: 24,
  syncGlyph: 14,
  donutStrokeWidth: 28,
  sliceGapStrokeWidth: 2,
} as const;

export const a11y = {
  contrastBodyMin: 4.5,
  contrastLargeMin: 3,
  snackbarMs: 5000,
  snackbarScreenReaderMs: 10000,
} as const;

/** Grows a glyph's touch area to the 44x44 floor without padding the layout. */
export const HIT_SLOP_44 = { top: 12, bottom: 12, left: 12, right: 12 } as const;
