-- Foreign-currency expenses: what was actually paid, beside the account-currency amount.
--
-- amount_minor keeps meaning "in the account currency", so every total, budget and chart is
-- untouched; these two columns only record the original. Existing rows are NULL, NULL.
ALTER TABLE "expenses" ADD COLUMN "original_amount_minor" BIGINT;
ALTER TABLE "expenses" ADD COLUMN "original_currency" CHAR(3);

-- Both or neither: an amount with no currency is meaningless, and a currency with no amount
-- says nothing. Written down at rest as well as validated on write, because the merge on a
-- partial sync push can produce a combination neither half would have been refused for.
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_original_pair_check"
  CHECK (("original_amount_minor" IS NULL) = ("original_currency" IS NULL));
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_original_amount_range_check"
  CHECK ("original_amount_minor" IS NULL
         OR ("original_amount_minor" >= 0 AND "original_amount_minor" <= 999999999999));
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_original_currency_check"
  CHECK ("original_currency" IS NULL OR "original_currency" ~ '^[A-Z]{3}$');
-- A "foreign" amount in the account's own currency is no conversion at all.
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_original_differs_check"
  CHECK ("original_currency" IS NULL OR "original_currency" <> "currency");
