-- Receipt photos: at most one per expense, bytes stored inline.
CREATE TABLE "expense_receipts" (
    "expense_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "content_type" VARCHAR(32) NOT NULL,
    "bytes" BYTEA NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "expense_receipts_pkey" PRIMARY KEY ("expense_id")
);

CREATE INDEX "expense_receipts_user_id_idx" ON "expense_receipts"("user_id");

ALTER TABLE "expense_receipts"
  ADD CONSTRAINT "expense_receipts_expense_id_fkey"
  FOREIGN KEY ("expense_id") REFERENCES "expenses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "expense_receipts"
  ADD CONSTRAINT "expense_receipts_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
