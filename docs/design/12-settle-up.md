# 12 - Settling up in a household

A household already shares one set of books. This adds the question those books can't answer yet:
**who owes whom.** Decided with the product owner:

- **Equal split of everything shared.** Every non-private expense is split equally among the members
  who were in the household on its date. There is no per-expense split picker, so adding an expense
  stays one step.
- **Private expenses are not split.** The lock already means "mine, not the household's"; it keeps
  that meaning here. They never reach anyone else's balance.
- **The payer is changeable.** An expense is paid by the person who added it unless someone says
  otherwise: a **Paid by** row in the form, household only.
- **Settling up records a payment.** "Bao paid Ana 42.00" is a synced entry in a history. A balance
  is expenses minus recorded payments, so it survives new expenses and works offline.

## The one idea

Balances are **computed on each phone** from rows it already holds (the shared expenses and the
recorded payments). There is no balance endpoint and nothing to keep in step: two phones with the
same synced rows show the same balances, because the arithmetic is integer and deterministic.

For each live, non-private `expense` (never `income`) dated `d`, with amount `A` minor units:

- **Participants** are the current members whose `joinedAt` date is on or before `d`, in `userId`
  order. Fewer than two participants means nothing is owed on it.
- **Shares.** `floor(A / n)` each; the remainder `A mod n` goes one minor unit at a time to the
  participants starting at position `k mod n`, where `k` is the last four hex digits of the expense
  id as a number. Shares always sum to `A` exactly, and the odd cent does not always land on the
  same person.
- **Payer** `p` is `paidBy`, or `createdBy` when `paidBy` is null. A payer who is not a current
  member (they left) is treated as no one: the expense is skipped, rather than charging the others
  for money a stranger spent.

Then, per current member `m`:

```
net(m) =  paid(m)            -- sum of A over expenses m paid
        - owed(m)            -- sum of m's shares
        + sent(m)            -- recorded payments m made
        - received(m)        -- recorded payments m got
```

`net > 0` means the household owes `m`; `net < 0` means `m` owes it; the nets of all current members
sum to zero, always. **Who pays whom** is the usual greedy match (largest debtor to largest
creditor, repeat), which gives at most `members - 1` transfers and, for two people, the one obvious
line. It is a *suggestion*: nobody is obliged to follow it.

## Recorded payments (`settlements`)

A new synced record, in the household's book like everything else:

| Field | Meaning |
| --- | --- |
| `id`, `revision`, `createdAt`, `updatedAt`, `deletedAt` | as every synced row (soft delete, last write wins) |
| `fromUserId` | who paid |
| `toUserId` | who was paid; never equal to `fromUserId` |
| `amountMinor` | positive, in the household currency |
| `date` | the day it happened (calendar date, like an expense) |
| `note` | optional, 200 characters |
| `createdBy` | who recorded it |

- **Either side may record it** (the person who paid, or the person who got paid, confirming), and
  either may edit or delete it. It is the only way to undo one: deleting it puts the balance back.
- **Both people must be current members** when it is written; otherwise `validation_error`. A
  member leaving later does not remove the history: the ids stay, and the name shows as *Former
  member*.
- Not available outside a household (nothing to split).
- Syncs like goals and expenses: pushed, pulled, tombstoned, in the same revision stream. It is
  **not** hidden from anyone: both people and every member see every payment.

## Expenses get a `paidBy`

`expenses.paid_by` (nullable uuid, no foreign key so history survives a member leaving), on the wire
as `paidBy`. Null means "whoever added it", which is every expense that exists today, so nothing is
backfilled. Any member who may edit the expense may change it, to a current member only. It means
nothing on a private expense, and the form hides the row there.

## Mobile

- **Household screen** gets a **Balances** section at the top once there are two or more members:
  one line each (*Bao owes you US$42.00*, *You owe Ana US$12.00*, or *All settled up*), then a
  **Settle up** button and a **History** row.
- **Settle up** opens a screen, built from the same parts as the expense form (direction toggle,
  amount and keypad, date and note): **I paid / They paid me**, the person, an amount, a date and a
  note, then **Record**. It starts from what you actually owe, or are owed: the first suggested
  transfer that involves you gives the person, the direction and the amount, and every part stays
  editable. The first key you press replaces the suggested amount instead of extending it; picking
  someone else restarts from what is owed with them, unless you have already typed an amount. With
  nothing owed it opens empty and **Record** waits for an amount, because someone owed money may
  still want to record "Bao paid me". Record writes a local change that syncs like any edit, with
  an **Undo** that deletes it.
- **History** lists payments newest first, worded for the person looking (*You paid Bao*, *Bao paid
  you*, *Cam paid Bao*). Only the two people a payment names can delete it (with an Undo), which is also
  all the server allows, so everyone else's rows are read-only. It reads this phone's own rows, so it
  works offline.
- **Where the data comes from.** Members come with the day each joined (`joinedAt`, already on
  `/v1/me`, now kept in the phone's stored member list), so a late joiner is not charged for what
  came before. The Balances section reads the members the Household screen is showing; History reads
  the stored list.
- **Expense form** gets a **Paid by** row (household only, hidden on a private expense), defaulting to
  *You*, opening a list of members.
- Home, Summary, Search and budgets are unchanged: they still show what the household spent, not who
  fronted it.

## Consequences, stated plainly

- **Someone leaving changes everyone's balance.** Balances are computed among *current* members, so
  when a member goes, their shares drop out and the others' recompute. The leave and remove dialogs
  say so when balances are not settled; settling up first is the way to leave on good terms. It is a
  warning, not a block.
- **Joining late is fair without ceremony.** An expense dated before someone joined does not involve
  them, so a new member does not inherit the household's past.
- **Editing an old expense changes today's balance.** That is the same row the totals use; there is no
  separate ledger to drift from it.
- **The household's currency is the only currency.** Expenses already store the account-currency
  amount, so nothing converts here.
- **Rounding is exact, not approximate.** Shares sum to the expense to the minor unit.
- **No verification.** The app records that someone says they paid; it does not move money.

## Build order

Each step ships on its own and is tested before the next:

1. **The engine**: a pure `balances` module (shares, nets, suggested transfers) with property tests
   (shares sum exactly, nets sum to zero, order of input does not change the answer). No UI, no data.
2. **`paidBy`**: contract, backend (validation, sync), mobile store, and the form row.
3. **`settlements`**: contract, backend (validation, sync, leave/delete handling), mobile store.
4. **The screens**: Balances, Settle up, History, and the leave/remove warning.

## Not in this version

Custom or unequal splits, splitting by category or percentage, recurring settle-up reminders,
notifications, more than one currency, exporting balances, and per-expense "not split" other than
making it private.
