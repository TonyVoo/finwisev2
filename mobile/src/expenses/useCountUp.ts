import { useEffect, useRef, useState } from 'react';

const DURATION_MS = 450;
const STEP_MS = 16;

/** Ease-out interpolation between two integer amounts. */
export function tween(from: number, to: number, t: number): number {
  const eased = 1 - (1 - t) ** 3;
  return Math.round(from + (to - from) * eased);
}

/**
 * The amount to *draw*: it walks from the previous value to a new one so a change reads as
 * movement. The accessible label elsewhere always carries the final figure, so the walk is
 * purely visual. The first value, and any value under Reduce Motion, is shown at once.
 */
export function useCountUp(target: number | undefined, reduceMotion: boolean): number | undefined {
  const [shown, setShown] = useState(target);
  const current = useRef(target);

  useEffect(() => {
    const from = current.current;
    if (target === undefined || from === undefined || reduceMotion || from === target) {
      current.current = target;
      setShown(target);
      return;
    }
    const start = Date.now();
    const timer = setInterval(() => {
      const t = Math.min(1, (Date.now() - start) / DURATION_MS);
      const value = t >= 1 ? target : tween(from, target, t);
      current.current = value;
      setShown(value);
      if (t >= 1) clearInterval(timer);
    }, STEP_MS);
    return () => clearInterval(timer);
  }, [target, reduceMotion]);

  return shown;
}
