import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CategoryColor, DEFAULT_CATEGORIES, ERROR_CODES, LIMITS } from '../src/index.js';

/**
 * Design-token parity: `docs/design/` is the source of truth for how the app looks, and
 * `shared/src` is the source of truth for what crosses the wire. The two overlap in exactly
 * three places — the seeded category list, the error-code list, and the password limits — and
 * each overlap is duplicated into prose a human maintains by hand.
 *
 * These tests fail the build when a doc and the contract disagree. Without them the design
 * specs are a document that *looked* right the day it was written: someone renames a seeded
 * category in `shared/`, nothing breaks, and the Mobile Dev builds the old list from a spec
 * that is now quietly wrong. Prose cannot be type-checked, so it gets asserted instead.
 *
 * The contrast assertions are here for the same reason. "All ten clear 4.5:1" is a measurable
 * claim, and a token palette that stops meeting it is an accessibility regression that no
 * amount of review catches by eye.
 */

const FOUNDATIONS = readFileSync(
  new URL('../../docs/design/00-foundations.md', import.meta.url),
  'utf8',
);
const COPY_DECK = readFileSync(
  new URL('../../docs/design/09-copy-deck.md', import.meta.url),
  'utf8',
);
const TOKENS = JSON.parse(
  readFileSync(new URL('../../docs/design/tokens.json', import.meta.url), 'utf8'),
) as Tokens;

interface Tokens {
  readonly color: { readonly light: { readonly bg: Record<string, string> } };
  readonly category: Record<string, string>;
  readonly categoryPickerOrder: readonly string[];
  readonly categoryReservedColor: { readonly token: string; readonly hex: string };
  readonly defaultCategories: {
    readonly items: readonly {
      readonly name: string;
      readonly colorToken: string;
      readonly color: string;
      readonly isDefault: boolean;
    }[];
  };
  readonly a11y: { readonly contrastBodyMin: number; readonly contrastLargeMin: number };
}

/** The palette, minus the `$note` key the token file carries for human readers. */
const palette = Object.fromEntries(
  Object.entries(TOKENS.category).filter(([key]) => !key.startsWith('$')),
);

/** WCAG 2.1 relative luminance. https://www.w3.org/TR/WCAG21/#dfn-relative-luminance */
function luminance(hex: string): number {
  const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

/** WCAG 2.1 contrast ratio, 1:1 to 21:1. */
function contrast(a: string, b: string): number {
  const [lo, hi] = [luminance(a), luminance(b)].sort((x, y) => x - y);
  return (hi! + 0.05) / (lo! + 0.05);
}

/** Rows of a GitHub-flavoured markdown table, as trimmed cell arrays. */
function tableRows(section: string): string[][] {
  return section
    .split('\n')
    .filter((line) => line.trimStart().startsWith('|'))
    .map((line) =>
      line
        .trim()
        .replace(/^\||\|$/g, '')
        .split('|')
        .map((cell) => cell.trim()),
    )
    .filter((cells) => !cells.every((cell) => /^:?-{2,}:?$/.test(cell) || cell === ''));
}

/** The markdown between a heading and the next heading at the same or a higher level. */
function section(doc: string, heading: string): string {
  const start = doc.indexOf(heading);
  expect(start, `heading not found: ${heading}`).toBeGreaterThan(-1);
  const depth = heading.match(/^#+/)![0].length;
  const after = doc.slice(start + heading.length);
  const next = after.search(new RegExp(`^#{1,${depth}} `, 'm'));
  return next === -1 ? after : after.slice(0, next);
}

/** Strips markdown emphasis and code fencing from a table cell. */
function plain(cell: string): string {
  return cell.replace(/[*`]/g, '').trim();
}

describe('contrast helper', () => {
  // Anchors the helper against the two ratios WCAG itself fixes, so a bug in the maths
  // cannot quietly make the palette assertions below pass.
  it('matches the known extremes', () => {
    expect(contrast('#000000', '#FFFFFF')).toBeCloseTo(21, 5);
    expect(contrast('#FFFFFF', '#FFFFFF')).toBeCloseTo(1, 5);
  });

  it('is symmetric', () => {
    expect(contrast('#2F8044', '#FFFFFF')).toBeCloseTo(contrast('#FFFFFF', '#2F8044'), 10);
  });
});

describe('category palette', () => {
  const surface = TOKENS.color.light.bg.surface!;

  it('is a non-trivial set of valid #RRGGBB colours', () => {
    expect(Object.keys(palette).length).toBeGreaterThanOrEqual(6);
    for (const [token, hex] of Object.entries(palette)) {
      expect(CategoryColor.safeParse(hex), `category.${token} = ${hex}`).toMatchObject({
        success: true,
      });
    }
  });

  it('clears the documented body-text contrast floor on bg.surface', () => {
    // 00-foundations.md §1.3 claims every category colour is safe as a swatch, a chart
    // slice, *or text*. Text is the strict case, so the floor is contrastBodyMin.
    for (const [token, hex] of Object.entries(palette)) {
      expect(
        contrast(hex, surface),
        `category.${token} (${hex}) on bg.surface`,
      ).toBeGreaterThanOrEqual(TOKENS.a11y.contrastBodyMin);
    }
  });

  it('offers every colour except the reserved one in the picker', () => {
    const reserved = TOKENS.categoryReservedColor;
    expect(palette[reserved.token]).toBe(reserved.hex);
    expect([...TOKENS.categoryPickerOrder].sort()).toEqual(
      Object.keys(palette)
        .filter((token) => token !== reserved.token)
        .sort(),
    );
  });

  it('matches the hexes and the measured ratios in 00-foundations.md §1.3', () => {
    const rows = tableRows(section(FOUNDATIONS, '### 1.3 Default category colour set')).slice(1);
    const documented = rows.map((cells) => ({
      token: plain(cells[1]!).replace('category.', ''),
      hex: plain(cells[2]!),
      ratio: Number(plain(cells[3]!)),
    }));

    expect(documented.length).toBe(Object.keys(palette).length);
    for (const { token, hex, ratio } of documented) {
      expect(palette[token], `category.${token} in the doc but not in tokens.json`).toBe(hex);
      // The doc quotes each ratio to 2dp; a drifting hex would move it.
      expect(contrast(hex, surface), `documented ratio for category.${token}`).toBeCloseTo(
        ratio,
        2,
      );
    }
  });
});

describe('seeded categories', () => {
  const items = TOKENS.defaultCategories.items;

  it('mirrors DEFAULT_CATEGORIES in name, order and isDefault', () => {
    expect(items.map((c) => [c.name, c.isDefault])).toEqual(
      DEFAULT_CATEGORIES.map((c) => [c.name, c.isDefault]),
    );
  });

  it('has exactly one protected category, and it is first in seed order', () => {
    // 00-foundations.md §7 note 1. The fallback is resolved by flag, never by name, so
    // "exactly one" is a correctness requirement and not a tidiness one.
    expect(items.filter((c) => c.isDefault)).toHaveLength(1);
    expect(items[0]!.isDefault).toBe(true);
    expect(DEFAULT_CATEGORIES.filter((c) => c.isDefault)).toHaveLength(1);
    expect(DEFAULT_CATEGORIES[0].isDefault).toBe(true);
  });

  it('resolves every colorToken to the palette hex it names', () => {
    for (const { name, colorToken, color } of items) {
      expect(palette[colorToken], `${name} names category.${colorToken}`).toBe(color);
    }
  });

  it('gives the protected category the reserved colour, and the rest picker colours', () => {
    const [fallback, ...rest] = items;
    expect(fallback!.colorToken).toBe(TOKENS.categoryReservedColor.token);
    for (const category of rest) {
      expect(
        TOKENS.categoryPickerOrder,
        `${category.name} should use a picker colour, not the reserved one`,
      ).toContain(category.colorToken);
    }
  });

  it('matches the mirror table in 00-foundations.md §7', () => {
    const rows = tableRows(section(FOUNDATIONS, '## 7. Default categories seeded on signup')).slice(
      1,
    );
    const documented = rows.map((cells) => ({
      name: plain(cells[1]!),
      colorToken: plain(cells[2]!).replace('category.', ''),
      hex: plain(cells[3]!),
      isDefault: plain(cells[4]!) === 'true',
    }));

    expect(documented).toEqual(
      items.map((c) => ({
        name: c.name,
        colorToken: c.colorToken,
        hex: c.color,
        isDefault: c.isDefault,
      })),
    );
  });
});

describe('copy deck', () => {
  const errorSection = section(COPY_DECK, '### 2.1 Error code → message');
  const errorRows = tableRows(errorSection).slice(1);
  const mapped = errorRows.map((cells) => plain(cells[0]!));

  it('maps every contract error code exactly once', () => {
    // An unmapped code reaching a user renders a blank banner, which is the failure the
    // copy deck exists to prevent. Set equality, so a stale code is caught too.
    expect([...mapped].sort()).toEqual([...ERROR_CODES].sort());
  });

  it('gives every shown code a non-empty message and a placement', () => {
    for (const cells of errorRows) {
      const [code, message, placement] = cells.map(plain);
      expect(message, `${code} has no message`).not.toBe('');
      expect(placement, `${code} has no placement`).not.toBe('');
      // Codes handled transparently say so in both columns; the rest name a surface.
      if (message!.includes('(never shown)')) {
        expect(placement, `${code} is never shown but names a placement`).toBe('none');
      } else {
        expect(placement, `${code} is shown but has no surface`).not.toBe('none');
      }
    }
  });

  it('states the never-shown count the table actually contains', () => {
    const words: Record<string, number> = {
      Two: 2,
      Three: 3,
      Four: 4,
      Five: 5,
      Six: 6,
      Seven: 7,
      Eight: 8,
    };
    const claim = errorSection.match(/\*\*(\w+) codes are never shown\.\*\*/);
    expect(claim, 'the never-shown count note is missing').not.toBeNull();
    const actual = errorRows.filter((cells) => plain(cells[1]!).includes('(never shown)')).length;
    expect(words[claim![1]!], `the note claims "${claim![1]}"`).toBe(actual);
  });

  it('quotes the password limits the contract enforces', () => {
    // These two strings are the only place the design states a number the server owns.
    const validation = section(COPY_DECK, '### 2.2 Field validation');
    expect(validation).toContain(`Use at least ${LIMITS.PASSWORD_MIN} characters.`);
    expect(validation).toContain(`Use at most ${LIMITS.PASSWORD_MAX} characters.`);
  });
});

describe('design docs', () => {
  const DOCS = [
    '00-foundations.md',
    '01-flows.md',
    '02-offline-and-sync.md',
    '03-auth.md',
    '04-expense-list.md',
    '05-month-switcher.md',
    '06-expense-form.md',
    '07-categories.md',
    '08-monthly-summary.md',
    '09-copy-deck.md',
    'README.md',
  ] as const;

  it.each(DOCS)('%s states behaviour for everything it names', (name) => {
    // The task's hard requirement: "no TBD, no element without stated behaviour". A spec
    // with a placeholder in it is a question the Mobile Dev has to stop and ask.
    //
    // Quoted and backticked mentions are allowed through: README.md §Conventions has to be
    // able to say that "TBD" is not an acceptable value without tripping this.
    const doc = readFileSync(new URL(`../../docs/design/${name}`, import.meta.url), 'utf8');
    const prose = doc.replace(/"[^"\n]*"|`[^`\n]*`/g, '');
    expect(prose, `${name} contains a placeholder`).not.toMatch(/\bTBD\b|\bTODO\b|\bFIXME\b|\?{3}/);
  });

  it.each(DOCS)('%s links only to design docs that exist', (name) => {
    const doc = readFileSync(new URL(`../../docs/design/${name}`, import.meta.url), 'utf8');
    const links = [...doc.matchAll(/\]\(\.\/([\w.-]+\.(?:md|json))(?:#[\w-]*)?\)/g)].map(
      (m) => m[1]!,
    );
    for (const target of new Set(links)) {
      expect([...DOCS, 'tokens.json'], `${name} links to ./${target}`).toContain(target);
    }
  });
});
