-- A display name: what other people (a household's members) see instead of the part of an email
-- address before the @. Optional and not a credential.
ALTER TABLE "users" ADD COLUMN "display_name" VARCHAR(40);
ALTER TABLE "users" ADD CONSTRAINT "users_display_name_check"
  CHECK ("display_name" IS NULL OR char_length("display_name") BETWEEN 1 AND 40);
