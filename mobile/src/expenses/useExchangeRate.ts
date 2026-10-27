import { useEffect, useState } from 'react';
import type { ApiClient } from '../api/client';

/**
 * The exchange rate for the form: fetched when a foreign currency (or a different day) is
 * chosen, and only until the person types their own.
 *
 * It fails soft by design. Entering an expense must work on a plane, so a missing rate is a
 * state of the form - "enter it yourself" - and never an error screen. A response that
 * arrives after the person has moved on to another currency or day is thrown away, so a slow
 * answer for EUR cannot overwrite the rate for GBP.
 *
 * Only the **text** of the rate leaves this hook; all arithmetic on it is `lib/conversion.ts`.
 */

export type RateStatus = 'idle' | 'loading' | 'failed';

export interface UseExchangeRateArgs {
  readonly api: Pick<ApiClient, 'getRate'>;
  /** The currency paid in. Null (or equal to `home`) means no conversion, so no lookup. */
  readonly from: string | null;
  readonly home: string | null;
  /** `YYYY-MM-DD`; a future day is priced as "latest". */
  readonly date: string | null;
  readonly today: string;
  /** A rate the person typed, or one reopened from a stored expense, is never overwritten. */
  readonly locked: boolean;
  readonly onRate: (rate: string) => void;
}

export function useExchangeRate({
  api,
  from,
  home,
  date,
  today,
  locked,
  onRate,
}: UseExchangeRateArgs): RateStatus {
  const [status, setStatus] = useState<RateStatus>('idle');

  useEffect(() => {
    if (locked || from === null || home === null || from === home) {
      setStatus('idle');
      return;
    }
    let cancelled = false;
    setStatus('loading');
    api.getRate({ from, to: home, ...(date === null || date > today ? {} : { date }) }).then(
      (response) => {
        if (cancelled) return;
        onRate(response.data.rate);
        setStatus('idle');
      },
      () => {
        if (!cancelled) setStatus('failed');
      },
    );
    return () => {
      cancelled = true;
    };
    // `onRate` is deliberately not a dependency: it only stores text, and re-running the
    // lookup because a parent re-rendered would fetch the same rate over and over.
  }, [api, from, home, date, today, locked]);

  return status;
}
