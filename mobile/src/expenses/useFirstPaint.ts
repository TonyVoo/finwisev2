import { useEffect, useState } from 'react';

/**
 * The 300ms deadline on a first-paint skeleton.
 *
 * `docs/design/02-offline-and-sync.md` §1 puts a hard limit on `loading:first-paint`:
 *
 * > Never shown for longer than 300ms without becoming the `empty` state, because if the
 * > query returned nothing, the answer is "empty", not "loading".
 *
 * In practice a local SQLite read resolves in a frame or two and the skeleton is never
 * seen. The deadline is for the case where it does not: a skeleton that outlives it is a
 * screen claiming to be busy, and the user cannot tell that from a screen that is broken.
 * After 300ms the screen commits to an answer.
 *
 * @param pending whether the query is still in flight.
 * @returns whether to draw the skeleton.
 */
export function useFirstPaintSkeleton(pending: boolean): boolean {
  const [deadlinePassed, setDeadlinePassed] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setDeadlinePassed(true), FIRST_PAINT_MS);
    return () => clearTimeout(timer);
  }, []);

  return pending && !deadlinePassed;
}

export const FIRST_PAINT_MS = 300;
