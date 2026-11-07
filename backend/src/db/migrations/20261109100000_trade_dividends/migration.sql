-- A trade may also be a dividend: cash paid on shares already held (quantity = shares, price = per share,
-- fee = tax withheld). It changes no position, so it is just another kind of row in the same table.
ALTER TABLE "trades" DROP CONSTRAINT "trades_side_check";
ALTER TABLE "trades" ADD CONSTRAINT "trades_side_check" CHECK ("side" IN ('buy', 'sell', 'dividend'));
