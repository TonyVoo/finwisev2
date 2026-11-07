import type { TradeListItem } from '../db/queries';

/**
 * The portfolio, worked out from the trades. Nothing here is stored: positions are derived, so two
 * devices entering trades can never overwrite each other's totals (`shared/src/trade.ts`).
 *
 * **Average cost.** Each buy adds to the cost basis, its fee included; each sell removes the
 * average cost of the shares sold and books the difference from its proceeds (net of its fee) as
 * realised profit or loss. That is how Vietnamese brokers report a holding, and it needs no
 * lot-matching.
 *
 * **Dividends** are cash on shares already held: they change no position and are kept apart from
 * realised profit, as income.
 *
 * **Whole dong.** Every figure is an integer. A sell's share of the cost is rounded to the dong,
 * and the cost that remains is what is left after it, so cost never drifts from what was paid.
 *
 * The inputs are bounded by the contract (a trade is at most 1e9 shares at 1e9 dong), which a real
 * trade never approaches; the arithmetic is in doubles and is exact for everything below ~9e15 dong.
 */

export interface Position {
  readonly symbol: string;
  readonly quantity: number;
  /** What the shares held cost, fees included. */
  readonly cost: number;
  /** Cost per share, rounded to the dong; 0 with nothing held. */
  readonly avgCost: number;
  /** Profit or loss booked by selling this symbol, net of fees. */
  readonly realized: number;
  /** Dividends received on this symbol, net of tax withheld. */
  readonly dividends: number;
  /** Shares sold beyond what the trades before them bought, which no cost can be found for. */
  readonly oversold: number;
}

/** One sale and what it made, for the performance figures. */
export interface Sale {
  readonly id: string;
  readonly symbol: string;
  readonly date: string;
  readonly quantity: number;
  /** Profit or loss on the shares that could be priced, net of the fee. */
  readonly realized: number;
  /** What the shares sold had cost. */
  readonly cost: number;
  /** `#tags` written in the notes of the buys and of this sale. */
  readonly tags: readonly string[];
}

export interface PortfolioBook {
  /** What is held now, largest cost first. */
  readonly open: readonly Position[];
  /** Symbols fully sold, with what they made. */
  readonly closed: readonly Position[];
  readonly realized: number;
  /** Dividends received, net of tax. */
  readonly dividends: number;
  /** Every sale, oldest first. */
  readonly sales: readonly Sale[];
}

interface Running {
  quantity: number;
  cost: number;
  realized: number;
  dividends: number;
  oversold: number;
  /** True once a buy or a sell has been seen: a symbol that only paid dividends is not a holding. */
  traded: boolean;
  tags: Set<string>;
}

const TAG = /#([\p{L}\p{N}_]{2,24})/gu;

/** The `#tags` in a note, lower-cased and without the hash, each once. */
export function tagsOf(note: string | null): readonly string[] {
  if (note === null) return [];
  return [...new Set([...note.matchAll(TAG)].map((match) => (match[1] ?? '').toLowerCase()))];
}

/** Trades in the order they happened: the date, then the order they were entered in. */
export function buildPortfolio(trades: readonly TradeListItem[]): PortfolioBook {
  const bySymbol = new Map<string, Running>();
  const sales: Sale[] = [];

  for (const trade of trades) {
    const run = bySymbol.get(trade.symbol) ?? {
      quantity: 0,
      cost: 0,
      realized: 0,
      dividends: 0,
      oversold: 0,
      traded: false,
      tags: new Set<string>(),
    };
    bySymbol.set(trade.symbol, run);

    if (trade.side === 'dividend') {
      run.dividends += trade.quantity * trade.price - trade.fee;
      continue;
    }

    run.traded = true;

    if (trade.side === 'buy') {
      run.quantity += trade.quantity;
      run.cost += trade.quantity * trade.price + trade.fee;
      for (const tag of tagsOf(trade.note)) run.tags.add(tag);
      continue;
    }

    const sold = Math.min(trade.quantity, run.quantity);
    run.oversold += trade.quantity - sold;
    // The fee is spread over the whole sale, so the part belonging to shares we cannot find a cost for is
    // not counted against the ones we can.
    const proceeds = Math.round(sold * trade.price - (trade.fee * sold) / trade.quantity);
    const costOfSold = run.quantity === 0 ? 0 : Math.round((run.cost * sold) / run.quantity);
    const realized = proceeds - costOfSold;
    run.realized += realized;
    run.cost -= costOfSold;
    run.quantity -= sold;
    if (sold > 0) {
      sales.push({
        id: trade.id,
        symbol: trade.symbol,
        date: trade.date,
        quantity: sold,
        realized,
        cost: costOfSold,
        tags: [...new Set([...run.tags, ...tagsOf(trade.note)])],
      });
    }
  }

  const open: Position[] = [];
  const closed: Position[] = [];
  let realized = 0;
  let dividends = 0;
  for (const [symbol, run] of bySymbol) {
    realized += run.realized;
    dividends += run.dividends;
    const position: Position = {
      symbol,
      quantity: run.quantity,
      cost: run.cost,
      avgCost: run.quantity === 0 ? 0 : Math.round(run.cost / run.quantity),
      realized: run.realized,
      dividends: run.dividends,
      oversold: run.oversold,
    };
    // A symbol that only ever paid a dividend (no buys recorded) has nothing held and nothing sold: it is
    // still income, counted in the totals, but not a row of its own.
    if (run.quantity > 0) open.push(position);
    else if (run.traded) closed.push(position);
  }
  open.sort((a, b) => b.cost - a.cost || a.symbol.localeCompare(b.symbol));
  closed.sort((a, b) => a.symbol.localeCompare(b.symbol));
  return { open, closed, realized, dividends, sales };
}

export interface Valuation {
  readonly marketValue: number;
  /** Market value less cost: before the fee and tax a sale would still cost. */
  readonly unrealized: number;
  /** Fraction of cost, `0.05` is +5%; null when there was no cost to compare to. */
  readonly unrealizedPct: number | null;
}

export function valuePosition(position: Position, close: number | null): Valuation | null {
  if (close === null) return null;
  const marketValue = Math.round(position.quantity * close);
  const unrealized = marketValue - position.cost;
  return {
    marketValue,
    unrealized,
    unrealizedPct: position.cost > 0 ? unrealized / position.cost : null,
  };
}

export interface Totals {
  /** Cost of every position held, priced or not. */
  readonly cost: number;
  /** Value of the positions that have a price. */
  readonly marketValue: number;
  /** What the holdings are worth: priced ones at market, unpriced ones at cost, so the figure never drops a holding. */
  readonly worth: number;
  /** Profit or loss on the priced positions only, so an unpriced one cannot read as a loss. */
  readonly unrealized: number;
  /** Fraction of the priced positions' cost; null with none priced. */
  readonly unrealizedPct: number | null;
  readonly realized: number;
  /** Dividends received, net of tax. */
  readonly dividends: number;
  /** How many open positions have no price, so the screen can say the totals are partial. */
  readonly unpriced: number;
}

export function summarise(
  book: PortfolioBook,
  closes: Readonly<Record<string, number | null>>,
): Totals {
  let cost = 0;
  let pricedCost = 0;
  let marketValue = 0;
  let unrealized = 0;
  let unpriced = 0;
  let unpricedCost = 0;
  for (const position of book.open) {
    cost += position.cost;
    const valuation = valuePosition(position, closes[position.symbol] ?? null);
    if (valuation === null) {
      unpriced += 1;
      unpricedCost += position.cost;
      continue;
    }
    pricedCost += position.cost;
    marketValue += valuation.marketValue;
    unrealized += valuation.unrealized;
  }
  return {
    cost,
    marketValue,
    worth: marketValue + unpricedCost,
    unrealized,
    unrealizedPct: pricedCost > 0 ? unrealized / pricedCost : null,
    realized: book.realized,
    dividends: book.dividends,
    unpriced,
  };
}

export interface Performance {
  readonly sales: number;
  readonly wins: number;
  readonly losses: number;
  /** Fraction of sales that made money; null with no sales. Break-even is neither a win nor a loss. */
  readonly winRate: number | null;
  /** Mean profit of the winning sales, and mean loss (positive) of the losing ones. */
  readonly avgWin: number;
  readonly avgLoss: number;
  /** Total won over total lost; null when nothing was lost (infinite) or nothing was won and nothing lost. */
  readonly profitFactor: number | null;
  readonly best: Sale | null;
  readonly worst: Sale | null;
  readonly total: number;
}

/** How the sales did: how often they won, how much on average, and the best and worst. */
export function performanceOf(sales: readonly Sale[]): Performance {
  const wins = sales.filter((sale) => sale.realized > 0);
  const losses = sales.filter((sale) => sale.realized < 0);
  const won = wins.reduce((sum, sale) => sum + sale.realized, 0);
  const lost = losses.reduce((sum, sale) => sum - sale.realized, 0);
  const ranked = [...sales].sort((a, b) => b.realized - a.realized);
  return {
    sales: sales.length,
    wins: wins.length,
    losses: losses.length,
    winRate: sales.length === 0 ? null : wins.length / sales.length,
    avgWin: wins.length === 0 ? 0 : Math.round(won / wins.length),
    avgLoss: losses.length === 0 ? 0 : Math.round(lost / losses.length),
    profitFactor: lost > 0 ? won / lost : null,
    best: ranked[0] ?? null,
    worst:
      ranked.length > 1 || (ranked[0]?.realized ?? 0) < 0
        ? (ranked[ranked.length - 1] ?? null)
        : null,
    total: won - lost,
  };
}

export interface TagResult {
  readonly tag: string;
  readonly sales: number;
  readonly winRate: number;
  readonly total: number;
}

/** Results by the `#tag` a trade was labelled with, best total first: which of your reasons actually paid. */
export function resultsByTag(sales: readonly Sale[]): readonly TagResult[] {
  const groups = new Map<string, Sale[]>();
  for (const sale of sales) {
    for (const tag of sale.tags) groups.set(tag, [...(groups.get(tag) ?? []), sale]);
  }
  return [...groups.entries()]
    .map(([tag, list]) => ({
      tag,
      sales: list.length,
      winRate: list.filter((sale) => sale.realized > 0).length / list.length,
      total: list.reduce((sum, sale) => sum + sale.realized, 0),
    }))
    .sort((a, b) => b.total - a.total || a.tag.localeCompare(b.tag));
}
