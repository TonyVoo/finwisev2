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
