import { render, screen } from '@testing-library/react-native';
import { AppMark } from '@/components/AppMark';
import { ThemeProvider } from '@/theme/ThemeProvider';

/**
 * The app's own mark (the receipt with a check, as in the icon and splash), drawn from the same PNGs so
 * the welcome screen, the splash and the home-screen icon are one picture.
 */

function sourceOf(): unknown {
  return screen.getByTestId('app-mark', { includeHiddenElements: true }).props.source;
}

describe('AppMark', () => {
  it('is decoration: hidden from screen readers, since the app name beside it says the same', async () => {
    await render(<AppMark height={64} />);

    const mark = screen.getByTestId('app-mark', { includeHiddenElements: true });
    expect(mark.props.accessibilityElementsHidden).toBe(true);
    expect(mark.props.importantForAccessibility).toBe('no-hide-descendants');
  });

  it('keeps the picture its shape: 840 wide to 1080 tall', async () => {
    await render(<AppMark height={108} />);

    const style = screen.getByTestId('app-mark', { includeHiddenElements: true }).props.style;
    const flat = Object.assign({}, ...[style].flat(3));
    expect(flat.height).toBe(108);
    expect(flat.width).toBe(84);
  });

  it('uses the brighter dark-theme teal on a dark theme, and the app teal on a light one', async () => {
    await render(
      <ThemeProvider initialPreference="light">
        <AppMark height={64} />
      </ThemeProvider>,
    );
    const light = sourceOf();
    await screen.unmount();

    await render(
      <ThemeProvider initialPreference="dark">
        <AppMark height={64} />
      </ThemeProvider>,
    );
    const dark = sourceOf();

    expect(light).toBeDefined();
    expect(dark).toBeDefined();
    expect(dark).not.toEqual(light);
  });
});
