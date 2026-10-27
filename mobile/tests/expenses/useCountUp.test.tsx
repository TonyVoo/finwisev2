import { act, renderHook } from '@testing-library/react-native';
import { tween, useCountUp } from '@/expenses/useCountUp';

describe('tween', () => {
  it('starts at from, ends at to, and is monotonic between', () => {
    expect(tween(100, 200, 0)).toBe(100);
    expect(tween(100, 200, 1)).toBe(200);
    const mid = tween(100, 200, 0.5);
    expect(mid).toBeGreaterThan(100);
    expect(mid).toBeLessThan(200);
  });

  it('works downward and returns whole minor units', () => {
    expect(tween(200, 100, 0.3)).toBeLessThan(200);
    expect(Number.isInteger(tween(0, 999, 0.37))).toBe(true);
  });
});

describe('useCountUp', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('shows the first value at once, without animating', async () => {
    const { result } = await renderHook(() => useCountUp(500, false));
    expect(result.current).toBe(500);
  });

  it('walks to a new value and lands exactly on it', async () => {
    const { result, rerender } = await renderHook(
      ({ value }: { value: number }) => useCountUp(value, false),
      { initialProps: { value: 100 } },
    );
    await act(async () => rerender({ value: 400 }));
    await act(async () => void jest.advanceTimersByTime(100));
    expect(result.current).toBeGreaterThan(100);
    expect(result.current).toBeLessThan(400);
    await act(async () => void jest.advanceTimersByTime(1000));
    expect(result.current).toBe(400);
  });

  it('jumps straight to the value under Reduce Motion', async () => {
    const { result, rerender } = await renderHook(
      ({ value }: { value: number }) => useCountUp(value, true),
      { initialProps: { value: 100 } },
    );
    await act(async () => rerender({ value: 400 }));
    expect(result.current).toBe(400);
  });

  it('passes undefined through while the first read is in flight', async () => {
    const { result } = await renderHook(() => useCountUp(undefined, false));
    expect(result.current).toBeUndefined();
  });
});
