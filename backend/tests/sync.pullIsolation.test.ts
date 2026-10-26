import { describe, expect, it } from 'vitest';
import { PULL_TRANSACTION_OPTIONS } from '../src/services/syncPullService.ts';

/**
 * `SYNC-57` (`GAP 18`): the pull reads both tables at the isolation level it claims.
 *
 * Deliberately structural. A page is two queries - categories, then expenses - and under
 * the default `READ COMMITTED` each gets its own snapshot, so a write that commits between
 * them can leave a revision on one side of the cursor that the page never delivers. The
 * window is roughly a tenth of a millisecond wide, so any behavioural test of it would
 * pass or fail by chance, and a case that fails a few percent of the time costs more than
 * it buys. What can be pinned reliably is the setting itself.
 *
 * Before `PULL_TRANSACTION_OPTIONS` existed the level was inline in the `$transaction`
 * call and nothing could assert against it; the suite passed with the line deleted.
 */
describe('the pull transaction', () => {
  it('runs at RepeatableRead', () => {
    expect(PULL_TRANSACTION_OPTIONS.isolationLevel).toBe('RepeatableRead');
  });
});
