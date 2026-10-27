-- Income shares the expenses table: `kind` says which way the money moved.
ALTER TABLE "expenses" ADD COLUMN "kind" VARCHAR(7) NOT NULL DEFAULT 'expense';
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_kind_check" CHECK ("kind" IN ('expense', 'income'));
