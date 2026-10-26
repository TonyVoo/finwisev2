-- Recurring expenses: a third synced entity.
--
-- A rule stores no "next date" (occurrences are computed from start_date + frequency on the
-- device), and category_id is not a foreign key - see the note on the Prisma model.
CREATE TABLE "recurring_rules" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "category_id" UUID NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "note" VARCHAR(500),
    "frequency" VARCHAR(8) NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    "revision" INTEGER NOT NULL,

    CONSTRAINT "recurring_rules_pkey" PRIMARY KEY ("id")
);

-- The sync pull walks revision within a user.
CREATE UNIQUE INDEX "recurring_rules_user_id_revision_key" ON "recurring_rules"("user_id", "revision");

ALTER TABLE "recurring_rules"
  ADD CONSTRAINT "recurring_rules_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "recurring_rules" ADD CONSTRAINT "recurring_rules_revision_positive_check" CHECK ("revision" > 0);
ALTER TABLE "recurring_rules" ADD CONSTRAINT "recurring_rules_amount_minor_range_check"
  CHECK ("amount_minor" >= 0 AND "amount_minor" <= 999999999999);
ALTER TABLE "recurring_rules" ADD CONSTRAINT "recurring_rules_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$');
ALTER TABLE "recurring_rules" ADD CONSTRAINT "recurring_rules_frequency_check" CHECK ("frequency" IN ('weekly', 'monthly'));
-- Written down at rest as well as validated on write, because the merge on a partial push
-- can produce a combination neither half would have been refused for.
ALTER TABLE "recurring_rules" ADD CONSTRAINT "recurring_rules_dates_check"
  CHECK ("end_date" IS NULL OR "end_date" >= "start_date");

-- The idempotency ledger now records mutations of this entity too.
ALTER TABLE "sync_mutations" DROP CONSTRAINT "sync_mutations_entity_check";
ALTER TABLE "sync_mutations"
  ADD CONSTRAINT "sync_mutations_entity_check"
  CHECK ("entity" IN ('category', 'recurring', 'expense'));
