-- Shared households. The household's data lives under the owner's user id, so no synced table
-- changes: these three tables only answer "whose rows does this account read and write".
CREATE TABLE "households" (
    "id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "households_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "households_owner_id_key" ON "households"("owner_id");
ALTER TABLE "households"
  ADD CONSTRAINT "households_owner_id_fkey"
  FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "household_members" (
    "household_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" VARCHAR(6) NOT NULL,
    "joined_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "household_members_pkey" PRIMARY KEY ("household_id", "user_id")
);
-- One household per person.
CREATE UNIQUE INDEX "household_members_user_id_key" ON "household_members"("user_id");
ALTER TABLE "household_members"
  ADD CONSTRAINT "household_members_household_id_fkey"
  FOREIGN KEY ("household_id") REFERENCES "households"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "household_members"
  ADD CONSTRAINT "household_members_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "household_members"
  ADD CONSTRAINT "household_members_role_check" CHECK ("role" IN ('owner', 'member'));

CREATE TABLE "household_invites" (
    "household_id" UUID NOT NULL,
    "code_hash" CHAR(64) NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "household_invites_pkey" PRIMARY KEY ("household_id")
);
CREATE UNIQUE INDEX "household_invites_code_hash_key" ON "household_invites"("code_hash");
ALTER TABLE "household_invites"
  ADD CONSTRAINT "household_invites_household_id_fkey"
  FOREIGN KEY ("household_id") REFERENCES "households"("id") ON DELETE CASCADE ON UPDATE CASCADE;
