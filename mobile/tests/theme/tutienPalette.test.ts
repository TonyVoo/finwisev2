import {
  TUTIEN_INK,
  categoryColorDark,
  darkColor,
  tutienColor,
  type ColorTokens,
} from '@/theme/tokens';

/** The cultivation palette: the same roles as the others, and WCAG contrast for the pairs the app draws. */

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

const c = tutienColor;
// The canvas is transparent over the scenery, whose ground is ink: contrast is measured against that.
const surfaces = [TUTIEN_INK, c.bg.surface, c.bg.sunken];

describe('tutien palette', () => {
  it('defines exactly the roles the dark palette does', () => {
    for (const [group, values] of Object.entries(darkColor)) {
      expect(Object.keys(c[group as keyof ColorTokens]).sort()).toEqual(Object.keys(values).sort());
    }
  });

  it.each([
    ['primary', c.text.primary, 7],
    ['secondary', c.text.secondary, 4.5],
    ['tertiary', c.text.tertiary, 4.5],
  ])('keeps %s text readable on every surface', (_name, text, minimum) => {
    for (const surface of surfaces) expect(contrast(text, surface)).toBeGreaterThanOrEqual(minimum);
  });

  it('keeps disabled text, input borders and the focus ring at 3:1', () => {
    expect(contrast(c.text.disabled, c.bg.surface)).toBeGreaterThanOrEqual(3);
    expect(contrast(c.border.input, c.bg.surface)).toBeGreaterThanOrEqual(3);
    expect(contrast(c.border.focus, c.bg.surface)).toBeGreaterThanOrEqual(3);
  });

  it('keeps the label on a filled button readable', () => {
    expect(contrast(c.text.inverse, c.primary.default)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(c.text.inverse, c.primary.pressed)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(c.text.inverse, c.danger.default)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(['primary', 'danger', 'warning', 'success', 'info'] as const)(
    'keeps %s readable as text on surfaces and on its own subtle fill',
    (role) => {
      const { default: strong, subtle } = c[role] as { default: string; subtle: string };
      for (const surface of surfaces.slice(0, 2))
        expect(contrast(strong, surface)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(strong, subtle)).toBeGreaterThanOrEqual(4.5);
    },
  );

  it('keeps the selected-segment text readable on primary.subtle', () => {
    expect(contrast(c.primary.pressed, c.primary.subtle)).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps the lifted category hues at 3:1 on its surface', () => {
    for (const hex of Object.values(categoryColorDark))
      expect(contrast(hex, c.bg.surface)).toBeGreaterThanOrEqual(3);
  });
});
