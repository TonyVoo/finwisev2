-- A person may be in several households, and may own several (docs/design/13-multiple-households.md).
-- Until now one membership per person and one household per owner were enforced by unique indexes; they
-- become plain indexes (the lookups still need them), and a household gains a name to tell them apart.
DROP INDEX "household_members_user_id_key";
CREATE INDEX "household_members_user_id_idx" ON "household_members"("user_id");

DROP INDEX "households_owner_id_key";
CREATE INDEX "households_owner_id_idx" ON "households"("owner_id");

ALTER TABLE "households" ADD COLUMN "name" VARCHAR(40) NOT NULL DEFAULT 'Household';
ALTER TABLE "households"
  ADD CONSTRAINT "households_name_check" CHECK (char_length(btrim("name")) BETWEEN 1 AND 40);
