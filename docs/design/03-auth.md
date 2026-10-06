# 1. Auth — Welcome, Sign up, Log in

Owner: Designer · Last updated: 2026-10-06

Three screens in the `(auth)` route group. Flows: [`01-flows.md`](./01-flows.md) §2 and §3.

**These are the only two screens in the app that wait on the network** (Sign up and Log in).
Everything after them is local-first. See [`02-offline-and-sync.md`](./02-offline-and-sync.md)
§1.

There is no "Forgot password?" link, no email verification, and no social login — see
[`01-flows.md`](./01-flows.md) §6 for why each is absent.

---

## 1.1 Welcome

### Purpose

Give a first-time user the two doors in and nothing else.

### Route

`/(auth)/welcome` — the initial route when no session exists in `expo-secure-store`.

### Layout

```
+--------------------------------+
|                                |   space.16 from safe top
|           (wallet mark)        |   64x64
|                                |   space.12
|      Expense Tracker           |   type.title1, centred
|                                |   space.3
|   Know where your money        |   type.body, text.secondary,
|   goes, online or not.         |   centred, max 2 lines
|                                |
|                                |   flex spacer
|  +--------------------------+  |
|  |     Create account       |  |   Button primary, full width
|  +--------------------------+  |
|                                |   space.3
|  +--------------------------+  |
|  |  I already have an account| |   Button secondary, full width
|  +--------------------------+  |
|                                |   space.4 + bottom inset
+--------------------------------+
```

### Elements

| #   | Element        | Style                                   | Copy                                         | Tap target       | Accessibility                             |
| --- | -------------- | --------------------------------------- | -------------------------------------------- | ---------------- | ----------------------------------------- |
| 1   | Logo mark      | 64x64, `primary.default`                | —                                            | none             | `accessibilityElementsHidden`, decorative |
| 2   | App name       | `type.title1` / `text.primary`, centred | `Expense Tracker`                            | none             | `role="header"`                           |
| 3   | Tagline        | `type.body` / `text.secondary`, centred | `Know where your money goes, online or not.` | none             | read after 2                              |
| 4   | Primary CTA    | `Button` `primary`, full width, 48      | `Create account`                             | full button, ≥48 | `role="button"`, label `Create account`   |
| 5   | Secondary CTA  | `Button` `secondary`, full width, 48    | `I already have an account`                  | full button, ≥48 | `role="button"`, label as written         |
| 6   | Session notice | see States                              | —                                            | —                | announced on mount                        |

Screen gutter `space.4`. Buttons sit above `space.4` + bottom safe inset.

### States

| State                     | What the user sees                                                                                                                                                                                                                                                                                                             |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `default`                 | As drawn above.                                                                                                                                                                                                                                                                                                                |
| `empty`                   | Not applicable — this screen renders no data. Stated so it is not read as an omission.                                                                                                                                                                                                                                         |
| `loading`                 | None. Nothing is fetched. The session check is a synchronous `expo-secure-store` read done behind the splash screen, so Welcome never renders a spinner.                                                                                                                                                                       |
| `error`                   | **No reachable error state.** Nothing on this screen performs I/O.                                                                                                                                                                                                                                                             |
| `offline-pending`         | Identical to `default`. **No offline banner and no sync pill** — a user with no account has nothing to sync, and warning them about connectivity before they have tried anything is noise. Offline is surfaced on the Sign up / Log in attempt, where it is actionable.                                                        |
| _Session-expired variant_ | An `info.subtle` banner above element 2, `radius.md`, `space.3` padding, `type.footnote` / `info.default`: `Your session expired. Please log in again.` Shown only when arriving here from a `token_invalid` refresh failure ([`01-flows.md`](./01-flows.md) §3). Dismissed when the user taps either CTA. Announced on mount. |

### Behaviour

1. `Create account` pushes `/(auth)/signup`. `I already have an account` pushes `/(auth)/login`.
2. Welcome is the **root of the `(auth)` stack**. There is no back affordance.
3. Reaching Welcome after logout or token expiry **replaces** the navigation stack, so Android
   back from here exits the app rather than returning to Home with a dead session.
4. The session-expired banner is state carried by the navigation action, not persisted. A cold
   launch that happens to have no token shows no banner — the user was not kicked out, they
   simply are not logged in, and claiming otherwise is a lie.

### Accessibility

- Focus order: 2 → 3 → 4 → 5, with the banner first when present.
- Both CTAs clear 48pt. Tagline and app name are not touchable and expose no `role="button"`.
- Centred text is used only here, for ≤2 lines. Body copy elsewhere is leading-aligned.

---

## 1.2 Sign up

### Purpose

Create an account and a session. The one screen that genuinely requires connectivity.

### Route

`/(auth)/signup`

### Layout

```
+--------------------------------+
| (<)                            |   app bar, back only, no title
+--------------------------------+
|  Create your account           |   type.title1
|                                |   space.6
|  Email                         |   type.subhead, text.secondary
|  +--------------------------+  |
|  |                          |  |   TextField, 48
|  +--------------------------+  |
|  helper / error               |   type.footnote
|                                |   space.4
|  Password                      |
|  +--------------------------+  |
|  |                     (eye)|  |   TextField with reveal toggle
|  +--------------------------+  |
|  At least 8 characters        |   type.footnote, text.tertiary
|                                |   space.4
|  Currency                      |
|  +--------------------------+  |
|  | USD - US Dollar       (v)|  |   Select row, opens sheet
|  +--------------------------+  |
|  You cannot change this later. |   type.footnote, text.tertiary
|                                |   space.6
|  +--------------------------+  |
|  |      Create account      |  |   Button primary, full width
|  +--------------------------+  |
|                                |
+--------------------------------+
```

### Elements

| #   | Element            | Style                                                                    | Copy                                         | Tap target          | Accessibility                                                                                                                            |
| --- | ------------------ | ------------------------------------------------------------------------ | -------------------------------------------- | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Back               | `chevron-left` 24, `text.primary`                                        | —                                            | 44x44 `hitSlop`     | `role="button"`, label `Back`                                                                                                            |
| 2   | Title              | `type.title1` / `text.primary`                                           | `Create your account`                        | none                | `role="header"`                                                                                                                          |
| 3   | Email label        | `type.subhead` / `text.secondary`                                        | `Email`                                      | none                | bound to 4                                                                                                                               |
| 4   | Email field        | `TextField`                                                              | placeholder `you@example.com`                | 48 tall, full width | `keyboardType="email-address"`, `autoCapitalize="none"`, `autoComplete="email"`, `textContentType="emailAddress"`, `autoCorrect={false}` |
| 5   | Email helper/error | `type.footnote`                                                          | empty by default; errors in §Behaviour       | none                | error text is in the field's `accessibilityLabel`                                                                                        |
| 6   | Password label     | `type.subhead` / `text.secondary`                                        | `Password`                                   | none                | bound to 7                                                                                                                               |
| 7   | Password field     | `TextField`, `secureTextEntry`                                           | placeholder empty                            | 48 tall             | `autoComplete="new-password"`, `textContentType="newPassword"`                                                                           |
| 8   | Reveal toggle      | `eye` / `eye-off` 20, `text.tertiary`, trailing inside 7                 | —                                            | 44x44 `hitSlop`     | `role="button"`, label `Show password` / `Hide password`                                                                                 |
| 9   | Password helper    | `type.footnote` / `text.tertiary`                                        | `At least 8 characters`                      | none                | read as the field's hint                                                                                                                 |
| 10  | Currency label     | `type.subhead` / `text.secondary`                                        | `Currency`                                   | none                | bound to 11                                                                                                                              |
| 11  | Currency select    | 48-tall row, `radius.md`, 1px `border.input`, trailing `chevron-down` 20 | `{code} - {name}`, default `USD - US Dollar` | full row, 48        | `role="button"`, label `Currency, USD US Dollar. Double tap to change.`                                                                  |
| 12  | Currency helper    | `type.footnote` / `text.tertiary`                                        | `You cannot change this later.`              | none                | read as 11's hint                                                                                                                        |
| 13  | Submit             | `Button` `primary`, full width                                           | `Create account`                             | full button, 48     | `role="button"`; Busy label `Create account, in progress`                                                                                |
| 14  | Form error banner  | see States                                                               | —                                            | —                   | announced                                                                                                                                |

### States

| State             | What the user sees                                                                                                                                                                                                                                                                                                                                                                              |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `default`         | Email and Password empty, Currency prefilled `USD - US Dollar`, Submit **enabled**. See Behaviour rule 1 for why it is not disabled.                                                                                                                                                                                                                                                            |
| `empty`           | Not applicable — the screen renders no list data.                                                                                                                                                                                                                                                                                                                                               |
| `loading`         | Only the Submit button's **Busy** state while `POST /v1/auth/signup` is in flight: label replaced by a 20px `ActivityIndicator`, width held, taps ignored, fields become `editable={false}` but keep their normal colours. No full-screen spinner, no scrim.                                                                                                                                    |
| `error`           | Three distinct shapes, by cause — see Behaviour rules 4-6. Field-level errors (invalid email, short password) render in each field's helper slot. `email_already_exists` renders on the Email field plus a `Log in instead` link. Transport failure renders the offline banner.                                                                                                                 |
| `offline-pending` | **This screen is the exception in the app: offline genuinely blocks it.** On submit with no connectivity, a `danger.subtle` banner, `radius.md`, `space.3` padding, `type.footnote` / `danger.default`, with an `alert-circle` 16 leading: `You need to be online to create an account.` Submit returns to enabled. Fields keep their values — nothing is cleared. No sync pill on this screen. |

### Behaviour

1. **Submit is enabled from the first frame**, before anything is typed. Tapping it with empty
   fields runs validation and reveals the errors. A button disabled until a form is valid
   leaves the user with no way to find out _what_ is wrong — they tap a dead control and get
   nothing. (This is the one justified exception to `00-foundations.md` §6's
   "disabled needs a stated reason" rule: the button is simply never disabled here.)
2. **Validation timing.** A field is validated on blur, and re-validated on every keystroke
   _only after_ it has first shown an error — so an error clears as the user fixes it but never
   appears while they are still typing the value for the first time. Submit validates all
   fields regardless of whether they were touched.
3. **Client validation rules**, from `shared/src/user.ts`:
   - Email: non-empty and parses as an email → `Enter a valid email address.`
   - Password: ≥8 and ≤128 characters → `Use at least 8 characters.` / `Use at most 128 characters.`
   - The client never checks password composition. The contract requires length only, and
     inventing extra rules the server does not enforce makes the client lie.
4. **`409 email_already_exists`** → Email field error state, copy
   `That email is already registered.`, plus a `Log in instead` ghost link directly below the
   helper text (44 target) that navigates to `/(auth)/login` **carrying the typed email** so it
   is prefilled and only the password is needed.
5. **`400 validation_error`** → map `error.details.issues[].path` onto the matching field and
   render `issues[].message` in its helper slot. A path that matches no field on screen falls
   back to the form-level banner with the generic copy from
   [`09-copy-deck.md`](./09-copy-deck.md) §2. The UI never shows a raw `path` string.
6. **`429 rate_limited`** → form-level banner, copy `Too many attempts. Try again in a moment.`
   Submit stays enabled. The app does not implement a countdown from `Retry-After` in the MVP;
   the copy is deliberately vague rather than displaying a timer the user must watch.
7. **On `201`, in this order, in one SQLite transaction:** persist `accessToken` +
   `refreshToken` to `expo-secure-store`, write the `user` row, seed the default categories
   from [`00-foundations.md`](./00-foundations.md) §7 with client-minted UUIDv7 ids, and enqueue
   them in the outbox. Then `router.replace('/(app)')`. **No success toast** — arriving at Home
   is the confirmation.
8. **Currency.** The select opens a `Sheet` listing `USD`, `EUR`, `GBP`, `JPY`, `CAD`, `AUD`,
   `CHF`, `INR`, `BRL`, `MXN` as `{code} - {name}` rows with a trailing `check` on the current
   one. It is sent as `SignupRequest.currency`, which the contract accepts and defaults to
   `USD` when omitted. The MVP offers a fixed list, not an ISO 4217 search.
9. **`JPY` has no minor unit.** The chosen currency determines `decimals` (2 for all of the
   above except `JPY`, which is 0), and that value drives the amount keypad in
   [`06-expense-form.md`](./06-expense-form.md) §Behaviour rule 3. Picking `JPY` at signup must
   produce a keypad with no decimal places, not a 2-decimal keypad on a 0-decimal currency.
10. **Password is never cleared** on any error. Clearing it on a failed attempt is a punishment
    for a typo in a different field.
11. Back returns to Welcome, discarding input without a confirmation prompt — nothing of value
    has been created yet.

### Accessibility

- Focus order: 1 → 2 → 4 → 7 → 8 → 11 → 13, with a form-level banner inserted after 2.
- The keyboard must not cover the Submit button: the screen is a `KeyboardAvoidingView` inside
  a scroll view, and submitting is also reachable via the keyboard's **Go** key from the
  Password field.
- `returnKeyType`: Email `next` → focuses Password; Password `go` → submits.
- On a validation failure, focus moves to the **first** field in error and its message is
  announced. Errors are never announced as a batch.
- Every error message is a complete sentence with terminal punctuation, so a screen reader does
  not run it into the next element.

---

## 1.3 Log in

### Purpose

Restore a session for a returning user.

### Route

`/(auth)/login`

### Layout

```
+--------------------------------+
| (<)                            |   app bar, back only
+--------------------------------+
|  Welcome back                  |   type.title1
|                                |   space.6
|  Email                         |
|  +--------------------------+  |
|  |                          |  |
|  +--------------------------+  |
|                                |   space.4
|  Password                      |
|  +--------------------------+  |
|  |                     (eye)|  |
|  +--------------------------+  |
|                                |   space.6
|  +--------------------------+  |
|  |          Log in          |  |   Button primary, full width
|  +--------------------------+  |
|                                |
+--------------------------------+
```

### Elements

Identical to §1.2 elements 1, 3-8 and 13-14, with these differences:

| #   | Element        | Style                          | Copy           | Notes                                                           |
| --- | -------------- | ------------------------------ | -------------- | --------------------------------------------------------------- |
| 2   | Title          | `type.title1` / `text.primary` | `Welcome back` | `role="header"`                                                 |
| 7   | Password field | `TextField`, `secureTextEntry` | —              | `autoComplete="current-password"`, `textContentType="password"` |
| 13  | Submit         | `Button` `primary`, full width | `Log in`       | Busy label `Log in, in progress`                                |

There is **no** Currency field (it is fixed at signup) and **no** "Forgot password?" link
([`01-flows.md`](./01-flows.md) §6).

### States

| State             | What the user sees                                                                                                                                                                                                                                             |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `default`         | Both fields empty — or Email prefilled when arriving from the `Log in instead` link in §1.2 rule 4, in which case focus starts on Password. Submit enabled.                                                                                                    |
| `empty`           | Not applicable.                                                                                                                                                                                                                                                |
| `loading`         | Submit in **Busy** state only, exactly as §1.2. After a `200`, the Busy state persists through `router.replace('/(app)')`; Home then owns the `loading:hydrating` state while the first full pull runs ([`04-expense-list.md`](./04-expense-list.md) §States). |
| `error`           | `401 invalid_credentials` → **form-level** banner, not a field error: `danger.subtle`, `alert-circle` 16, `type.footnote` / `danger.default`, copy `That email or password is incorrect.` Neither field enters its error border state.                         |
| `offline-pending` | Offline genuinely blocks this screen too. Banner copy: `You need to be online to log in.` Fields keep their values; Submit returns to enabled.                                                                                                                 |

### Behaviour

1. Client validation is **presence only**: `Enter your email address.` and
   `Enter your password.` The login screen does not check email format or password length —
   rejecting a credential the server might accept, or hinting at the shape of a stored
   password, is both wrong and a small information leak.
2. **`invalid_credentials` is form-level, never field-level,** and the copy never says which
   half was wrong. This mirrors the contract's own note on the code ("deliberately does not say
   which half was wrong"); a field-level error on Email would confirm whether an account exists.
3. The password is **not cleared** on a failed attempt (§1.2 rule 10).
4. On `200`: persist the token pair, write the `user` row, then `router.replace('/(app)')`. The
   sync engine starts a full pull from `since=0`. **The default categories are not seeded on
   login** — this account already has them, and seeding would create duplicates.
5. `429 rate_limited` is handled as in §1.2 rule 6.
6. `500 internal_error` → form-level banner with the generic copy from
   [`09-copy-deck.md`](./09-copy-deck.md) §2. Submit stays enabled.
7. Back returns to Welcome.

### Accessibility

- Focus order: 1 → 2 → 4 → 7 → 8 → 13, banner after 2.
- The form-level banner is `accessibilityLiveRegion="polite"` on Android and announced via
  `announceForAccessibility` on both platforms, and focus moves to the Email field so a
  screen-reader user lands somewhere useful rather than at the top of the screen.
- `returnKeyType`: Email `next`, Password `go`.
