-- Who added an expense: the actor, which in a household is not the owner whose id scopes the row.
-- Nullable: rows from before this was recorded stay NULL, and the FK nulls rather than cascades,
-- so deleting the account that added a row never deletes the household's history.
ALTER TABLE "expenses" ADD COLUMN "created_by" UUID;
ALTER TABLE "expenses"
  ADD CONSTRAINT "expenses_created_by_fkey"
  FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
