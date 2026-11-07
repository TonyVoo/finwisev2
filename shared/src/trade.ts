import { z } from 'zod';
import { CalendarDate, Timestamp } from './primitives.js';
import { SYNCABLE_SHAPE } from './syncable.js';
import { MarketSymbol } from './market.js';

/**
 * A stock trade: one buy or one sell of a Vietnamese stock, entered by the person.
 *
 * The portfolio is **derived**: the device adds up the trades into positions and works out
 * profit and loss. Nothing aggregated is stored or synced, because a total that two devices
 * can both write would resolve by last-write-wins and lose a trade; trades are append-mostly
 * rows, so concurrent entry on two devices merges cleanly.
 *
 * Prices are **whole dong** (VND has no minor unit), for one share and as an integer, never a
 * float. A trade is in dong whatever currency the account keeps its expenses in.
 *
 * **Private to its author.** A household shares one book, but a trade is shown only to the
 * person who entered it: other members never receive the row at all. That is the opposite of
 * a private *expense*, which arrives as a deleted placeholder; a trade has nothing to count in
 * anyone else's totals, so there is nothing to hide the absence of.
 */

/**
 * `dividend` is cash paid on shares already held: `quantity` is the shares it was paid on, `price` the dividend per
 * share and `fee` the tax withheld. It changes no position; it is income, and the device counts it as such.
 */
export const TRADE_SIDES = ['buy', 'sell', 'dividend'] as const;
export const TradeSide = z.enum(TRADE_SIDES);

export const TRADE_NOTE_MAX = 200;

export const TradeQuantity = z
  .number()
  .int()
  .min(1)
  .max(1_000_000_000)
  .describe(
    'Shares. Vietnamese exchanges trade in lots of 100, but odd lots exist, so any whole number.',
  );

export const TradePrice = z
  .number()
  .int()
  .min(1)
  .max(1_000_000_000)
  .describe('Dong per share, as a whole number.');

export const TradeFee = z
  .number()
  .int()
  .min(0)
  .max(1_000_000_000_000)
  .describe('Brokerage fee and tax paid on the trade, in whole dong. Zero when not tracked.');

export const TradeNote = z.string().trim().max(TRADE_NOTE_MAX);

/** A trade as the server reports it. */
export const Trade = z.strictObject({
  ...SYNCABLE_SHAPE,
  symbol: MarketSymbol,
  side: TradeSide,
  quantity: TradeQuantity,
  price: TradePrice,
  fee: TradeFee,
  date: CalendarDate.describe('The day the trade was made.'),
  note: TradeNote.nullable(),
});

/** Mutable fields of a trade in a sync push. Upsert-with-merge, like the other entities. */
export const TradeSyncFields = z
  .strictObject({
    symbol: MarketSymbol.optional(),
    side: TradeSide.optional(),
    quantity: TradeQuantity.optional(),
    price: TradePrice.optional(),
    fee: TradeFee.optional(),
    date: CalendarDate.optional(),
    note: TradeNote.nullable().optional(),
    deletedAt: Timestamp.nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { error: 'fields must not be empty' });

export type TradeSide = z.infer<typeof TradeSide>;
export type Trade = z.infer<typeof Trade>;
export type TradeSyncFields = z.infer<typeof TradeSyncFields>;
