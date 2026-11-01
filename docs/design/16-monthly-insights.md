# 16 - Monthly insights: budget pace, and an AI-written recap

The Summary screen already has an **Insights card**, built in code (`mobile/src/summary/insightsModel.ts`): spending
versus last month, the biggest category, the biggest rise, income change, money kept or overspent, each worded by a
template in English and Vietnamese. This adds one new fact, and an optional recap written by a model. Decided with
the product owner:

- **Budget pace** is a new insight, computed in code like the others.
- **An AI-written recap**, on request, in the Insights card: a few sentences in the person's language.
- **Both live in the Summary Insights card.** Nothing is added to Home or sent as a notification.

The product owner chose the recap knowing what it costs: unlike a receipt photo or a sentence you typed, it sends
**spending figures** to an outside service. The design keeps that to the minimum that can work, and says it plainly.

## The one idea

The model never sees expenses and never does arithmetic. The phone already turns the month's numbers into the
sentences of the Insights card; the recap is those same sentences, sent for **rewording**:

```
numbers -> insightsModel (code) -> sentences ("Groceries is your biggest category, at 24% of the month.")
                                        |-- shown on the card, as now
                                        '-- on request, sent to the model: "say this as a short recap"
```

So every figure in a recap is one the phone computed and the person can see above it, and the server can check that
the model added no number of its own.

## Budget pace (code only)

For the **current month**, for each category with a monthly budget `B` and spend so far `S` (integer minor units,
as in `budgetAlerts.ts`):

- `used% = round(S / B)`, by the same integer rule as every other percent here.
- The card shows **at most one** budget line, for the category with the highest `used%`, when that is at least 80:
  - 80 to 99: _You have used 87% of Eating out's budget with 9 days left._ (`1 day left`, and _today is the last
    day_, have their own wording; a month is never described by a past or future one.)
  - 100 or more: _You are over Eating out's budget by US$12.00._
- Past months and categories without a budget say nothing: "days left" means nothing for October once it is
  November. Categories with a budget of zero are ignored.

It is a plain fact, not a forecast: there is no projection, and no advice.

## The recap

A **Write my recap** button sits under the card's list (only when the list is not empty), with a hint under it,
the way **Read receipt** has one: _Sends the sentences above, including your category names and amounts, to an
outside service (Google Gemini) to word a short recap. On a free plan it may use them to improve its products._
Tapping the button is the act. Offline, the button is disabled with its reason (_Connect to the internet to write a
recap._), as the app's buttons must state one.

### What is sent

`POST /v1/recap`, behind auth, stores nothing:

```json
{
  "month": "2026-10",
  "language": "en",
  "facts": [
    "You have spent 12% more than in September.",
    "Groceries is your biggest category, at 24% of the month.",
    "You have used 87% of Eating out's budget with 9 days left."
  ]
}
```

- **Only the facts** (at most 12 sentences of 200 characters), the month and the language. No expense, note,
  merchant, date, receipt, email or account id. Category names and amounts appear **because they are in the
  sentences**, which is why the hint above says so.
- `language` is `en` or `vi`, the app's language, so the recap is written in it.

```json
{
  "data": {
    "text": "October was a little heavier than September, with groceries leading at 24%. Eating out is close to its budget with 9 days left."
  }
}
```

### The model's job, and the numbers check

The instruction: write two or three short sentences in the given language, **using only the facts**, copying every
number exactly as written; add no number, no count, no advice, no judgement of the person, no markdown or emoji.

Then the server **checks the answer, never trusting it**: it pulls every number out of the text and requires each
one (ignoring separators, so `1,284.50` and `128450` agree) to appear in the facts, and requires the text to be
non-empty and at most 500 characters. An answer with a number the facts did not contain, or the wrong shape, is a
failure, not a recap. So the worst a model can do is write a dull or slightly off sentence about real figures, never
invent a figure; and the card says the recap is **written by AI**, above the list of facts it came from.

### Limits and quota

Its own per-account limit (`LIMITS.RECAP_MAX_PER_USER`, 10 per window), its own daily budget
(`GEMINI_RECAP_DAILY_BUDGET`, default 100), the same key, model and quota handling as the other two Gemini
features, and errors `recap_unavailable` (503) and `recap_failed` (502). The app hides the button for the session
after the first `unavailable`. Not logged: the facts and the text. Logged: which strategy answered, and an adapter's
fixed failure message.

## On the phone

- The recap is **kept for the session only**, in memory, keyed by the month and the facts it was written from, so
  reopening the card does not spend another call, and a change in the figures asks again. It is not stored, synced or
  shared: a recap is a convenience, not a record, and storing one would be storing a stranger's reading of your money.
- After the text, a **Write again** action (same rate limit) and the line _Written by AI from the figures above._
- A failure is a snackbar (_Couldn't write a recap right now._), and the card is exactly as before. The card never
  depends on the recap.
- Works for any month with spending, not only the current one.

## Privacy and release

- The figures leave the phone **only** when the button is tapped, and only to the Gemini reader the server is
  configured with. With no key, the button disappears after the first refusal and nothing was ever sent.
- Free-tier requests may be used by Google to improve its products. `docs/RELEASE.md` and the privacy policy gain a
  line for recap facts beside the receipt photos and typed sentences.

## Consequences, stated plainly

- **It is for flavour, not for information.** Everything a recap says is already on the card. The value is a
  readable summary, and it costs the person's spending figures going to a third party each time they ask.
- **A recap can still be slightly off** (a loose "close to" for 87%) while every number is right; the check cannot
  judge tone, only figures.
- **The free tier is shared** across receipts, sentences and recaps, each with its own budget, so none starves the
  others, and a busy day means the button disappears rather than an error.

## Build order

Each step ships on its own, with tests first:

1. **Budget pace.** The insight in `insightsModel.ts`, its templates and wording in English and Vietnamese, the
   copy deck, and the card. Code only: no network, no AI.
2. **The recap endpoint.** Shared schemas, error codes and OpenAPI, the Gemini reader (the shared request code), the
   numbers check, rate limit and budget, with fakes.
3. **The recap on the phone.** The button, hint, in-memory cache, offline and failure handling, copy.
4. **Disclosure and live check.** `RELEASE.md`, the privacy policy draft, the device checklist, and a check with a
   real key on real months.

## Not in this version

Saving or sharing a recap, a recap notification, comparing more than two months, advice or forecasts, spending
patterns by weekday, anything about a household's other members, and a switch to turn the recap off beyond simply
not tapping the button.
