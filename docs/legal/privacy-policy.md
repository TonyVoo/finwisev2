# Privacy Policy - Expense Tracker

> **DRAFT for review.** Written from what the code does (`docs/RELEASE.md`), not legal advice. Fill every
> `[BRACKET]`, have it reviewed for the countries you publish in, and host it at a public HTTPS address before
> submitting. Delete this box when done.

_Last updated: [DATE]_

Expense Tracker ("the app") is operated by **[LEGAL NAME / INDIVIDUAL]** ("we"). You can reach us at
**[CONTACT EMAIL]**.

## What we collect

- **Account:** your email address, and your password, which we store only as a one-way hash (argon2id), never in
  readable form. Optionally a display name, and the currency of your account.
- **Your records:** the expenses, income, categories, budgets, recurring rules and savings goals you enter. They
  are kept on your phone and copied to our server so they work across your devices and survive a lost phone.
- **Receipt photos:** only the photos you choose to attach to an expense. They are stored on our server with
  that expense.
- **Households:** if you share a household, its members, who added each shared expense, and payments members
  record between themselves.

We do not collect your location, contacts or advertising identifiers, and the app contains no analytics or
advertising software.

## How receipt reading works

Reading a receipt is optional and happens only when you tap **Read receipt**. Your photo is then sent through our
server to an outside service that finds the amount, date and shop name. Our server does not keep the photo or
the result of this step. Depending on how the service is set up, the outside service is one or more of:

- **Google (Gemini API).** On Google's free plan, Google may use what it receives to improve its products; on
  its paid plan it does not use it for training. We state which plan is in use here: **[FREE / PAID]**.
- **OCR.space** or **Google Cloud Vision**, which read the text on the photo.

We send the photo and nothing that names you: no email, account or other records. The suggestions are only
suggestions; nothing is saved until you press Save.

## How describing an expense works

In Add expense you can type a sentence such as "coffee 45k yesterday" and tap **Fill**. The app first reads it on
your phone, and a sentence it understands is never sent anywhere. When it cannot tell (for example, two amounts),
the sentence, today's date and your account currency may be sent through our server to **Google (Gemini API)** to
help read it, with nothing that names you and no list of your categories. On Google's free plan, Google may use
what it receives to improve its products (**[FREE / PAID]** is in use here). Our server does not keep the
sentence or the result. The suggestion is only a suggestion; nothing is saved until you press Save.

## Other services we use

- **Resend** sends the one-time codes for email verification and password reset (your email address and the code).
- **Frankfurter** (European Central Bank reference rates) is asked for an exchange rate when you enter an
  expense in another currency (a currency pair and a date, nothing about you).

## What stays on your device

Reminders and budget alerts are scheduled on your phone. If you turn on the app lock, Face ID or Touch ID is
handled by your phone's operating system; we never receive biometric data.

## Who can see your data

Only you, unless you join a household. In a household, other members can see its shared expenses and who added
them. An expense you mark **private** is hidden from the other members; it is still stored on our server with
your account, so private means private from the household, not end-to-end encrypted.

## Keeping and deleting your data

Your records stay while your account exists. You can export them and delete your account in the app (Settings →
Delete account), which permanently deletes your account and your records on our server. Markers of deleted
entries used for syncing are removed within 90 days. Expenses you added to a household's shared books belong to
that household and stay with it if you leave. A household owner must transfer or delete the household before
deleting their account.

## Security

The app talks to our server over HTTPS. Passwords are hashed, and sign-in sessions use short-lived tokens.
No system is perfectly secure; if we learn of a breach affecting you we will tell you as the law requires.

## Your rights

Depending on where you live you may have the right to access, correct, export or delete your data, to object to
or restrict some processing, and to complain to your data-protection authority. Most of this you can do in the
app; for anything else write to **[CONTACT EMAIL]**.

## Children

The app is not directed at children under **[13 / 16]**, and we do not knowingly collect their data.

## Changes

If we change this policy in a way that matters we will say so in the app and update the date above.

## Contact

**[LEGAL NAME]**, **[ADDRESS, if required]**, **[CONTACT EMAIL]**
