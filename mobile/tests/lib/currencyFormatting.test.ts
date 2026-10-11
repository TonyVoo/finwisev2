/**
 * EDGE-14 / EDGE-15 — what a money string depends on.
 *
 * `docs/design/04-expense-list.md` rule 5, `05-month-switcher.md` rule 12 and
 * `06-expense-form.md` rules 3 and 12 all render money and dates with
 * `Intl.NumberFormat` / `Intl.DateTimeFormat` using **the device locale**. The plan's
 * `EDGE-03` and `EDGE-12` then assert literal strings — `$12.50`, `¥125`, `¥1,000` — and
 * press a `.` key.
 *
 * These cases separate the two things those literals confuse:
 *
 * - the **number of fraction digits** is a property of the *currency*, so asserting it
 *   needs no locale fixed (EDGE-14);
 * - the **rendered string** — symbol, its position, the group and decimal separators — is
 *   a property of the *locale*, so asserting a literal without fixing one gives two
 *   testers two different verdicts (EDGE-15).
 *
 * **What these cases cannot tell you.** They run under Node's full ICU. The app runs on
 * Hermes, where `Intl` is backed by the platform (Android ICU / Apple formatters) and its
 * coverage is a property of the OS version, not of this repo. A green result here is
 * evidence about the *contract* these design rules rely on, never about a device. That is
 * the point of `GAP 21`, not a limitation to work around: the only automated layer
 * available cannot see the thing EDGE-12 asserts.
 */

/** The fixed list `03-auth.md` rule 8 offers in the signup currency Sheet. */
const DESIGN_CURRENCIES = [
  'USD',
  'EUR',
  'GBP',
  'JPY',
  'CAD',
  'AUD',
  'CHF',
  'INR',
  'BRL',
  'MXN',
] as const;

/** `03-auth.md` rule 9: "2 for all of the above except `JPY`, which is 0". */
const DESIGN_DECIMALS = (code: string): number => (code === 'JPY' ? 0 : 2);

const LOCALES = ['en-US', 'en-GB', 'de-DE', 'fr-FR', 'ja-JP'] as const;

/**
 * `maximumFractionDigits` is optional in the TypeScript lib because a runtime may omit it.
 * Thrown rather than coalesced to a default: a `?? 2` here would silently produce exactly
 * the answer these cases exist to question, and would make an Intl-less runtime look like
 * a two-decimal currency.
 */
const fractionDigits = (locale: string, currency: string): number => {
  const digits = new Intl.NumberFormat(locale, { style: 'currency', currency }).resolvedOptions()
    .maximumFractionDigits;
  if (digits === undefined) {
    throw new Error(`this runtime reports no fraction digits for ${currency} in ${locale}`);
  }
  return digits;
};

const render = (locale: string, currency: string, minor: number): string => {
  const digits = fractionDigits(locale, currency);
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(
    minor / 10 ** digits,
  );
};

describe('EDGE-14 — fraction digits come from the currency, not the locale', () => {
  it('matches the design rule for every currency the signup Sheet offers', () => {
    // Rule 9 states a blanket "2 except JPY". For this closed list that is exactly right
    // in every locale, which is why `EDGE-12` may assert a decimal count without fixing
    // a locale first. The list was evidently chosen to avoid the awkward exponents; this
    // case is what keeps that true if someone adds a currency to the Sheet.
    // Asserted as one map rather than in a loop: jest's `expect` takes no message
    // argument (that is vitest), so a bare loop would report "expected 2, got 0" without
    // saying which of the fifty pairs produced it.
    const measured: Record<string, number> = {};
    const expected: Record<string, number> = {};
    for (const currency of DESIGN_CURRENCIES) {
      for (const locale of LOCALES) {
        measured[`${currency}@${locale}`] = fractionDigits(locale, currency);
        expected[`${currency}@${locale}`] = DESIGN_DECIMALS(currency);
      }
    }
    expect(measured).toEqual(expected);
  });

  it('does not match it for currencies outside the Sheet that the contract still accepts', () => {
    // `CurrencyCode` is `^[A-Z]{3}$` (`shared/src/primitives.ts`), so the server accepts
    // codes the Sheet never offers and rule 9 has no answer for. Rendering an amount with
    // 2 digits when the currency has 3 shows it ten times too large; with 2 when it has 0,
    // a hundred times too small. This is the measurement behind `GAP 21`.
    expect(fractionDigits('en-US', 'KWD')).toBe(3); // 1000 fils = 1.000 KWD, not 10.00
    expect(fractionDigits('en-US', 'KRW')).toBe(0); // 1000 won  = ₩1,000,  not ₩10.00

    const outsideTheSheet = ['KWD', 'BHD', 'TND', 'KRW', 'CLP', 'ISK', 'VND'];
    const measured = Object.fromEntries(
      outsideTheSheet.map((c) => [c, fractionDigits('en-US', c)]),
    );
    // Every one of them differs from the blanket 2 the design would apply.
    expect(measured).toEqual({
      KWD: 3,
      BHD: 3,
      TND: 3,
      KRW: 0,
      CLP: 0,
      ISK: 0,
      VND: 0,
    });
  });

  it('silently gives a non-currency code two digits rather than rejecting it', () => {
    // `XXX` is ISO 4217's own code for "no currency". The regex admits it, and `Intl`
    // formats it without complaint, so nothing in the stack refuses a meaningless amount.
    expect(fractionDigits('en-US', 'XXX')).toBe(2);
    expect(fractionDigits('en-US', 'ZZZ')).toBe(2);
  });
});

describe('EDGE-15 — the rendered string comes from the locale', () => {
  it("produces EDGE-12's literal in en-US and in none of the other four locales", () => {
    // The plan asserts `¥125` and `¥1,000`. Only an en-US device renders that.
    expect(render('en-US', 'JPY', 125)).toBe('¥125');
    expect(render('en-US', 'JPY', 1000)).toBe('¥1,000');

    const others = LOCALES.filter((l) => l !== 'en-US').map((l) => render(l, 'JPY', 125));
    expect(others).not.toContain('¥125');

    // ja-JP is the trap inside the trap: it uses U+FFE5 FULLWIDTH YEN SIGN, which is a
    // different code point from the U+00A5 in the plan and looks identical in a terminal.
    // A tester comparing the two by eye would pass a case that does not match.
    expect(render('ja-JP', 'JPY', 125)).not.toBe('¥125');
    expect(render('ja-JP', 'JPY', 125).codePointAt(0)).toBe(0xffe5);
    expect('¥'.codePointAt(0)).toBe(0x00a5);
  });

  it("produces EDGE-03's dollar literals in en-US and not even in the other English locale", () => {
    // en-GB is the one most likely to be picked up by accident: a UK tester on a UK
    // device renders the same account's amounts with a `US$` prefix.
    expect(render('en-US', 'USD', 1250)).toBe('$12.50');
    expect(render('en-GB', 'USD', 1250)).toBe('US$12.50');
    expect(render('de-DE', 'USD', 1250)).not.toContain('$12.50');
  });

  it("names a decimal key that does not exist on a comma-separator device", () => {
    // `06-expense-form.md` rule 12 labels the decimal key with "the locale decimal
    // separator, `.` or `,`". `EDGE-03` step 2 says to press `.`. On de-DE and fr-FR that
    // key is a comma, so the step as written cannot be followed.
    const separatorFor = (locale: string): string =>
      new Intl.NumberFormat(locale).formatToParts(1.5).find((p) => p.type === 'decimal')!.value;

    expect(separatorFor('en-US')).toBe('.');
    expect(separatorFor('de-DE')).toBe(',');
    expect(separatorFor('fr-FR')).toBe(',');

    // And the group separator the `¥1,000` literal depends on is a dot in de-DE, so the
    // two separators are swapped rather than merely different.
    const groupFor = (locale: string): string =>
      new Intl.NumberFormat(locale).formatToParts(1000).find((p) => p.type === 'group')!.value;

    expect(groupFor('en-US')).toBe(',');
    expect(groupFor('de-DE')).toBe('.');
  });
});
