# 20 - Payment detection (MoMo and ZaloPay)

Android only. When MoMo or ZaloPay shows a payment notification, the app offers an entry for it. Decided with the
product owner: MoMo and ZaloPay first; **suggest, the person confirms** (nothing is added by itself); the text is read
**on the phone only**, with rules rather than a model.

## Pieces

- **`modules/payment-notifications`** - a small local Expo module. Its Android service (`NotificationListenerService`)
  checks the package name _before touching the notification_: only `com.mservice.momotransfer` and
  `vn.com.vng.zalopay` are kept, as `{ package, key, time, title, text }` in a private bounded queue (200). The app
  drains the queue when it opens or returns to the front, so a payment made while it was closed is not lost. The
  package names are in Kotlin on purpose: the list cannot be widened from JavaScript.
- **`src/capture/parseNotification.ts`** - the rules. An amount in dong (`65.000đ`, `1,250,000 VND`, `VND 5.000`, `₫`),
  words for the direction (paid / transferred -> spend; received / refunded -> income; a leading `-` or `+` decides a
  mixed one) and a name after `tại / đến / tới / cho` (or `từ` for income). OTPs, promotions, vouchers, reminders and
  bills that are merely due are refused. Anything it cannot tell is `null`: a missed payment costs a few taps, a wrong
  entry costs trust.
- **`captured_payments`** (migration 17, local only, wiped on sign-out). Each notification is one row (its identity is
  the key), either a suggestion (`new`) or `ignored`. Ignored rows are kept three days and handled ones thirty, so the
  log can show what the phone is sent.
- **Settings -> Payment detection** (only where the service exists): the switch is Android's own Notification access
  screen, which only the person can turn on; then _Detected payments_ (Add / Dismiss) and _Recent notifications_.

## Add

Add opens the ordinary Add expense form with the amount, the day the notification arrived, the name as the note and the guessed category.
In an account whose currency is not dong it is entered as a foreign amount in VND. Saving marks the payment `added`.
A suggestion whose amount, day and kind already match an entry says _Looks like one you already added._ and is left
for the person to decide.

## The heads-up (optional)

Settings -> Payment detection -> _Notify me when a payment is spotted_ (off by default). The native service then posts a
notification, _Possible payment detected - Tap to review it in Expenses_, which opens the Payment detection screen
(`expensetracker://settings/payment-detection`). It uses a **rough check in Kotlin** - an amount in dong, words that say
money moved, none of the words of codes and promotions - not the app's parser, so it can be wrong in both directions;
the app does the real reading when it opens. The words are written by the app in its current language. If notifications
are not allowed for the app, nothing is shown.

## Known limits

- The apps' real notification wording is not published, so the rules are tolerant and were not written from real
  samples. The _Recent notifications_ log exists to correct them: a payment that was missed shows up there as
  `Not a payment` with its exact text.
- Without the heads-up a suggestion appears when the app is next opened. Android may stop a listener
  on aggressive battery savers; turning Notification access off and on again restarts it.
- The category is a guess from the person's own entries: the one the same name (case and spaces ignored) was filed
  under most often, ties to the most recent (`src/capture/categoryGuess.ts`). A name never seen opens with the
  last-used category. Correcting a category on an entry is what teaches it; there is nothing to maintain.

## The same guess in the ordinary form

Typing a note in Add expense now does what Add on a detected payment does: if the same note (case and spaces ignored) was
filed under a category before, the new entry goes there too, with a snackbar that says so (_Filed under Fuel, like your
earlier "shell" entries._). It applies to a **new** entry only, and **only until the person chooses a category
themselves** - a category picked by hand, or created in the form, is never moved by a note.
