import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CATEGORY_PICKER_ORDER,
  CATEGORY_RESERVED_COLOR,
  a11y,
  categoryColor,
  color,
  elevation,
  motion,
  radius,
  size,
  space,
  type,
} from '@/theme/tokens';

/**
 * `src/theme/tokens.ts` must agree with `docs/design/tokens.json`, value for value.
 *
 * The JSON is the Designer's export and the source of truth; the TypeScript is a mirror
 * that exists only because the JSON lives outside the Expo project root and Metro will
 * not resolve it. A mirror with nothing checking it is a copy that drifts, and the
 * failure mode is quiet: a colour changes in the design, the app keeps shipping the old
 * hex, and nobody diffs a hex by eye. So this suite reads the JSON off disk and compares.
 *
 * Three places the two representations are deliberately *not* identical. Each is checked
 * in its own case rather than excluded, so "different" cannot silently become "wrong":
 *
 * - **Type tokens** carry `tabularNums: true` in the JSON and `fontVariant:
 *   ['tabular-nums']` in the TypeScript, because the latter is what a React Native
 *   `Text` style takes.
 * - **Elevation** carries `androidElevation` in the JSON and `elevation` in the
 *   TypeScript, same reason; and `elevation[0]` is an empty style object rather than an
 *   explicit zero shadow, because spreading `shadowOpacity: 0` onto a view is not the
 *   same thing as spreading nothing.
 * - **Motion** carries an `easing` string the TypeScript omits: easing is an argument to
 *   the animation that consumes the duration, not a style value, so it is applied at the
 *   call site.
 *
 * `type.amountRow` has no JSON counterpart at all — it is `bodyStrong` as used for an
 * amount, which `00-foundations.md` §2 requires to be tabular. It is derived here rather
 * than retyped, and the last case pins that derivation.
 */

interface TypeToken {
  readonly fontSize: number;
  readonly lineHeight: number;
  readonly fontWeight: string;
  readonly letterSpacing: number;
  readonly tabularNums?: boolean;
}

interface ElevationToken {
  readonly shadowColor?: string;
  readonly shadowOpacity: number;
  readonly shadowRadius?: number;
  readonly shadowOffset?: { readonly width: number; readonly height: number };
  readonly androidElevation: number;
}

interface DesignTokens {
  readonly color: { readonly light: Readonly<Record<string, Record<string, string>>> };
  readonly category: Readonly<Record<string, string>>;
  readonly categoryPickerOrder: readonly string[];
  readonly categoryReservedColor: { readonly token: string; readonly hex: string };
  readonly type: Readonly<Record<string, TypeToken>>;
  readonly space: Readonly<Record<string, number>>;
  readonly radius: Readonly<Record<string, number>>;
  readonly elevation: Readonly<Record<string, ElevationToken>>;
  readonly motion: Readonly<Record<string, { readonly duration: number }>>;
  readonly size: Readonly<Record<string, number>>;
  readonly a11y: Readonly<Record<string, number>>;
}

const TOKENS_PATH = join(__dirname, '..', '..', '..', 'docs', 'design', 'tokens.json');

const design = JSON.parse(readFileSync(TOKENS_PATH, 'utf8')) as DesignTokens;

/** Keys the export uses for prose rather than for values. */
function valueKeys(record: Readonly<Record<string, unknown>>): string[] {
  return Object.keys(record).filter((key) => !key.startsWith('$'));
}

describe('design tokens mirror docs/design/tokens.json', () => {
  it('reads the export the Designer owns', () => {
    // Guards the rest of the suite: a moved or renamed export would otherwise make every
    // case below pass against an empty object.
    expect(valueKeys(design.color.light)).not.toHaveLength(0);
  });

  it('carries every semantic colour at the same hex', () => {
    for (const group of valueKeys(design.color.light)) {
      const expected = design.color.light[group] as Record<string, string>;
      expect({ [group]: color[group as keyof typeof color] }).toEqual({ [group]: expected });
    }
  });

  it('declares no colour group the export does not have', () => {
    // The other direction. A group added here and not to the export is a hex that was
    // typed into the app rather than designed, which is what §1.1 forbids.
    expect(Object.keys(color).sort()).toEqual(valueKeys(design.color.light).sort());
  });

  it('carries the ten category hues', () => {
    expect(categoryColor).toEqual(
      Object.fromEntries(valueKeys(design.category).map((key) => [key, design.category[key]])),
    );
  });

  it('offers the picker colours in the export order, reserving slate', () => {
    expect(CATEGORY_PICKER_ORDER).toEqual(design.categoryPickerOrder);
    expect(CATEGORY_RESERVED_COLOR).toBe(design.categoryReservedColor.hex);

    // The reserved colour is the one the picker must not offer (`00-foundations.md` §1.3).
    expect(CATEGORY_PICKER_ORDER).not.toContain(design.categoryReservedColor.token);
  });

  it('carries every type token, with tabular figures expressed as a React Native style', () => {
    for (const token of valueKeys(design.type)) {
      const { tabularNums, ...metrics } = design.type[token] as TypeToken;
      const expected =
        tabularNums === true ? { ...metrics, fontVariant: ['tabular-nums'] } : metrics;

      expect({ [token]: type[token as keyof typeof type] }).toEqual({ [token]: expected });
    }
  });

  it('derives amountRow from bodyStrong rather than retyping it', () => {
    // No JSON counterpart: it is `bodyStrong` used for an amount, and money is always
    // tabular (`00-foundations.md` §2).
    expect(type.amountRow).toEqual({ ...type.bodyStrong, fontVariant: ['tabular-nums'] });
  });

  it('carries the spacing, radius and size scales', () => {
    const numericScale = (record: Readonly<Record<string, number>>) =>
      Object.fromEntries(valueKeys(record).map((key) => [key, record[key]]));

    expect(space).toEqual(numericScale(design.space));
    expect(radius).toEqual(numericScale(design.radius));
    expect(size).toEqual(numericScale(design.size));
    expect(a11y).toEqual(numericScale(design.a11y));
  });

  it('carries the two real elevations, naming Android elevation as the style does', () => {
    for (const level of ['1', '2'] as const) {
      const { androidElevation, ...shadow } = design.elevation[level] as ElevationToken;

      expect({ [level]: elevation[level] }).toEqual({
        [level]: { ...shadow, elevation: androidElevation },
      });
    }
  });

  it('renders elevation 0 as no shadow at all', () => {
    // The export states an explicit zero; the style omits the properties entirely, which
    // is not the same thing to spread onto a view.
    expect(elevation[0]).toEqual({});
    expect(design.elevation['0']?.shadowOpacity).toBe(0);
  });

  it('carries the motion durations', () => {
    for (const token of valueKeys(design.motion)) {
      // Easing is an argument to the animation, not a style value, so only the duration
      // is mirrored.
      expect({ [token]: motion[token as keyof typeof motion] }).toEqual({
        [token]: { duration: design.motion[token]?.duration },
      });
    }
  });
});
