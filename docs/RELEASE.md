# Release readiness

What stands between this repository and a store build, as of the settle-up work. Written from the code and
`mobile/app.json`; nothing here has been submitted anywhere.

## Cannot be tested in Expo Go

Expo Go ships its own native modules, so these only show up in a development or release build
(`eas build`, or `expo run:ios|android`): the app's own icon and splash, the notification permission flow as
users will see it, background sync (`expo-background-task`), Face ID, and any change to `app.json` plugins. Run
`docs/qa/DEVICE_CHECKLIST.md` once more on such a build before submitting.

## Missing today

| Item | State | Needed |
| --- | --- | --- |
| App icon (1024x1024, no transparency) | none: there is no `mobile/assets/` | A designed icon, referenced as `expo.icon`; Android adaptive icon (foreground + background colour) under `expo.android.adaptiveIcon` |
| Splash image | colour only (`expo-splash-screen` plugin) | Optional: a logo `image` in the plugin config |
| Production API URL | `expo.extra.apiBaseUrl` is `null` | The deployed backend's HTTPS URL, set per build profile (`EXPO_PUBLIC_API_BASE_URL` is also read; see `src/api/config.ts`) |
| Build profiles | no `eas.json` | `development`, `preview`, `production` profiles; an Expo/EAS account and Apple/Google developer accounts |
| Version and build numbers | `version: 0.1.0`, no `ios.buildNumber` / `android.versionCode` | Bump on every submission (EAS can auto-increment) |
| Privacy policy URL | none | A public page; both stores require one |
| Support URL / contact | none | Required by both stores |
| Store listing | none | Name, subtitle, description, screenshots (6.9" and 6.5" iPhone, phone and 7" tablet for Android), category (Finance) |
| Backend hosting | local only | Postgres, the Node server behind HTTPS, `TRUST_PROXY` set correctly (see `backend/.env.example`), a scheduled `pnpm prune:tombstones` |
| Backend secrets | dev defaults | A real `JWT_SECRET`, `RESEND_API_KEY` + `MAIL_FROM` (password reset and email verification send nothing without them in production), and `OCR_SPACE_API_KEY` if receipt reading is to be on |

## Apple's sign-in rule

The app only offers email and password, so Sign in with Apple is **not** required today. It becomes required
the moment any other third-party login (Google, Facebook) is added.

## What to say in the privacy forms

Accurate to the code at the time of writing; re-check after any change.

**Data the app collects and sends to its server**
- Email address and password (the password is stored only as an argon2id hash).
- Optional display name, and the account currency.
- Expenses, income, categories, budgets, recurring rules, savings goals and, in a household, recorded payments
  between members: synced so they work across devices.
- Receipt photos, when a person attaches one: stored on the server with the expense.
- Household membership, and who added each shared expense.

**Third parties**
- **OCR provider** (OCR.space, or Google Cloud Vision if that is configured): only when a person taps *Read
  receipt*, the photo is sent to it for text recognition. It is not stored by this app's server afterwards.
  Disclose this in the privacy policy; the app already says so in the receipt sheet.
- **Email provider** (Resend): the address and a one-time code, for password reset and email verification.
- **Exchange-rate provider** (Frankfurter, ECB reference rates): a currency pair and date, when a person enters a
  foreign-currency expense. No personal data.

**Stays on the device**
- Notification scheduling (bill and goal reminders, budget alerts) is local.
- Face ID / biometric lock is local; nothing biometric leaves the device.
- Private expenses are hidden from other household members by the server; they are still stored on the server
  with their author, so "private" here means private from the household, not end-to-end encrypted.

**Not collected:** location, contacts, advertising identifiers, analytics or crash-reporting SDKs (none are in
the app today). If Sentry or similar is added, update the forms.

Apple's "App Privacy" categories this maps to: Contact Info (email, name), Financial Info (expenses),
User Content (receipt photos), Identifiers (user id), all linked to the user and used for app functionality,
none for tracking.

## Account deletion

Both stores require in-app account deletion when accounts can be created in-app. It exists (Settings ->
Delete account) and removes the account's data on the server; the privacy policy should say what is retained
(nothing, other than deleted-row tombstones that are pruned after 90 days).

## Before a public release

- Review the Vietnamese strings (`docs/i18n/vietnamese-review.csv`).
- Tune receipt reading on real receipts (`pnpm scan:receipts`, in `backend/`).
- Run the device checklist on iOS and Android release builds.
- Decide whether receipt reading ships turned on: it needs a provider key and sends photos to a third party.
