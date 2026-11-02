# 18 - Spending forecast and unusual-spend lines

Two more lines for the Summary **Insights card** (`16-monthly-insights.md`), worked out on the phone from numbers it
already has: no network, no AI, nothing new stored. Decided with the product owner:

- **Where:** only the Insights card, beside the existing lines. Nothing is added to Home.
- **No notifications:** an unusual month is a line to read, not something that interrupts.

## The forecast

> _At this pace you will spend about $1,240 this month, $140 more than September._

For the **current month** only. The projection is the month's spend so far scaled to the whole month:
`projected = round(spent x days in month / day of month)`, in integer minor units, rounded half up.

- **Not too early, not too late.** From the **5th** of the month (a day or two of spending says nothing), and not
  on the last day (the projection would just be the total). A past month has no forecast.
- **Versus last month**, when there was spending then: _more than_ / _less than_ with the amount, or _about the same
  as_ when the two are within 3%. With no previous month the line stands alone.
- **It is a pace, not a prediction.** It assumes the rest of the month looks like the days so far; rent paid on the
  1st makes it read high, and the wording ("at this pace") says so. It never says "you will overspend".

## The unusual-spend line

> _Groceries is already $480, more than a typical month (about $300)._

A category that has **already** cost more than 1.5 times a whole typical month, with the month not over.

- **Typical** is the average full-month total of the category over the previous months (up to the three before this
  one) that had any spending at all; a month where the category was absent counts as zero. It needs **at least two**
  such months: one is not a pattern.
- **Compared with a whole typical month, not with "so far".** Scaling a typical month to today would flag every lump
  payment (rent on the 1st is 30x "its share" on day 1). Asking whether the category has _already_ passed a whole
  normal month is robust to that: a steady rent equals 1.0x all month and says nothing.
- **Big enough to matter:** the category's excess over typical must be at least 10% of the month's spend so far, so a
  small category doubling does not take the line.
- **A category with no history is skipped** (new, not unusual). **One line**: the category with the largest excess.
- Current month only.

## Both feed the recap

They are ordinary Insights sentences, so **Write my recap** (`16-monthly-insights.md`) can reword them like the others;
its numbers check already accepts any figure in the sentences it is sent.

## Build

Pure functions in `mobile/src/summary/insightsModel.ts` (two new insight kinds, a `monthProgress` helper and an
optional context argument carrying the day of the month and the earlier months' rows), wording in English and
Vietnamese and the copy deck, and two more month reads on the Summary screen. Tests first, against a table of cases.

## Not in this version

A forecast per category, income forecasts, seasonality, a notification, learning from corrections, and anything over
more than three months of history.
