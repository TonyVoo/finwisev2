import { TRADE_NOTE_MAX } from '@expense-tracker/shared';
import { COPY } from '../copy/strings';
import type { NewTrade } from '../db/mutations';
import type { TradeListItem } from '../db/queries';
import { parseDateInput } from '../recurring/recurringModel';
import { cleanSymbol, parseWhole } from './investModel';

/**
 * The Add trade form, judged as data: what was typed, and either a trade the contract accepts or what is
 * wrong. Pure and integer-only: shares and dong are read as digits, never parsed as decimals.
 */

export interface TradeDraft {
  readonly side: 'buy' | 'sell' | 'dividend';
  readonly symbolText: string;
  readonly quantityText: string;
  readonly priceText: string;
  readonly feeText: string;
  readonly dateText: string;
  readonly noteText: string;
}

export type TradeErrors = Partial<Record<'symbol' | 'quantity' | 'price' | 'fee' | 'date', string>>;

export function emptyTradeDraft(today: string): TradeDraft {
  return {
    side: 'buy',
    symbolText: '',
    quantityText: '',
    priceText: '',
    feeText: '',
    dateText: today,
    noteText: '',
  };
}

export function draftFromTrade(trade: TradeListItem): TradeDraft {
  return {
    side: trade.side,
    symbolText: trade.symbol,
    quantityText: String(trade.quantity),
    priceText: String(trade.price),
    feeText: trade.fee === 0 ? '' : String(trade.fee),
    dateText: trade.date,
    noteText: trade.note ?? '',
  };
}

export function validateTradeDraft(
  draft: TradeDraft,
):
  | { readonly ok: true; readonly value: NewTrade }
  | { readonly ok: false; readonly errors: TradeErrors } {
  const errors: { -readonly [K in keyof TradeErrors]: string } = {};

  const symbol = cleanSymbol(draft.symbolText);
  if (symbol === null) errors.symbol = COPY.portfolio.symbolError;

  const quantity = parseWhole(draft.quantityText);
  if (quantity === null || quantity > 1_000_000_000) errors.quantity = COPY.portfolio.quantityError;

  const price = parseWhole(draft.priceText);
  if (price === null || price > 1_000_000_000) errors.price = COPY.portfolio.priceError;

  // Empty is a fee of nothing; anything else has to be a whole number of dong.
  const feeEmpty = draft.feeText.trim() === '';
  const parsedFee = feeEmpty ? 0 : /^\s*0+\s*$/.test(draft.feeText) ? 0 : parseWhole(draft.feeText);
  if (parsedFee === null || parsedFee > 1_000_000_000_000) errors.fee = COPY.portfolio.feeError;

  const date = parseDateInput(draft.dateText);
  if (date === null) errors.date = COPY.portfolio.dateError;

  if (
    symbol === null ||
    quantity === null ||
    price === null ||
    parsedFee === null ||
    date === null ||
    Object.keys(errors).length > 0
  ) {
    return { ok: false, errors };
  }

  const note = draft.noteText.trim().slice(0, TRADE_NOTE_MAX);
  return {
    ok: true,
    value: {
      symbol,
      side: draft.side,
      quantity,
      price,
      fee: parsedFee,
      date,
      ...(note === '' ? {} : { note }),
    },
  };
}
