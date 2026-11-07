-- Stock trades: a synced entity that is private to its author.
--
-- The portfolio is derived on the device, so only the trades are stored. `user_id` is the book (as on
-- every syncable row); `created_by` is the one person a row is ever delivered to. Prices are whole
-- dong, so there is no currency and no minor unit.
CREATE TABLE "trades" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "created_by" UUID NOT NULL,
    "symbol" VARCHAR(10) NOT NULL,
    "side" VARCHAR(4) NOT NULL,
    "quantity" BIGINT NOT NULL,
    "price" BIGINT NOT NULL,
    "fee" BIGINT NOT NULL DEFAULT 0,
    "date" DATE NOT NULL,
    "note" VARCHAR(200),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    "revision" INTEGER NOT NULL,

    CONSTRAINT "trades_pkey" PRIMARY KEY ("id")
);

-- The sync pull walks revision within a book, for one author.
CREATE UNIQUE INDEX "trades_user_id_revision_key" ON "trades"("user_id", "revision");
CREATE INDEX "trades_user_id_created_by_revision_idx" ON "trades"("user_id", "created_by", "revision");

ALTER TABLE "trades"
  ADD CONSTRAINT "trades_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "trades"
  ADD CONSTRAINT "trades_created_by_fkey"
  FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "trades" ADD CONSTRAINT "trades_revision_positive_check" CHECK ("revision" > 0);
ALTER TABLE "trades" ADD CONSTRAINT "trades_symbol_check" CHECK ("symbol" ~ '^[A-Z0-9]{1,10}$');
ALTER TABLE "trades" ADD CONSTRAINT "trades_side_check" CHECK ("side" IN ('buy', 'sell'));
ALTER TABLE "trades" ADD CONSTRAINT "trades_quantity_range_check"
  CHECK ("quantity" >= 1 AND "quantity" <= 1000000000);
ALTER TABLE "trades" ADD CONSTRAINT "trades_price_range_check"
  CHECK ("price" >= 1 AND "price" <= 1000000000);
ALTER TABLE "trades" ADD CONSTRAINT "trades_fee_range_check"
  CHECK ("fee" >= 0 AND "fee" <= 1000000000000);

-- The idempotency ledger now records mutations of this entity too.
ALTER TABLE "sync_mutations" DROP CONSTRAINT "sync_mutations_entity_check";
ALTER TABLE "sync_mutations"
  ADD CONSTRAINT "sync_mutations_entity_check"
  CHECK ("entity" IN ('category', 'recurring', 'goal', 'expense', 'settlement', 'trade'));
