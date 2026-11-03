# 27 - Monthly spending limit and "safe to spend today"

Budgets are per category. This is one limit for the whole month, and the number that matters day to day: **what is
safe to spend today**.

## Rule

`safe today = floor((limit - spent so far) / days left)`, days left counting today, rounded down so spending it every day
never goes over (`src/limit/safeToSpend.ts`, integers). On the last day it is the whole remainder
(_Last day of the month: X left_). Once spending passes the limit the line turns red and says by how much
(_Over the monthly limit by X_); spending exactly the limit leaves 0 to spend and is not over.

## Where

- **Settings -> Money -> Monthly spending limit** opens a sheet to type the amount (the same typed-amount rules as a
  category budget) or remove it.
- **Home**, under the month total, in the brand colour (red when over). **Current month only**: for a finished month
  "safe to spend today" means nothing.

## Storage

A device setting (`meta.monthlyLimit`, minor units of the account currency), not synced. It is cleared with the account's
other local data - and therefore by **a currency change**, since the number would silently mean something else in the new
currency. Not set again automatically.
