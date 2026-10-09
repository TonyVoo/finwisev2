-- Bound the idempotency ledger: the index the retention sweep scans on.
--
-- `sync_mutations` had no ceiling — one row per mutation per user, forever. It is now
-- swept on the same 90-day horizon as tombstones, by the same job
-- (`services/tombstoneService.ts`). No data change here: the sweep is code, and the
-- rows it will delete are already past the horizon or will reach it.

-- The sweep runs in two steps and both read `created_at`. Discovery scans it across
-- every user — an account that pushes and never deletes has no tombstone to be found
-- by, so the ledger is the only place it is visible — and the per-user DELETE then
-- filters `user_id` plus `created_at`. Hence the index is on `created_at` alone and not
-- user-first: the primary key already covers user-first lookups, which is the shape
-- every push uses.
--
-- Not partial, unlike the two tombstone indexes beside it: every ledger row has a
-- `created_at`, so there is no mostly-NULL majority to exclude. The write cost is one
-- index entry per pushed mutation, against a daily sequential scan of the largest
-- table in the schema.
CREATE INDEX "sync_mutations_created_at_idx" ON "sync_mutations" ("created_at");
