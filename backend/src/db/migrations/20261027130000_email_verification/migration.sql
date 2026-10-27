-- Email verification: a verified-at stamp on the user, and one pending code per user.
ALTER TABLE "users" ADD COLUMN "email_verified_at" TIMESTAMPTZ(3);

CREATE TABLE "email_verification_codes" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "code_hash" CHAR(64) NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_verification_codes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "email_verification_codes_user_id_key" ON "email_verification_codes"("user_id");

ALTER TABLE "email_verification_codes"
  ADD CONSTRAINT "email_verification_codes_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
