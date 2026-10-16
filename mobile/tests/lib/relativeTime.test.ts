import { relativeTime } from '@/lib/relativeTime';

/**
 * `docs/design/09-copy-deck.md` §5, at its boundaries.
 *
 * The boundaries are what this is for: each threshold is one of the three places a
 * relative time goes wrong, and none of them is visible in normal use. The sheet shows
 * `Last synced {relative}` and nothing else reads this.
 */

const NOW = new Date('2026-10-16T12:00:00.000Z');

function ago(ms: number): string {
  return relativeTime(new Date(NOW.getTime() - ms), NOW, 'en-GB');
}

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe('relativeTime', () => {
  it('reads just now under a minute', () => {
    expect(ago(0)).toBe('just now');
    expect(ago(59 * SECOND)).toBe('just now');
  });

  it('switches to minutes on the minute, in the singular first', () => {
    expect(ago(MINUTE)).toBe('1 minute ago');
    expect(ago(2 * MINUTE)).toBe('2 minutes ago');
    expect(ago(59 * MINUTE)).toBe('59 minutes ago');
  });

  it('floors rather than rounds', () => {
    // 119 minutes is `1 hour ago`, not `2 hours ago`: overstating staleness invites a
    // refresh the user does not need.
    expect(ago(HOUR + 59 * MINUTE)).toBe('1 hour ago');
    expect(ago(2 * HOUR)).toBe('2 hours ago');
  });

  it('switches to days after 24 hours', () => {
    expect(ago(23 * HOUR + 59 * MINUTE)).toBe('23 hours ago');
    expect(ago(DAY)).toBe('1 day ago');
    expect(ago(6 * DAY)).toBe('6 days ago');
  });

  it('becomes an absolute date at a week', () => {
    // Beyond a week `{n} days ago` stops being easier to read than the date itself.
    expect(ago(7 * DAY)).toBe('on 9 Oct 2026');
    expect(ago(400 * DAY)).toBe('on 11 Sept 2025');
  });

  /**
   * The deck is explicit: "A negative interval (a device clock that moved backwards)
   * renders `just now` rather than a future time." A manual clock change or an NTP
   * correction after a cold boot is enough to produce one, and `in 3 hours` for something
   * that already happened is nonsense the user cannot act on.
   */
  it('never renders a future time', () => {
    expect(relativeTime(new Date(NOW.getTime() + 3 * HOUR), NOW, 'en-GB')).toBe('just now');
  });
});
