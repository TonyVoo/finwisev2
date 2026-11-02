# 19 - Changing the account currency

Until now the currency was fixed at signup, because every stored amount is in it. The person can now change it,
with everything they have recorded converted at a rate they enter. Decided with the product owner (the other
options were relabelling the amounts without converting, and allowing the change only while the account was empty).

## What changes

`POST /v1/me/currency` `{ currency, rate, password }`, one transaction on the server, over the account's **own**
books (expenses including deleted ones, goals, recurring rules, category budgets):

- `new = round(old x rate)` in whole minor units of the new currency, half up, allowing for the two currencies'
  decimals (USD has two, VND none). The rate is a decimal string, as everywhere.
- An expense paid in a foreign currency keeps that original amount. If the new currency is the one it was paid in,
  it gets that exact amount back and stops being foreign (the arithmetic does not override what was actually paid).
  An expense with no original records its old amount as the original, so the history of what was typed survives.
- Goal targets stay at least 1 and budgets at least 1 after rounding. A converted amount over the contract maximum
  refuses the whole change with `400`; nothing is half converted.
- Every changed row gets a new revision, so other devices receive them on their next sync.
- **Households are left alone.** A household book has a currency of its own and other members' amounts are theirs.
- Password required (`403` otherwise), rate limited with the other password-confirm actions.

## On the phone

Settings -> Currency (the row now has a chevron and the hint `Tap to change. Amounts are converted.`):

1. Pick the new currency (the same thirty as signup).
2. The rate is filled in from the market when the provider has the pair; otherwise (the dong, which the ECB does not
   price) the person types it. An example line shows ten units of the old currency in the new one.
3. Password, then a confirmation dialog saying it cannot be undone.

Online only, and refused while changes are waiting to sync (they are in the old currency) or while a household
space is open (the personal books are not on the phone then). On success the phone drops its copy of the books and
the sync cursor and syncs again, instead of merging old and new amounts.

Not done: the rate used is not remembered; changing back is another conversion at whatever rate is then entered, so
rounding can drift by a unit.
