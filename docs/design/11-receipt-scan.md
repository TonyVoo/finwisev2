# 11 - Reading a receipt

A photo of a receipt can **suggest** an amount, a date, a merchant and a category. It never
fills anything in on its own: the person sees what was found and taps **Use** or **Dismiss**.
A wrong total that nobody noticed is worse than typing one, so accuracy is handled by a human
check, not by trusting the reader.

## Flow

1. In the expense form, open **Receipt** and attach a photo (camera or library), as today.
2. With a photo on the form, the sheet offers **Read receipt**. Nothing is sent until it is
   tapped: the image leaves the phone for the server, and from there for the OCR provider, so
   it is a deliberate act and the sheet says so.
3. A suggestion card appears at the top of the form: `US$12.50 - 14 Oct - Milk Mart`, with
   **Use** and **Dismiss**. Fields the reader could not find are simply absent from the card.
4. **Use** puts the found values into the form like typing would, but only where it is safe:
   the amount only when the form pays in a currency with the same number of decimals as the
   account's (the reading used the account's); the date only when it is not after the form's
   today; the note only when it is empty; the category only when it names one of the person's
   live categories (by its English or Vietnamese default name). Nothing is saved until they
   press Save, as always. The reading belongs to the photo it came from: choosing another photo
   or removing it discards the card.
5. Failure (offline, unreadable, provider down, feature off) is a snackbar and nothing else.
   Adding an expense by hand is never blocked or delayed by this feature.

## Server

`POST /v1/receipts/scan` takes the same JPEG body as the receipt upload but is **not** tied to
an expense, and **stores nothing**: the image is read and dropped. It answers

```json
{ "data": { "amountMinor": 1250, "currency": "USD", "date": "2026-10-14",
            "merchant": "Milk Mart", "category": "groceries" } }
```

with every field nullable. `currency` is always the account's currency: a receipt in another
currency is read as that amount in the account's units, and the person fixes the currency in
the form if it differs (the form's currency row is right there).

- **Reading is in two steps, so each can be tested alone.** A `TextReader` turns the JPEG into
  text (behind one small interface, like the mailer; one HTTPS request each, no SDK). A pure
  `parseReceiptText` turns the text into the fields. Two readers exist: **OCR.space** (a free
  plan with a free API key and no card: 25,000 requests a month, 500 a day per server address,
  files up to 1 MB) and **Google Cloud Vision** (pay as you go, billing account required, 1,000
  requests a month free). OCR.space is preferred when both keys are set. The 1 MB limit is why
  the app's usual 200-600 KB photo is fine, and an oversized one fails as `ocr_failed` rather
  than being sent.
- **Off by default.** With neither `OCR_SPACE_API_KEY` nor `GOOGLE_VISION_API_KEY` the endpoint
  answers `503` `ocr_unavailable`, and the app hides **Read receipt** after the first such
  answer. Nothing in the rest of the product depends on it.
- **A provider failure is `502` `ocr_failed`.** Not cached, not retried by the server.
- **Throttled per account** (`LIMITS.RECEIPT_SCAN_MAX_PER_USER` per window): each call spends
  the server's outbound budget.
- The photo is validated like an upload: JPEG signature, size limit. Not logged; the text read
  from it is not logged either.

## What the parser looks for

- **Amount.** Lines that say total / amount due / balance due (and the Vietnamese `tong`,
  `thanh toan`) win, last one first; lines that say subtotal, tax, change, cash or tendered are
  skipped. With no such line, the largest amount on the page. The decimal separator is the
  last `.` or `,` followed by exactly the currency's number of decimals, so `1.234,50` and
  `1,234.50` both read as 123450 minor units in a 2-decimal currency.
- **Date.** `2026-10-14`, `14/10/2026`, `10/14/2026`, `14 Oct 2026`, `Oct 14, 2026`. When day
  and month are both <= 12 the account currency decides (USD: month first; otherwise day
  first). A date in the future, or more than two years back, is dropped.
- **Merchant.** The first line near the top that is mostly letters and is not a boilerplate
  word (receipt, invoice, tel, www). At most 80 characters.
- **Category.** A keyword match over the whole text against five fixed keys: `groceries`,
  `eating_out`, `transport`, `health`, `bills`. The app maps a key to a category only if the
  person still has the default category of that name; otherwise it suggests no category.

## What this does not do

No line items, no tax split, no currency detection, no storing of the scan, no automatic
saving, and no on-device reading (that needs a native module, so it needs more than Expo Go).
