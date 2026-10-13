import { fireEvent, render, screen, userEvent } from '@testing-library/react-native';
import { PasswordField } from '@/components/PasswordField';
import { TextField } from '@/components/TextField';
import { color } from '@/theme/tokens';

/**
 * `docs/design/00-foundations.md` §6, the `TextField` block, plus the reveal toggle from
 * `03-auth.md` §1.2 element 8.
 *
 * The cases that matter are the ones about *not shifting and not stacking*: the focus
 * ring is drawn over the resting border rather than thickening it, and an error replaces
 * the helper text rather than appearing below it. Both exist so the submit button does
 * not move under the user's thumb while they are fixing a field.
 */

function flatten(style: unknown): Record<string, unknown> {
  return Object.assign({}, ...(Array.isArray(style) ? style.flat(3) : [style])) as Record<
    string,
    unknown
  >;
}

describe('TextField', () => {
  it('renders the label and the value', async () => {
    await render(
      <TextField label="Email" value="ada@example.com" onChangeText={jest.fn()} testID="email" />,
    );

    expect(screen.getByText('Email')).toBeTruthy();
    expect(screen.getByTestId('email').props.value).toBe('ada@example.com');
  });

  it('reports typing', async () => {
    const onChangeText = jest.fn();
    await render(<TextField label="Email" value="" onChangeText={onChangeText} testID="email" />);

    await userEvent.type(screen.getByTestId('email'), 'a');

    expect(onChangeText).toHaveBeenCalledWith('a');
  });

  it('reports blur, which is when validation runs', async () => {
    const onBlur = jest.fn();
    await render(
      <TextField label="Email" value="" onChangeText={jest.fn()} onBlur={onBlur} testID="email" />,
    );

    const input = screen.getByTestId('email');
    await userEvent.type(input, 'x');

    expect(onBlur).toHaveBeenCalled();
  });

  it('names itself by its label, and offers the helper as a hint', async () => {
    await render(
      <TextField
        label="Password"
        value=""
        onChangeText={jest.fn()}
        helper="At least 8 characters"
        testID="password"
      />,
    );

    const input = screen.getByTestId('password');
    expect(input.props.accessibilityLabel).toBe('Password');
    expect(input.props.accessibilityHint).toBe('At least 8 characters');
  });

  describe('error state', () => {
    it('replaces the helper text rather than stacking under it', async () => {
      await render(
        <TextField
          label="Password"
          value=""
          onChangeText={jest.fn()}
          helper="At least 8 characters"
          error="Use at least 8 characters."
          testID="password"
        />,
      );

      expect(screen.getByText('Use at least 8 characters.')).toBeTruthy();
      // The two never stack (§6), so the field does not grow by a line when it goes
      // invalid and push the submit button down.
      expect(screen.queryByText('At least 8 characters')).toBeNull();
    });

    it('puts the error into the accessible name', async () => {
      // §6: a screen reader user who lands on the input hears why it is wrong, rather
      // than having to go hunting for the helper slot below it.
      await render(
        <TextField
          label="Email"
          value="nope"
          onChangeText={jest.fn()}
          error="Enter a valid email address."
          testID="email"
        />,
      );

      expect(screen.getByTestId('email').props.accessibilityLabel).toBe(
        'Email, invalid: Enter a valid email address.',
      );
    });

    it('takes the danger border', async () => {
      await render(
        <TextField label="Email" value="" onChangeText={jest.fn()} error="Bad." testID="email" />,
      );

      const field = screen.getByTestId('email').parent;
      expect(flatten(field?.props.style).borderColor).toBe(color.danger.default);
    });

    it('renders the error in the danger ink', async () => {
      await render(
        <TextField label="Email" value="" onChangeText={jest.fn()} error="Bad." testID="email" />,
      );

      expect(flatten(screen.getByText('Bad.').props.style).color).toBe(color.danger.default);
    });

    it('renders nothing in the slot when there is neither helper nor error', async () => {
      // Signup's Email helper is "empty by default" (§1.2 element 5), and an empty Text
      // still occupies a line.
      await render(<TextField label="Email" value="" onChangeText={jest.fn()} testID="email" />);

      expect(screen.getByTestId('email').props.accessibilityHint).toBeUndefined();
    });
  });

  describe('focus ring', () => {
    it('is absent at rest, with a 1px resting border', async () => {
      await render(<TextField label="Email" value="" onChangeText={jest.fn()} testID="email" />);

      const field = flatten(screen.getByTestId('email').parent?.props.style);
      expect(field.borderWidth).toBe(1);
      expect(field.borderColor).toBe(color.border.input);
      expect(screen.queryByTestId('email-focus-ring')).toBeNull();
    });

    it('is drawn as an overlay on focus, so the field does not shift', async () => {
      await render(<TextField label="Email" value="" onChangeText={jest.fn()} testID="email" />);
      const input = screen.getByTestId('email');

      // `fireEvent` rather than `userEvent.type`: typing focuses and then blurs again,
      // and the state under test here is "focused", not "was focused once".
      await fireEvent(input, 'focus');

      const ring = flatten(screen.getByTestId('email-focus-ring').props.style);
      expect(ring.borderWidth).toBe(2);
      expect(ring.borderColor).toBe(color.border.focus);
      // And the resting border is untouched - a 1 to 2 `borderWidth` swap on the field
      // itself would move the text by a pixel and reflow everything below it on every
      // tap.
      expect(flatten(input.parent?.props.style).borderWidth).toBe(1);
    });
  });
});

describe('PasswordField', () => {
  it('starts masked', async () => {
    await render(
      <PasswordField label="Password" value="hunter2" onChangeText={jest.fn()} testID="pw" />,
    );

    expect(screen.getByTestId('pw').props.secureTextEntry).toBe(true);
  });

  it('offers to show the password, then to hide it', async () => {
    await render(
      <PasswordField label="Password" value="hunter2" onChangeText={jest.fn()} testID="pw" />,
    );

    // The label states the *action*, not the state, so a screen reader announces what
    // the next tap will do.
    const toggle = screen.getByRole('button', { name: 'Show password' });
    await userEvent.press(toggle);

    expect(screen.getByTestId('pw').props.secureTextEntry).toBe(false);
    expect(screen.getByRole('button', { name: 'Hide password' })).toBeTruthy();
  });

  it('re-masks when toggled back', async () => {
    await render(
      <PasswordField label="Password" value="hunter2" onChangeText={jest.fn()} testID="pw" />,
    );

    await userEvent.press(screen.getByRole('button', { name: 'Show password' }));
    await userEvent.press(screen.getByRole('button', { name: 'Hide password' }));

    expect(screen.getByTestId('pw').props.secureTextEntry).toBe(true);
  });

  it('grows the 20px glyph to the 44pt tap-target floor', async () => {
    await render(<PasswordField label="Password" value="" onChangeText={jest.fn()} testID="pw" />);

    // `hitSlop` rather than padding, so the floor is met without the field growing
    // (`00-foundations.md` §8 rule 1).
    expect(screen.getByRole('button', { name: 'Show password' }).props.hitSlop).toEqual({
      top: 12,
      bottom: 12,
      left: 12,
      right: 12,
    });
  });
});
