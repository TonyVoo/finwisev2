import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

/**
 * Stands in for a screen that has a spec but not yet an implementation.
 *
 * Each one names the design doc that will replace it, so the route tree doubles as the
 * remaining work list and nobody has to guess which spec a stub belongs to. These are
 * scaffolding: every usage disappears as its feature task lands.
 *
 * Styling is intentionally minimal and does not touch `docs/design/tokens.json` - a
 * placeholder borrowing real tokens starts to look finished.
 */
export interface ScreenPlaceholderProps {
  readonly title: string;
  /** Path of the design spec this screen is built from. */
  readonly spec: string;
  readonly children?: ReactNode;
}

export function ScreenPlaceholder({ title, spec, children }: ScreenPlaceholderProps) {
  return (
    <View style={styles.container}>
      <Text style={styles.title} accessibilityRole="header">
        {title}
      </Text>
      <Text style={styles.spec}>{spec}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: 24,
  },
  title: {
    fontSize: 20,
    fontWeight: '600',
  },
  spec: {
    fontSize: 13,
    opacity: 0.6,
  },
});
