-- A household gets a book of its own: an account-like row no one can sign in to, so ownership can
-- change hands without moving a single synced row. `owner_id` stays as the owner *role*;
-- `scope_id` is what every shared row is scoped by.
--
-- Households made before this existed were scoped by their owner's account, so they are
-- backfilled `scope_id = owner_id`, which is exactly what they already were.
ALTER TABLE "households" ADD COLUMN "scope_id" UUID;
UPDATE "households" SET "scope_id" = "owner_id";
ALTER TABLE "households" ALTER COLUMN "scope_id" SET NOT NULL;
CREATE UNIQUE INDEX "households_scope_id_key" ON "households"("scope_id");
ALTER TABLE "households"
  ADD CONSTRAINT "households_scope_id_fkey"
  FOREIGN KEY ("scope_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
