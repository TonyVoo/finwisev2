-- Password reset: one short-lived, attempt-limited code per user.
--
-- The code itself is never stored - only an HMAC of it keyed on the server secret and the
-- user id, so a leaked table is not a list of working codes. At most one row per user:
-- asking for a new code replaces the old one (enforced by the unique index).
CREATE TABLE "password_reset_codes" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "code_hash" CHAR(64) NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_reset_codes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "password_reset_codes_user_id_key" ON "password_reset_codes"("user_id");

ALTER TABLE "password_reset_codes"
  ADD CONSTRAINT "password_reset_codes_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
