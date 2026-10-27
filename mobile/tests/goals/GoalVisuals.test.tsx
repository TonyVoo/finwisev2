import { AccessibilityInfo, Animated } from 'react-native';
import { act, render, screen } from '@testing-library/react-native';
import { GoalBadge, GoalBar } from '@/goals/GoalVisuals';

const hidden = { includeHiddenElements: true };

describe('GoalBar', () => {
  afterEach(() => jest.restoreAllMocks());

  it('shows the first fill at once, without animating', async () => {
    const timing = jest.spyOn(Animated, 'timing');
    await render(<GoalBar fill={0.4} reached={false} testID="bar" />);

    expect(timing).not.toHaveBeenCalled();
    expect(screen.getByTestId('bar-fill', hidden)).toBeTruthy();
  });

  it('eases to a new fill', async () => {
    const timing = jest.spyOn(Animated, 'timing');
    const view = await render(<GoalBar fill={0.4} reached={false} testID="bar" />);

    await act(async () => view.rerender(<GoalBar fill={0.7} reached={false} testID="bar" />));
    expect(timing).toHaveBeenCalledTimes(1);
  });

  it('does not animate under Reduce Motion', async () => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
    const timing = jest.spyOn(Animated, 'timing');
    const view = await render(<GoalBar fill={0.1} reached={false} testID="bar" />);

    await act(async () => view.rerender(<GoalBar fill={0.9} reached={false} testID="bar" />));
    expect(timing).not.toHaveBeenCalled();
  });

  it('is decorative', async () => {
    await render(<GoalBar fill={0.5} reached={false} testID="bar" />);
    expect(screen.getByTestId('bar', hidden).props.accessibilityElementsHidden).toBe(true);
  });
});

describe('GoalBadge', () => {
  it('is a target while saving and a check once reached', async () => {
    const view = await render(<GoalBadge reached={false} />);
    expect(screen.getByTestId('goal-badge-target', hidden)).toBeTruthy();

    await act(async () => view.rerender(<GoalBadge reached />));
    expect(screen.getByTestId('goal-badge-check', hidden)).toBeTruthy();
  });
});
