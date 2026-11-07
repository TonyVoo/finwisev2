import { StyleSheet, Text, View } from 'react-native';
import { categoryColor, categoryColorDark } from '../theme/tokens';
import { createStyles, useTheme } from '../theme/ThemeProvider';

/**
 * A round badge for a ticker: its first letters on a tint of a hue chosen from the symbol itself, so the same
 * stock is the same colour everywhere and two stocks side by side are told apart at a glance.
 */

const HUES = [
  'green',
  'orange',
  'blue',
  'indigo',
  'teal',
  'red',
  'pink',
  'purple',
  'ochre',
] as const;

/** Stable hue for a symbol: a small string hash, not random. */
export function hueFor(symbol: string): (typeof HUES)[number] {
  let hash = 0;
  for (const ch of symbol) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return HUES[hash % HUES.length] ?? 'blue';
}

export function SymbolAvatar({
  symbol,
  size = 40,
}: {
  readonly symbol: string;
  readonly size?: number;
}) {
  const styles = useStyles();
  const { isDark } = useTheme();
  const hue = hueFor(symbol);
  const base = (isDark ? categoryColorDark : categoryColor)[hue];
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        styles.badge,
        { width: size, height: size, borderRadius: size / 2, backgroundColor: `${base}26` },
      ]}
    >
      <Text style={[styles.text, { color: base, fontSize: size * 0.34 }]} numberOfLines={1}>
        {symbol.slice(0, 3)}
      </Text>
    </View>
  );
}

const useStyles = createStyles(() =>
  StyleSheet.create({
    badge: { alignItems: 'center', justifyContent: 'center' },
    text: { fontWeight: '700', letterSpacing: 0.2 },
  }),
);
