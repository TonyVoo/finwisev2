# 21 - Import from CSV

The export (`Settings -> Export`) already writes a CSV; this reads one back, so a backup restores and another app's
spreadsheet can be brought in. Entirely on the phone.

## Flow

Settings -> _Import from CSV_ -> the system file picker -> a confirmation that says how many entries would be added and
what is left out and why -> _Import_. Nothing is added before that last tap. Entries are created exactly as typed ones
are (`createExpense`), so they sync and can be edited or deleted one by one.

## What a file may look like

Columns are found by their names, in any order, ignoring case: `Date` (or `Day`, `Ngày`), `Amount` (`Value`, `Số tiền`),
`Currency`, `Category` (`Danh mục`), `Note` (`Memo`, `Description`, `Details`, `Ghi chú`), `Type` (`income` for money in,
anything else is a spend), and our own `Original amount` / `Original currency`. Only Date and Amount are required.
Comma, semicolon and tab separated files are read; so are quoted fields with commas, quotes and line breaks.

- **Dates:** `2026-10-05`, or day-first `05/10/2026` (the usual in Vietnam); a first number above 12 is the day, and a
  second number above 12 means month-first.
- **Amounts:** `1.250.000`, `1,250,000`, `12.50`, `12,50`, `1,234.56`, `1.234,56`, with or without a currency symbol; a
  sign is ignored (the Type column, not the sign, says which way). In a currency with no minor unit, such as dong, every
  separator is a thousands separator.
- **Category:** matched to one of the person's by name, ignoring case; anything else goes under _Uncategorized_ and is
  counted in the confirmation. No categories are created.
- **The export's apostrophe** before a note that starts with `=`, `+`, `-` or `@` is removed again.

## Left out, and said so

An unreadable date or amount (or zero, or too large to store); a row in a **different currency** from the account (it
cannot be converted without a rate); and a row **already here** - the same day, amount, kind and note as an entry on the
phone - so importing the same file twice adds nothing the second time. At most 2,000 rows per file; a file without Date
and Amount columns is refused with a message.

Not done: converting rows in another currency at a typed rate; creating categories from the file; reading `.xlsx`.
