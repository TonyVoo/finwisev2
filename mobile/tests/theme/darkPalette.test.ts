import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  categoryColor,
  categoryColorDark,
  darkColor,
  displayCategoryColor,
  lightColor,
  resolveScheme,
  type ColorTokens,
} from '@/theme/tokens';

/**
 * The dark palette: parity with `docs/design/tokens.json`, and WCAG contrast for the pairs
 * the app actually draws. Nobody eyeballs a hex, so the numbers are asserted instead.
 */

const design = JSON.parse(
  readFileSync(join(__dirname, '..', '..', '..', 'docs', 'design', 'tokens.json'), 'utf8'),
) as {
  color: { dark: ColorTokens };
  categoryDark: Record<string, string>;
};

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [
    number,
    number,
    number,
  ];
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const c = darkColor;
const surfaces = [c.bg.canvas, c.bg.surface, c.bg.sunken];

describe('dark palette', () => {
  it('matches color.dark in the design tokens, value for value', () => {
    // `scrim` is rgba, compared as a string like everything else.
    expect(darkColor).toEqual(design.color.dark);
    expect(categoryColorDark).toEqual(design.categoryDark);
  });

  it('defines exactly the roles the light palette does', () => {
    for (const [group, values] of Object.entries(lightColor)) {
      expect(Object.keys(darkColor[group as keyof ColorTokens]).sort()).toEqual(
        Object.keys(values).sort(),
      );
    }
  });

  it.each([
    ['primary', c.text.primary, 7],
    ['secondary', c.text.secondary, 4.5],
    ['tertiary', c.text.tertiary, 4.5],
  ])('keeps %s text readable on every surface', (_name, text, minimum) => {
    for (const surface of surfaces) {
      expect(contrast(text, surface)).toBeGreaterThanOrEqual(minimum);
    }
  });

  it('keeps disabled text and input borders at the 3:1 UI minimum on a surface', () => {
    expect(contrast(c.text.disabled, c.bg.surface)).toBeGreaterThanOrEqual(3);
    expect(contrast(c.border.input, c.bg.surface)).toBeGreaterThanOrEqual(3);
    expect(contrast(c.border.input, c.bg.canvas)).toBeGreaterThanOrEqual(3);
    expect(contrast(c.border.focus, c.bg.surface)).toBeGreaterThanOrEqual(3);
  });

  it('keeps the label on a filled button readable', () => {
    expect(contrast(c.text.inverse, c.primary.default)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(c.text.inverse, c.primary.pressed)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(c.text.inverse, c.danger.default)).toBeGreaterThanOrEqual(4.5);
    // The destructive button's pressed fill is a literal in Button.tsx.
    expect(contrast(c.text.inverse, '#D9645C')).toBeGreaterThanOrEqual(4.5);
  });

  it.each(['primary', 'danger', 'warning', 'success', 'info'] as const)(
    'keeps %s readable as text on surfaces and on its own subtle fill',
    (role) => {
      const { default: strong, subtle } = c[role] as { default: string; subtle: string };
      for (const surface of surfaces.slice(0, 2)) {
        expect(contrast(strong, surface)).toBeGreaterThanOrEqual(4.5);
      }
      expect(contrast(strong, subtle)).toBeGreaterThanOrEqual(4.5);
    },
  );

  it('keeps the selected-segment text readable on primary.subtle', () => {
    // `segmentTextSelected` is `primary.pressed` on `primary.subtle`.
    expect(contrast(c.primary.pressed, c.primary.subtle)).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps every category hue at 3:1 against the surface it sits on', () => {
    for (const hex of Object.values(categoryColorDark)) {
      expect(contrast(hex, c.bg.surface)).toBeGreaterThanOrEqual(3);
    }
  });
});

describe('displayCategoryColor', () => {
  it('is the identity in light mode', () => {
    expect(displayCategoryColor(categoryColor.indigo, false)).toBe(categoryColor.indigo);
  });

  it('lifts each stored palette hex in dark mode, whatever the hex casing', () => {
    expect(displayCategoryColor(categoryColor.indigo, true)).toBe(categoryColorDark.indigo);
    expect(displayCategoryColor(categoryColor.teal.toLowerCase(), true)).toBe(
      categoryColorDark.teal,
    );
  });

  it('leaves a hex it does not know alone', () => {
    expect(displayCategoryColor('#123456', true)).toBe('#123456');
  });
});

describe('scheme resolution', () => {
  it('is dark only when the system says dark', () => {
    expect(resolveScheme('dark')).toBe('dark');
    expect(resolveScheme('light')).toBe('light');
    expect(resolveScheme(null)).toBe('light');
    expect(resolveScheme(undefined)).toBe('light');
  });
});
