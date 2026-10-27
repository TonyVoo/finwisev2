import { AccessibilityInfo, Animated, Text } from 'react-native';
import { act, render, screen } from '@testing-library/react-native';
import { FadeInUp } from '@/components/FadeInUp';

describe('FadeInUp', () => {
  afterEach(() => jest.restoreAllMocks());

  it('renders its children', async () => {
    await render(
      <FadeInUp>
        <Text>Hello</Text>
      </FadeInUp>,
    );
    expect(screen.getByText('Hello')).toBeTruthy();
  });

  it('eases in on mount', async () => {
    const timing = jest.spyOn(Animated, 'timing');
    await render(
      <FadeInUp>
        <Text>Hello</Text>
      </FadeInUp>,
    );
    expect(timing).toHaveBeenCalled();
  });

  it('does not animate under Reduce Motion', async () => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
    const timing = jest.spyOn(Animated, 'timing');
    await render(
      <FadeInUp>
        <Text>Hello</Text>
      </FadeInUp>,
    );
    // The setting is read asynchronously, so the first frame may start an animation; what
    // matters is that once it lands the animation is instant.
    await act(async () => undefined);
    const lastCall = timing.mock.calls[timing.mock.calls.length - 1];
    expect(lastCall?.[1].duration).toBe(0);
  });
});
