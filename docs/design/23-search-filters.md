# 23 - Search filters and saved searches

Search (`app/(app)/search.tsx`) matched text, one category and, in a household, private entries. It now also filters by
**type** (spending / income), an **amount range** and a **date preset**, and a combination can be **saved**.

## Filters

A _Filters_ chip (with a count of the filters in use) opens a sheet:

- **Type:** All / Spending / Income.
- **Amount:** _At least_ / _At most_, in the account currency, inclusive. Read like imported amounts (`12.50`, `12,50`).
- **Dates:** Any time / This month / Last month / Last 3 months / This year. Presets, not a calendar - that is how people
  look for things, and it lets a saved "This month" mean the month it is opened in.

All filters are ANDed with the text and category, run against local SQLite (`searchWhere` in `db/queries.ts`), and the
count and total under the search bar cover every match. Deleted entries never match. A filter alone is a search.

## Saved searches

_Save this search_ names the current text, category and filters; applying one puts them all back. Stored on the phone
(`meta.savedSearches`, newest first, at most twenty, a repeated name replaces the old one) and cleared when another
account signs in. Not synced.

## Not done

Filtering by who paid (households) and by an exact date range.
