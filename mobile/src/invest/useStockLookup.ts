import type { MarketQuote, MarketSignal } from '@expense-tracker/shared';
import { useCallback, useRef, useState } from 'react';
import type { ApiClient } from '../api/client';
import { ApiRequestError } from '../api/errors';

/**
 * Looking a stock up: its quote and its screening score, fetched together.
 *
 * The quote is the point; the score is a bonus. If only the score fails the quote is still shown,
 * and if the quote fails the whole lookup is `failed` - the screen says market data is
 * unavailable and nothing else in the app is touched. A slow answer for a symbol the person has
 * since replaced is thrown away, so AAA's numbers can never land under BBB's name.
 */

export type LookupState =
  | { readonly status: 'idle' }
  | { readonly status: 'loading'; readonly symbol: string }
  | {
      readonly status: 'ready';
      readonly quote: MarketQuote;
      readonly signal: MarketSignal | null;
    }
  | {
      readonly status: 'failed';
      readonly symbol: string;
      /** `notFound`: the service has no such ticker (a typo). `unavailable`: anything else. */
      readonly reason: 'notFound' | 'unavailable';
    };

export function useStockLookup(api: Pick<ApiClient, 'getMarketQuote' | 'getMarketSignal'>) {
  const [state, setState] = useState<LookupState>({ status: 'idle' });
  const ticket = useRef(0);

  const lookup = useCallback(
    async (symbol: string): Promise<void> => {
      ticket.current += 1;
      const mine = ticket.current;
      setState({ status: 'loading', symbol });
      const [quote, signal] = await Promise.allSettled([
        api.getMarketQuote(symbol),
        api.getMarketSignal(symbol),
      ]);
      if (mine !== ticket.current) return;
      if (quote.status === 'rejected') {
        const notFound =
          quote.reason instanceof ApiRequestError && quote.reason.code === 'not_found';
        setState({ status: 'failed', symbol, reason: notFound ? 'notFound' : 'unavailable' });
        return;
      }
      setState({
        status: 'ready',
        quote: quote.value.data,
        signal: signal.status === 'fulfilled' ? signal.value.data : null,
      });
    },
    [api],
  );

  return { state, lookup };
}
