# 26 - Visual and flow polish

A pass over the main screens after seeing them on a device (Android emulator, light and dark). The tokens, type scale and
colours are unchanged; what changed is how the screens use them.

## Grouped cards instead of edge-to-edge bands

`components/Card.tsx`: `Card` (rows in one rounded card, hairline border, the last separator clipped), `SectionTitle`, and
`CardRow` (for FlatList/SectionList items, where one wrapper cannot hold the rows: first row takes the top corners, last
the bottom). Used by Settings, the day groups on Home, the category / goal / recurring lists, the household list, the
Summary legend, the Insights card and the Year in review row.

## Per screen

- **Settings:** one long flat list of 20+ rows became five titled groups - Account, Money, More, App and data, Security.
- **Home:** the month total is a card with a soft shadow (the figure is what the screen is for), the sparkline inside it;
  the one-time _categories are ready_ prompt moved **below** the total (it was pushing the figure off the first screen)
  and is tinted rather than outlined; each day's expenses are one rounded card under a clearer day heading.
- **Add expense:** the date/currency/category/note rows are one card; the _Describe it_ line no longer carries a
  three-line privacy paragraph above every form - it appears when the field is focused or has text.
- **Summary:** total, legend, insights and Year in review are all cards with the same margins.

## Not changed (not yet reviewed on a device)

The sign-in and sign-up screens, search, goals/categories/recurring sheets, the household detail screens, Payment detection,
Currency and Year in review.

## Second pass: sign-in, sign-up, sheets

- **Welcome:** the empty space between the name and the two buttons now says what the app does, in three lines with
  icons (offline, receipt scan, shared books).
- **Sign-up / sign-in:** a one-line subtitle under each title; a link to the other screen at the bottom (_Already have
  an account? Log in_ / _New here? Create an account_), which **replaces** the screen so Back does not bounce between
  them; and sign-up **preselects the currency of the region the phone is set to** (`vi-VN` -> dong, `de-DE` -> euro; any
  region not on the list falls back to USD) - a person in Vietnam no longer has to find the dong in a list of thirty.
- **Sheets and dialogs** (category, date, note, confirmations) were looked at on a device and left as they are: rounded
  sheet with a handle, clear title and close, one action. The _Roll over_ hint in Settings was cut off at two lines and
  now has three.
