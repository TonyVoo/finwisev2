# 24 - Year in review

Summary answers "where did this month go?"; this answers the same for a whole year. A row at the bottom of the Summary
tab (_Year in review_) opens it. Everything is read from local SQLite - the same aggregates as the Summary, over a year
(`monthlyTotals`, `monthlyIncomeTotals`, `monthCategorySpend` with a year range) - so it works offline.

## What it shows

- **Four figures:** spent, income, left over (income minus spending), and the average per month. The average divides by
  the months that have happened in the current year, and by twelve in a past one.
- **Against last year:** the change in the total, and the category that rose the most and the one that fell the most
  (only when the year before had spending, and only for a category that actually changed).
- **The dearest and the cheapest month** among those with spending.
- **Month by month:** twelve bars, with zero where nothing was spent.
- **Where it went:** every category with its amount and share of the year, largest first.
- **A year switcher**, from any past year up to the current one; a year with nothing in it says so.

## PDF

_Share as PDF_ builds a plain-HTML page (inline CSS, no scripts or remote resources; every name escaped), prints it to a
PDF on the phone (`expo-print`) and opens the system share sheet. Nothing is uploaded.

## Not done

Charts beyond the bars, per-category monthly detail, and budgets versus actuals for the year.
