-- Who paid for an expense, for settling up in a household (see `docs/design/12-settle-up.md`).
-- Null means whoever added it, which is every row that exists today, so nothing is backfilled. No
-- foreign key on purpose: a member leaving must not cost the household its history.
ALTER TABLE "expenses" ADD COLUMN "paid_by" UUID;
