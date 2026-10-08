-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "password_hash" TEXT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "revision_counters" (
    "user_id" UUID NOT NULL,
    "last_revision" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "revision_counters_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "categories" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "name" VARCHAR(64) NOT NULL,
    "color" CHAR(7) NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    "revision" INTEGER NOT NULL,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expenses" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "category_id" UUID NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "date" DATE NOT NULL,
    "note" VARCHAR(500),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    "revision" INTEGER NOT NULL,

    CONSTRAINT "expenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "categories_user_id_is_default_idx" ON "categories"("user_id", "is_default");

-- CreateIndex
CREATE UNIQUE INDEX "categories_user_id_revision_key" ON "categories"("user_id", "revision");

-- CreateIndex
CREATE INDEX "expenses_user_id_date_idx" ON "expenses"("user_id", "date" DESC);

-- CreateIndex
CREATE INDEX "expenses_user_id_category_id_idx" ON "expenses"("user_id", "category_id");

-- CreateIndex
CREATE UNIQUE INDEX "expenses_user_id_revision_key" ON "expenses"("user_id", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_token_hash_key" ON "refresh_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "refresh_tokens_user_id_idx" ON "refresh_tokens"("user_id");

-- AddForeignKey
ALTER TABLE "revision_counters" ADD CONSTRAINT "revision_counters_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------------
-- Everything below is hand-written: it expresses constraints the Prisma schema
-- language cannot (partial indexes, functional indexes, CHECK constraints, and the
-- revision function). Prisma does not model these, so it will neither recreate nor
-- drop them — they are owned by this migration. Changing one means a new migration.
-- ---------------------------------------------------------------------------------

-- Emails are stored trimmed and lowercased so that `A@x.com` and `a@x.com` cannot
-- both register. The application normalises on the way in; this constraint is what
-- makes that a guarantee rather than a convention, and turns a code path that forgets
-- to normalise into a loud failure instead of a duplicate account.
ALTER TABLE "users"
    ADD CONSTRAINT "users_email_normalised_check"
    CHECK ("email" = lower(btrim("email")));

-- Per-user revision sequence. See the comment on `RevisionCounter` in schema.prisma:
-- the sync cursor needs a watermark that is per-user, gap-free and strictly
-- increasing, which a Postgres SEQUENCE is not (global, and gaps on rollback).
--
-- The UPDATE takes a row lock, so concurrent writers for the same user serialise and
-- cannot be handed the same number; and because the increment is part of the caller's
-- transaction, a rollback gives the numbers back. Callers MUST call this inside the
-- same transaction as the write it stamps.
--
-- Returns the LAST revision of the allocated block, so a caller writing n rows takes
-- `[last - n + 1 .. last]` in one round trip. Signup seeds six categories and a sync
-- push can carry hundreds; one statement per row would be that many round trips.
CREATE FUNCTION "next_revision_block"(p_user_id UUID, p_count INTEGER) RETURNS INTEGER AS $$
DECLARE
    v_last INTEGER;
BEGIN
    IF p_count IS NULL OR p_count < 1 THEN
        RAISE EXCEPTION 'next_revision_block: count must be >= 1, got %', p_count;
    END IF;

    UPDATE "revision_counters"
       SET "last_revision" = "last_revision" + p_count
     WHERE "user_id" = p_user_id
    RETURNING "last_revision" INTO v_last;

    IF v_last IS NULL THEN
        RAISE EXCEPTION 'no revision counter for user %', p_user_id
            USING ERRCODE = 'foreign_key_violation';
    END IF;

    RETURN v_last;
END;
$$ LANGUAGE plpgsql;

-- The single-row case, which is every REST write.
CREATE FUNCTION "next_revision"(p_user_id UUID) RETURNS INTEGER AS $$
    SELECT "next_revision_block"(p_user_id, 1);
$$ LANGUAGE sql;

-- A revision is handed out by next_revision() and starts at 1, so 0 means "the row
-- was written without being stamped" — a bug that would make the row invisible to
-- every sync cursor. Fail the write instead.
ALTER TABLE "categories" ADD CONSTRAINT "categories_revision_positive_check" CHECK ("revision" > 0);
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_revision_positive_check" CHECK ("revision" > 0);

-- Category names are unique per user among *live* categories, compared
-- case-insensitively. Partial, so a tombstoned "Coffee" does not block creating a new
-- one; functional, so "coffee" does.
CREATE UNIQUE INDEX "categories_user_id_lower_name_live_key"
    ON "categories" ("user_id", lower("name"))
    WHERE "deleted_at" IS NULL;

-- Exactly one live default (`Uncategorized`) per user. Category deletes reassign
-- their expenses to it, so "the default" has to be unambiguous.
CREATE UNIQUE INDEX "categories_user_id_single_default_key"
    ON "categories" ("user_id")
    WHERE "is_default" AND "deleted_at" IS NULL;

-- A default category cannot be tombstoned: `Uncategorized` must always exist because
-- it is where deleted categories' expenses go. The API reports an attempt as
-- `409 category_not_deletable`; this is the backstop.
ALTER TABLE "categories"
    ADD CONSTRAINT "categories_default_not_deletable_check"
    CHECK (NOT ("is_default" AND "deleted_at" IS NOT NULL));

-- Money is a non-negative integer in the currency's minor unit, bounded by the
-- contract's documented maximum (LIMITS.AMOUNT_MINOR_MAX in `shared/`).
ALTER TABLE "expenses"
    ADD CONSTRAINT "expenses_amount_minor_range_check"
    CHECK ("amount_minor" >= 0 AND "amount_minor" <= 999999999999);

-- ISO 4217 alphabetic codes are uppercase on the wire and at rest.
ALTER TABLE "users" ADD CONSTRAINT "users_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$');
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$');
