import { useCallback, useEffect, useState } from 'react';
import type { ApiClient } from '../api/client';

/**
 * The last close of each symbol held, so the portfolio can be valued. Each is fetched on its own and a
 * failure leaves just that one `null`: a holding with no price is shown as such and left out of the
 * profit, never read as a loss. Nothing is retried or cached here; the server caches for a minute, so
 * `refresh` (pull to refresh) is cheap.
 *
 * Skipped entirely while `enabled` is false (offline), and a reply that arrives after the symbols have
 * changed is thrown away.
 */

export interface PortfolioQuotes {
  readonly closes: Readonly<Record<string, number | null>>;
  readonly status: 'idle' | 'loading' | 'done';
  /** Fetch every price again. */
  readonly refresh: () => void;
}

export function usePortfolioQuotes(
  api: Pick<ApiClient, 'getMarketQuote'>,
  symbols: readonly string[],
  enabled: boolean,
): PortfolioQuotes {
  const [state, setState] = useState<Omit<PortfolioQuotes, 'refresh'>>({
    closes: {},
    status: 'idle',
  });
  const [round, setRound] = useState(0);
  const key = symbols.join(',');
  const refresh = useCallback(() => setRound((current) => current + 1), []);

  useEffect(() => {
    if (!enabled || key === '') {
      setState((current) => (current.status === 'idle' ? current : { closes: {}, status: 'idle' }));
      return;
    }
    let cancelled = false;
    const wanted = key.split(',');
    setState((current) => ({ ...current, status: 'loading' }));
    void Promise.all(
      wanted.map(async (symbol): Promise<[string, number | null]> => {
        try {
          const { data } = await api.getMarketQuote(symbol);
          return [symbol, data.close];
        } catch {
          return [symbol, null];
        }
      }),
    ).then((pairs) => {
      if (cancelled) return;
      setState({
        closes: Object.fromEntries(pairs),
        status: 'done',
      });
    });
    return () => {
      cancelled = true;
    };
  }, [api, key, enabled, round]);

  return { ...state, refresh };
}
