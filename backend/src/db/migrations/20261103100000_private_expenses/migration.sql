-- Private expenses: in a household, only the author sees the content; everyone else's copy is a
-- deleted placeholder (see `toWireExpense`).
ALTER TABLE "expenses" ADD COLUMN "private" BOOLEAN NOT NULL DEFAULT false;
