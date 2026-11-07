-- 'dividend' is longer than the four characters the column was made for.
ALTER TABLE "trades" ALTER COLUMN "side" TYPE VARCHAR(8);
