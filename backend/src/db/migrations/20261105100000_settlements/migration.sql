-- Settlements: recorded payments between two household members, a fifth synced entity
-- (see `docs/design/12-settle-up.md`).
--
-- The two people and the recorder carry no foreign key on purpose: a member leaving must not cost
-- the household its history. Who may write one is checked when it is written.
CREATE TABLE "settlements" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "from_user_id" UUID NOT NULL,
    "to_user_id" UUID NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "date" DATE NOT NULL,
    "note" VARCHAR(200),
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    "revision" INTEGER NOT NULL,

    CONSTRAINT "settlements_pkey" PRIMARY KEY ("id")
);

-- The sync pull walks revision within a book.
CREATE UNIQUE INDEX "settlements_user_id_revision_key" ON "settlements"("user_id", "revision");

ALTER TABLE "settlements"
  ADD CONSTRAINT "settlements_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "settlements" ADD CONSTRAINT "settlements_revision_positive_check" CHECK ("revision" > 0);
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_amount_range_check"
  CHECK ("amount_minor" >= 1 AND "amount_minor" <= 999999999999);
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_distinct_people_check"
  CHECK ("from_user_id" <> "to_user_id");

-- The idempotency ledger now records mutations of this entity too.
ALTER TABLE "sync_mutations" DROP CONSTRAINT "sync_mutations_entity_check";
ALTER TABLE "sync_mutations"
  ADD CONSTRAINT "sync_mutations_entity_check"
  CHECK ("entity" IN ('category', 'recurring', 'goal', 'expense', 'settlement'));
