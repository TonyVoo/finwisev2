import { Animated, AccessibilityInfo } from 'react-native';
import { act, fireEvent, screen } from '@testing-library/react-native';
import { Keypad } from '@/expenses/Keypad';
import { renderWithSafeArea } from '../support/safeArea';

const noop = () => undefined;

function mountKeypad(onDigit: (digit: number) => void = noop) {
  return renderWithSafeArea(
    <Keypad onDigit={onDigit} onDecimal={noop} onBackspace={noop} decimals={2} />,
  );
}

/** Native-driven animations do not re-render in jest, so the springs are asserted by intent. */
describe('Keypad key press', () => {
  afterEach(() => jest.restoreAllMocks());

  it('dips under the finger and springs back', async () => {
    const spring = jest.spyOn(Animated, 'spring');
    await mountKeypad();

    await act(async () => void fireEvent(screen.getByTestId('keypad-5'), 'pressIn'));
    expect(spring).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ toValue: 0.92 }),
    );

    await act(async () => void fireEvent(screen.getByTestId('keypad-5'), 'pressOut'));
    expect(spring).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ toValue: 1 }),
    );
  });

  it('does not move under Reduce Motion', async () => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
    const spring = jest.spyOn(Animated, 'spring');
    await mountKeypad();

    await act(async () => void fireEvent(screen.getByTestId('keypad-5'), 'pressIn'));
    expect(spring).not.toHaveBeenCalled();
  });

  it('still reports the digit pressed', async () => {
    const onDigit = jest.fn();
    await mountKeypad(onDigit);

    fireEvent.press(screen.getByTestId('keypad-7'));
    expect(onDigit).toHaveBeenCalledWith(7);
  });
});
