import { AccessibilityInfo, Animated } from 'react-native';
import { act, render } from '@testing-library/react-native';
import { AmountDisplay } from '@/expenses/AmountDisplay';

/** The figure gives a small pop when its value changes, never on first paint. */
describe('AmountDisplay pop', () => {
  afterEach(() => jest.restoreAllMocks());

  it('pops when the amount changes, not on first paint', async () => {
    const spring = jest.spyOn(Animated, 'spring');
    const view = await render(<AmountDisplay amountMinor={0} currency="USD" muted />);
    expect(spring).not.toHaveBeenCalled();

    await act(async () =>
      view.rerender(<AmountDisplay amountMinor={5} currency="USD" muted={false} />),
    );
    expect(spring).toHaveBeenCalledTimes(1);
  });

  it('stays still under Reduce Motion', async () => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
    const spring = jest.spyOn(Animated, 'spring');
    const view = await render(<AmountDisplay amountMinor={0} currency="USD" muted />);

    await act(async () =>
      view.rerender(<AmountDisplay amountMinor={5} currency="USD" muted={false} />),
    );
    expect(spring).not.toHaveBeenCalled();
  });
});
