import { AccessibilityInfo } from 'react-native';
import { render, screen } from '@testing-library/react-native';
import { BANNER_ICON_TEST_ID, FormBanner } from '@/components/FormBanner';
import { color } from '@/theme/tokens';

/**
 * The form-level banner.
 *
 * Its whole reason to exist is that it appears somewhere the user is not looking: above
 * the form, while their focus is on the Submit button they just pressed. So the cases
 * here are mostly about it announcing itself (`docs/design/03-auth.md` §1.3
 * Accessibility) and about the two tones staying apart - `danger` is something to act on,
 * `info` is a statement of fact that is nobody's fault.
 */

function flatten(style: unknown): Record<string, unknown> {
  return Object.assign({}, ...(Array.isArray(style) ? style.flat(3) : [style])) as Record<
    string,
    unknown
  >;
}

describe('FormBanner', () => {
  beforeEach(() => {
    jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('renders the message', async () => {
    await render(<FormBanner message="That email or password is incorrect." />);

    expect(screen.getByText('That email or password is incorrect.')).toBeTruthy();
  });

  it('announces itself on mount', async () => {
    await render(<FormBanner message="You need to be online to log in." />);

    expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledWith(
      'You need to be online to log in.',
    );
  });

  it('announces again when the message changes', async () => {
    const view = await render(<FormBanner message="First failure." />);
    await view.rerender(<FormBanner message="Second failure." />);

    expect(AccessibilityInfo.announceForAccessibility).toHaveBeenLastCalledWith('Second failure.');
  });

  it('is a polite live region, so Android reads it without stealing focus', async () => {
    await render(
      <FormBanner message="Too many attempts. Try again in a moment." testID="banner" />,
    );

    expect(screen.getByTestId('banner').props.accessibilityLiveRegion).toBe('polite');
  });

  it('reads as one sentence rather than announcing its icon first', async () => {
    await render(<FormBanner message="That email or password is incorrect." testID="banner" />);
    const banner = screen.getByTestId('banner');

    expect(banner.props.accessible).toBe(true);
    expect(banner.props.accessibilityLabel).toBe('That email or password is incorrect.');
  });

  it('defaults to the danger tone, pairing the red with a glyph', async () => {
    await render(
      <FormBanner message="Something went wrong on our end. Try again." testID="banner" />,
    );

    expect(flatten(screen.getByTestId('banner').props.style).backgroundColor).toBe(
      color.danger.subtle,
    );
    // Colour is never the sole carrier of meaning (`00-foundations.md` §8 rule 4).
    expect(screen.getByTestId(BANNER_ICON_TEST_ID)).toBeTruthy();
  });

  it('renders the info tone without the alarm', async () => {
    // The expired-session notice is not the user's fault and not an error they can fix,
    // so it is blue and carries no `alert-circle` (`03-auth.md` §1.1 States).
    await render(
      <FormBanner
        message="Your session expired. Please log in again."
        tone="info"
        testID="banner"
      />,
    );

    expect(flatten(screen.getByTestId('banner').props.style).backgroundColor).toBe(
      color.info.subtle,
    );
    expect(screen.queryByTestId(BANNER_ICON_TEST_ID)).toBeNull();
  });
});
