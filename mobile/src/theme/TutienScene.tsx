import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { Backdrop } from './Backdrop';
import { useTheme } from './ThemeProvider';
import { TUTIEN_INK } from './tokens';

/**
 * What every screen of a navigator is laid on: in the cultivation appearance, ink with the scenery under it; in any
 * other, nothing at all (the screen paints its own canvas as it always did). It is the navigator's `screenLayout`, so
 * each screen carries its own solid ground and a push never shows the screen beneath through the one coming in.
 */
export function TutienScene({ children }: { readonly children: ReactNode }) {
  const { scheme } = useTheme();
  if (scheme !== 'tutien') return <>{children}</>;
  return (
    <View style={styles.scene}>
      <Backdrop />
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  scene: { flex: 1, backgroundColor: TUTIEN_INK },
});
