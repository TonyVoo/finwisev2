# 29 - Splitting one expense across categories

A supermarket trip of 500 000 that is 350 000 groceries and 150 000 household. Decided with the product owner: **separate
entries** (no server or database change) and the split starts **on Add expense**.

## How it works

On a new entry with an amount, a _Split_ row appears under Category. It opens a sheet:

- the total, and a live line **Left to assign** (red _Over by_ if the parts exceed it);
- a card per **part**: a category (chips) and an amount. Two parts to start; _Add a part_ for more, _Remove_ when there
  are more than two;
- **one part may be left empty and takes the rest** (so for two parts you type one amount and pick the second category);
- _Done_ is disabled, with its reason stated, until: at least two parts, every part has a category, each category is used
  once, every amount is valid (one may be empty), and the parts add up to the total exactly (`splitModel.resolveSplit`,
  integers).

Back on the form the row says _N categories_; tap it to edit or _Remove the split_. **Changing the total afterwards drops
the split**, because the parts would no longer add up.

## What is saved

Save writes **one ordinary entry per part** - same day, note, kind, privacy and payer - through the usual local write, so
every total, budget, search and sync behaves as it always did. The receipt photo (and a detected payment's link) go with
the first entry. The snackbar says _Saved as N entries._

## What it is not

The parts are not linked afterwards: editing or deleting one does not touch the others, and they list as separate rows.
A grouped single row that expands (a new field on the server and the phone) was the alternative and is not built.
Split is also not offered when editing an entry, when paying in another currency (the amount is converted first), or
with fewer than two categories.
