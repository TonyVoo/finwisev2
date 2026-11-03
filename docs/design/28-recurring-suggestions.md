# 28 - Recurring payments, noticed from your history

Recurring rules exist (`recurring/`), but setting one up means remembering to. This notices payments that already repeat
and offers to make them rules.

## What counts

From the last eight months of the phone's own entries (`src/recurring/detectRecurring.ts`, integers, no network):

- the **same note** - or, with no note, the same category - and the **same amount** and currency (a varying bill such as
  electricity is not a fixed rule);
- in **three or more months in a row**, on about the **same day** (within three days of the middle one);
- **never twice in one month** (two in a month is a habit, not a subscription);
- **still going**: the last payment is this month or last.

Left out: anything a rule already covers (same category and amount), and anything the person dismissed
(`meta.recurringDismissed`, cleared with the account's data).

## Where

Settings -> Recurring -> a _Looks recurring_ section above the rules, one card per suggestion: the name, the amount, "around
day N each month", "paid 3 months in a row", **Add rule** and **Not now**.

_Add rule_ creates a monthly rule through the ordinary local write. It **starts at the next payment** (the first expected
date after today), so nothing is back-filled - the earlier payments are already in the history - and the rule then
generates entries as any other does. _Not now_ remembers the dismissal.

## Not done

Weekly and yearly patterns, amounts that drift a little, and suggesting from the Home screen.
