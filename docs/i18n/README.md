# Vietnamese review

`vietnamese-review.csv` lists every string the app shows, in English and in Vietnamese, with where it appears
(from the copy deck) and a blank last column for corrections. Open it in a spreadsheet (UTF-8), fill the last
column where the Vietnamese should change, and send it back; the corrections are applied to
`mobile/src/copy/vi.ts`.

Regenerate it after copy changes (from `mobile/`):

    npx tsx scripts/export-copy-review.ts

Worth special attention: the longer sentences (privacy, deleting an account, sync, settling up), the words for
*household*, *settle up* and *private*, and money wording (`khoản chi`, `thu nhập`, `còn lại`).
