# 15 - Quick add: describe an expense in a sentence

Type "coffee 45k yesterday" and get a suggestion for the Add expense form: amount, date, note, category and
whether it is income. Like reading a receipt (`11-receipt-scan.md`), it only **suggests**: the person sees what
was understood and taps **Use** or **Dismiss**, and nothing is saved until they press Save. Decided with the
product owner:

- **A "Describe it" line at the top of Add expense.** Type, tap **Fill**, and the same suggestion card the receipt
  reading uses appears. Entering an expense the normal way is unchanged and never waits on this.
- **On-device rules first, Gemini only when unsure.** Common phrasing is read instantly, offline and for free;
  the network is used only when the rules miss something.
- **Category matching stays on the phone.** The model is never sent the person's category names.

## The one idea

Two readers behind one result, tried in order, and the person always sees one card:

```
sentence -> rules (on the phone, pure) --confident--> suggestion
                                       \--unsure, online--> Gemini (server) -> merged with what the rules found
```

The rules are the feature; Gemini is the safety net for free-form sentences. With no connection, no server key, or
a spent quota, quick add still works for everything the rules understand, which is most sentences people type.

## What the rules read

Pure functions in `mobile/src/quickAdd/`, English and Vietnamese, tested against a table of sentences:

- **Amount.** `45k`, `45 K`, `1.5tr`, `1,5 triệu`, `500 nghìn` / `ngàn`, `45.000`, `45000`, `12.50`, `$12`.
  Suffix multipliers (`k` = 1,000; `tr` / `triệu` = 1,000,000; `nghìn` / `ngàn` = 1,000) apply in any currency, and
  the result is converted with the account currency's decimals, exactly as the receipt parser does. A small whole
  number next to a clear amount is a **quantity** ("2 coffees 90k" is 90,000). **Anything the rules cannot tell
  apart is "unsure", never a pick**: two clear amounts ("coffee 4.50 tip 1.00"), two bare numbers ("coffee 3 and
  bagel 4": two prices, or a quantity and a price?), or a bare `45` in a currency without decimals (45 dong, or
  45k?).
- **Date.** `today`, `yesterday`, `hôm nay`, `hôm qua`, `hôm kia`, a weekday ("monday", "thứ hai": the most recent
  one on or before today), `14/10`, `14 Oct`. Day-before-month unless the account currency is USD, as for receipts.
  Never after today, never more than two years back; otherwise no date (the form keeps its own).
- **Income.** `salary`, `got paid`, `received`, `lương`, `thu nhập`, or a leading `+`. Otherwise it is an expense.
- **Category.** First the person's **own category names**, matched as whole words in the sentence ("pets 200k"
  picks their Pets category); then the keyword hints for the five default categories. Both run on the phone. The
  hint table moves into `shared/src/categoryHints.ts` so the receipt parser and quick add use one list.
- **Note.** What is left of the sentence once the amount, date and income words are taken out, tidied (first letter
  capitalised, at most 500 characters). Empty means no note.

A reading is **confident** when it found an amount and nothing about it is ambiguous. Everything else (no amount,
two candidates, a date phrase it half-understood) is unsure and, if online, goes to the model.

## Gemini, when unsure

`POST /v1/quick-add`, behind auth, stores nothing:

```json
{ "text": "paid rent to Mr Lam last friday 3tr5", "today": "2026-11-02" }
```

```json
{
  "data": {
    "type": "expense",
    "amountMinor": 3500000,
    "currency": "VND",
    "date": "2026-10-30",
    "note": "Rent to Mr Lam",
    "category": "bills"
  }
}
```

Every field is nullable except `currency` (the account's, as for receipts). `today` is the phone's local date, which
is what "yesterday" is relative to; the server rejects a `today` more than a day from its own clock.

- **Same safety as receipts.** The model's JSON is validated, never trusted: amounts converted with the account's
  decimals and bounded, dates real and in the plausible window, the note cleaned and cut to 500, the category one of
  the five keys, anything else null. An off-shape answer is a failed attempt, not a partial one. The sentence is the
  person's own typing, but it is still treated as data: it can only produce a suggestion that a human reviews.
- **What is sent.** The sentence, today's date and the account currency. No email, account id or category names.
- **Merging.** The phone keeps everything the rules were sure of and fills only the fields they left empty, so the
  model can add a date or a note but cannot overrule a clear `45k`.
- **Failure is quiet.** If the model is off, down, out of budget or over the limit, the person simply gets what the
  rules found, or "Couldn't read that. Enter the details yourself." if that is nothing.
- **Limits.** Per account (`LIMITS.QUICK_ADD_MAX_PER_USER`, 30 per window, in the style of the receipt limit), and
  its own daily budget (`GEMINI_QUICK_ADD_DAILY_BUDGET`, default 200) so it cannot use up the receipt reading's
  share of the free quota. The same `GEMINI_API_KEY`, model setting and quota-handling as receipts. New errors
  `quick_add_unavailable` (503, no key) and `quick_add_failed` (502), mirroring `ocr_unavailable` / `ocr_failed`;
  the app hides the model step for the session after the first `unavailable`.

## On the phone

- **Add expense** gets a one-line field at the top, `Describe it, e.g. coffee 45k yesterday`, and a **Fill** button.
  Under it, a hint says plainly that a sentence the phone cannot read may be sent through our server to an outside
  service (Google Gemini) and that on a free plan that service may use it. The field is hidden when editing an
  existing expense.
- **Fill** runs the rules at once. If they are confident the card appears with no network call. If not, and the
  device is online and the server has not said it is unavailable, the button shows progress while the model is
  asked, then the card appears.
- **The card** is the receipt card: one line (`US$4.50 · Yesterday · Coffee`), **Use** and **Dismiss**. **Use**
  applies only what is safe, by the receipt rules (never overwrite a note someone wrote, amount only when the form's
  currency has the account's decimals, date not after today, category only if the person has it), plus the type
  (expense or income) when the form is still untouched. Editing the sentence or leaving the form discards the card.
- **Nothing saves by itself.** Fill and Use only fill the form; Save is the person's.

## Privacy and release

- The sentence leaves the phone **only** when the rules were unsure and the person tapped Fill, and only to the
  Gemini reader the server is configured with. With no key configured, nothing ever leaves.
- Free-tier requests may be used by Google to improve its products; `docs/RELEASE.md` and the privacy policy gain
  one line for typed descriptions beside the receipt photos.
- Not logged: the sentence and the model's answer. Logged, as for receipts: which strategy answered, and the fixed
  failure message of an adapter.

## Checking it is good

The rules are tested against a table of about 60 sentences in English and Vietnamese (amounts with each suffix,
quantities, dates, weekdays, income, own-category matches, ambiguous cases that must come back unsure), written
before the parser. The model path is tested with a fake reader, as for receipts, and checked live once on a handful
of free-form sentences; a small `quick-add` mode in the comparison tool can score the two against expected values.

## Consequences, stated plainly

- **The rules will be wrong sometimes.** "Pay 2 months rent 7tr" has two readings; the design answer is to return
  _unsure_ rather than guess, and to show the card for review either way.
- **Vietnamese is likely good, not perfect.** Colloquial amounts (`3tr5` for 3.5 million, `1 củ`) are included
  where unambiguous and left to the model otherwise; the sentence table grows with real examples.
- **Free-tier quota is shared across features** by the same key; the separate budget keeps quick add from starving
  receipt reading, and with the model off, nothing else changes.

## Build order

Each step ships on its own, with tests first:

1. **The rules.** `shared/src/categoryHints.ts` (moved from the receipt parser), and the pure quick-add parser and
   suggestion planner on the phone, against the sentence table. No UI, no network.
2. **The form.** The Describe line, Fill, the shared suggestion card, English and Vietnamese copy and the copy
   deck: quick add with rules only.
3. **The server.** Contract (shared schema, OpenAPI, errors), the endpoint, the Gemini text reader and normalizer
   reusing the receipt pieces, rate limit and budget, with fakes.
4. **Both together.** The phone calls the endpoint when unsure, merges, and handles unavailable / failed / offline;
   the disclosure hint, `RELEASE.md`, the device checklist.
5. **Live check** on real sentences with a Gemini key.

## Not in this version

Several expenses in one sentence, splitting among people, recurring phrases ("every month"), a different currency
in the sentence than the account's, voice input, a switch to turn the online step off, learning from corrections,
and quick add from Home without opening the form.
