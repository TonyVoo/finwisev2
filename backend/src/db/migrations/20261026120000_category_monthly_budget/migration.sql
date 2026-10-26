-- A per-category monthly budget.
--
-- Stored on the category rather than in a table of its own: one budget per category, the
-- same every month, so it is an attribute of the row and rides the category's existing
-- sync (revision, last-write-wins, tombstones) with no new entity. NULL means "no budget".
-- Existing rows are untouched and read as NULL.
ALTER TABLE "categories" ADD COLUMN "monthly_budget_minor" BIGINT;

-- Strictly positive, same ceiling as an expense amount. The CHECK is what makes the
-- contract's "no budget is null, never 0" true at rest rather than only at the edge.
ALTER TABLE "categories"
  ADD CONSTRAINT "categories_monthly_budget_positive"
  CHECK ("monthly_budget_minor" IS NULL OR ("monthly_budget_minor" >= 1 AND "monthly_budget_minor" <= 999999999999));
