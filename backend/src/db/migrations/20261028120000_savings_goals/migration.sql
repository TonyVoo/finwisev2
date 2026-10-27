-- Savings goals: a fourth synced entity.
--
-- Progress is manual (saved_minor is written by the device on a deposit), so there is nothing
-- derived here and no reference to another table beyond the owning user.
CREATE TABLE "goals" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "name" VARCHAR(60) NOT NULL,
    "target_minor" BIGINT NOT NULL,
    "saved_minor" BIGINT NOT NULL DEFAULT 0,
    "currency" CHAR(3) NOT NULL,
    "deadline" DATE,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    "revision" INTEGER NOT NULL,

    CONSTRAINT "goals_pkey" PRIMARY KEY ("id")
);

-- The sync pull walks revision within a user.
CREATE UNIQUE INDEX "goals_user_id_revision_key" ON "goals"("user_id", "revision");

ALTER TABLE "goals"
  ADD CONSTRAINT "goals_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "goals" ADD CONSTRAINT "goals_revision_positive_check" CHECK ("revision" > 0);
ALTER TABLE "goals" ADD CONSTRAINT "goals_target_range_check"
  CHECK ("target_minor" >= 1 AND "target_minor" <= 999999999999);
ALTER TABLE "goals" ADD CONSTRAINT "goals_saved_range_check"
  CHECK ("saved_minor" >= 0 AND "saved_minor" <= 999999999999);
ALTER TABLE "goals" ADD CONSTRAINT "goals_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$');

-- The idempotency ledger now records mutations of this entity too.
ALTER TABLE "sync_mutations" DROP CONSTRAINT "sync_mutations_entity_check";
ALTER TABLE "sync_mutations"
  ADD CONSTRAINT "sync_mutations_entity_check"
  CHECK ("entity" IN ('category', 'recurring', 'goal', 'expense'));
