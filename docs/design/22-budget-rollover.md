# 22 - Budget rollover

Budgets already warn at 80% and 100% (`07-categories.md`, `summary/budgetAlerts.ts`, a local notification). Rollover adds
the other half: what a category did not spend of its budget last month is added to this month's.

## Rule

A **device setting** (Settings -> _Roll over unspent budget_, off by default; kept when signing out, like the theme). On
for every category that has a budget. Oldest month first, looking back at most six:

```
available = budget + carry      carry = max(0, available - spent)
```

- An overspend carries **nothing** and never makes the next month smaller.
- The chain starts at the first month the category was spent in. Without that a budget set last week would be handed six
  months of "unspent" money.
- The category's _current_ budget is used for every month in the chain; only the current one is stored.
- All integers; the carry is computed on the phone from the same monthly reads the Summary uses, so Home's alert, the
  Summary legend and the insights all see the same, larger budget.

The legend line says so: `$290.00 left of $350.00 ($150.00 carried over)`.

## Not done

It is per device, not per account (a second phone has its own switch), and not per category. Making it per category
would mean a field on the category row, a server migration and a sync change; say if you want that.
