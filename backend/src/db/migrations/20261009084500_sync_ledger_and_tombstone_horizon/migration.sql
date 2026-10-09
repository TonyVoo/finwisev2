-- Sync: the idempotency ledger, the tombstone horizon watermark, and the indexes the
-- pull and the pruner scan on.
--
-- See `docs/PLAN.md` §4 for the protocol these three support.

-- CreateTable
CREATE TABLE "sync_mutations" (
    "user_id" UUID NOT NULL,
    "client_mutation_id" UUID NOT NULL,
    "entity" VARCHAR(16) NOT NULL,
    "record_id" UUID NOT NULL,
    "status" VARCHAR(24) NOT NULL,
    "payload_hash" CHAR(64) NOT NULL,
    "error" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sync_mutations_pkey" PRIMARY KEY ("user_id", "client_mutation_id")
);

-- AddForeignKey
ALTER TABLE "sync_mutations" ADD CONSTRAINT "sync_mutations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "revision_counters" ADD COLUMN "pruned_through_revision" INTEGER NOT NULL DEFAULT 0;

-- ---------------------------------------------------------------------------------
-- Hand-written from here: constraints and indexes the Prisma schema language cannot
-- express. Prisma does not model these, so it will neither recreate nor drop them —
-- they are owned by this migration, and changing one means a new migration.
-- ---------------------------------------------------------------------------------

-- `clientMutationId` is the client's idempotency key, and the primary key above is
-- what makes "unique per user" a guarantee rather than a convention: two retries
-- racing on two connections both try to insert it, and the loser replays the
-- winner's recorded outcome instead of applying the mutation a second time.
--
-- These two CHECKs keep the ledger's own columns honest. A row with a status outside
-- the contract's enum would be replayed to a client as a status it cannot parse, and
-- the values are owned by `SYNC_PUSH_STATUSES` / `SYNC_ENTITIES` in `shared/`.
ALTER TABLE "sync_mutations"
    ADD CONSTRAINT "sync_mutations_status_check"
    CHECK ("status" IN ('applied', 'conflict_server_wins', 'invalid'));

ALTER TABLE "sync_mutations"
    ADD CONSTRAINT "sync_mutations_entity_check"
    CHECK ("entity" IN ('category', 'expense'));

-- An `error` envelope belongs to an `invalid` outcome and to nothing else. The
-- contract says `error` is "non-null only when `status` is `invalid`", and a client
-- that trusts that would otherwise be handed a conflict carrying an error.
ALTER TABLE "sync_mutations"
    ADD CONSTRAINT "sync_mutations_error_only_when_invalid_check"
    CHECK (("status" = 'invalid') = ("error" IS NOT NULL));

-- The horizon watermark only ever moves forward: it is the highest revision whose
-- tombstone has been pruned, and lowering it would tell a client an incremental pull
-- is safe when the delete it needs has already been destroyed.
ALTER TABLE "revision_counters"
    ADD CONSTRAINT "revision_counters_pruned_through_range_check"
    CHECK ("pruned_through_revision" >= 0 AND "pruned_through_revision" <= "last_revision");

-- The pruner sweeps tombstones across every user, so it filters on `deleted_at`
-- without a `user_id`. Partial, because the overwhelming majority of rows are live
-- and indexing their NULLs would be dead weight on every write.
CREATE INDEX "categories_deleted_at_tombstone_idx"
    ON "categories" ("deleted_at")
    WHERE "deleted_at" IS NOT NULL;

CREATE INDEX "expenses_deleted_at_tombstone_idx"
    ON "expenses" ("deleted_at")
    WHERE "deleted_at" IS NOT NULL;
