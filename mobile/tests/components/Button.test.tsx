import { render, screen, userEvent } from '@testing-library/react-native';
import { Button } from '@/components/Button';
import { color } from '@/theme/tokens';

/**
 * `docs/design/00-foundations.md` §6, the `Button` rows.
 *
 * The cases worth having here are the two the spec states as prohibitions rather than as
 * appearances: a disabled button must carry a stated reason, and a busy button must not
 * resize. Both are things a reviewer would have to notice by eye otherwise.
 */

function styleOf(testID: string): Record<string, unknown> {
  // `style` arrives as an array once a Pressable merges its own styles; flatten it so a
  // case can ask about one property without caring how many layers produced it.
  const style = screen.getByTestId(testID).props.style as unknown;
  return Object.assign({}, ...(Array.isArray(style) ? style.flat(2) : [style])) as Record<
    string,
    unknown
  >;
}

describe('Button', () => {
  it('calls onPress when tapped', async () => {
    const onPress = jest.fn();
    await render(<Button label="Create account" onPress={onPress} testID="submit" />);

    await userEvent.press(screen.getByTestId('submit'));

    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('exposes the label as its accessible name', async () => {
    await render(<Button label="Create account" onPress={jest.fn()} />);

    expect(screen.getByRole('button', { name: 'Create account' })).toBeTruthy();
  });

  describe('disabled', () => {
    it('renders the blocking reason as helper text', async () => {
      // §6: "A disabled primary button with no stated reason is a spec violation." The
      // component has no `disabled` prop at all - the reason *is* the disabling - so this
      // case is really asserting that the API cannot be misused.
      await render(
        <Button label="Save" onPress={jest.fn()} disabledReason="Make a change to save." />,
      );

      expect(screen.getByText('Make a change to save.')).toBeTruthy();
    });

    it('ignores taps and reports itself disabled', async () => {
      const onPress = jest.fn();
      await render(
        <Button
          label="Save"
          onPress={onPress}
          disabledReason="Make a change to save."
          testID="save"
        />,
      );

      await userEvent.press(screen.getByTestId('save'));

      expect(onPress).not.toHaveBeenCalled();
      expect(screen.getByTestId('save').props.accessibilityState).toMatchObject({
        disabled: true,
      });
    });

    it('takes the sunken fill and the disabled label colour', async () => {
      await render(<Button label="Save" onPress={jest.fn()} disabledReason="Why." testID="save" />);

      expect(styleOf('save').backgroundColor).toBe(color.bg.sunken);
    });

    it('drops the border on a secondary button', async () => {
      // §6 disabled row: "fill bg.sunken, label text.disabled, no border".
      await render(
        <Button
          label="Later"
          variant="secondary"
          onPress={jest.fn()}
          disabledReason="Why."
          testID="later"
        />,
      );

      expect(styleOf('later').borderWidth).toBeUndefined();
    });
  });

  describe('busy', () => {
    it('reads as in progress', async () => {
      await render(<Button label="Log in" onPress={jest.fn()} busy />);

      expect(screen.getByRole('button', { name: 'Log in, in progress' })).toBeTruthy();
    });

    it('ignores taps', async () => {
      const onPress = jest.fn();
      await render(<Button label="Log in" onPress={onPress} busy testID="login" />);

      await userEvent.press(screen.getByTestId('login'));

      expect(onPress).not.toHaveBeenCalled();
    });

    it('keeps the label mounted so the width is held', async () => {
      // The spec says the width is held while the label is replaced by a 20px
      // indicator. Unmounting the label would collapse the button to the indicator's
      // width, so it stays in the tree at zero opacity.
      await render(<Button label="Create account" onPress={jest.fn()} busy />);

      // `includeHiddenElements` because the label is also hidden from the accessibility
      // tree while busy - the Pressable owns the accessible name, and the label is not
      // the current state anyway.
      const label = screen.getByText('Create account', { includeHiddenElements: true });
      const style = Object.assign({}, ...[label.props.style].flat(2)) as {
        opacity?: number;
        fontWeight?: string;
      };

      expect(style.opacity).toBe(0);
      // Still the real label style underneath, so the width it holds is the width it
      // would have had.
      expect(style.fontWeight).toBe('600');
    });

    it('does not take the disabled fill', async () => {
      // A request in flight is not the same thing as an unavailable action, and the grey
      // fill would say it was.
      await render(<Button label="Log in" onPress={jest.fn()} busy testID="login" />);

      expect(styleOf('login').backgroundColor).toBe(color.primary.default);
      expect(screen.getByTestId('login').props.accessibilityState).toMatchObject({
        disabled: false,
        busy: true,
      });
    });
  });

  describe('variants', () => {
    it('fills primary with the primary colour and inverse label', async () => {
      await render(<Button label="Create account" onPress={jest.fn()} testID="cta" />);

      expect(styleOf('cta').backgroundColor).toBe(color.primary.default);
    });

    it('gives secondary a surface fill and an input border', async () => {
      await render(
        <Button
          label="I already have an account"
          variant="secondary"
          onPress={jest.fn()}
          testID="cta"
        />,
      );
      const style = styleOf('cta');

      expect(style.backgroundColor).toBe(color.bg.surface);
      // Specifically `border.input` (3.10:1) rather than a hairline, because a hairline
      // may never be the only thing identifying an interactive control (§1.2).
      expect(style.borderColor).toBe(color.border.input);
    });

    it('sizes heights as floors so they grow with font scale', async () => {
      await render(<Button label="Create account" onPress={jest.fn()} testID="cta" />);
      const style = styleOf('cta');

      expect(style.minHeight).toBe(48);
      expect(style.height).toBeUndefined();
    });

    it('specifies a ghost button at the tap-target floor', async () => {
      await render(
        <Button label="Log in instead" variant="ghost" onPress={jest.fn()} testID="link" />,
      );

      expect(styleOf('link').minHeight).toBe(44);
    });
  });
});
