import { Image } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import darkMark from '../../assets/splash-icon-dark.png';
import lightMark from '../../assets/splash-icon.png';

/**
 * The app's own mark: the receipt with a check, the same drawing as the icon and the splash
 * (`pnpm make:icons`, `assets/source/`). It is the logo, not an icon from the icon set, so it
 * is an image rather than a `Feather` glyph.
 *
 * The dark theme gets the brighter teal (`color.primary.default` in the dark palette), as the
 * dark splash does. Decorative: the app's name beside it says the same, so a screen reader skips it.
 */

/** The pictures are 840 x 1080. */
const ASPECT = 840 / 1080;

export function AppMark({ height }: { readonly height: number }) {
  const { isDark } = useTheme();
  return (
    <Image
      testID="app-mark"
      source={isDark ? darkMark : lightMark}
      style={{ height, width: height * ASPECT }}
      resizeMode="contain"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    />
  );
}
