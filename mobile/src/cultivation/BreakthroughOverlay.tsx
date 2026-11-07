import { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { COPY } from '../copy/strings';
import { useDatabase } from '../db/DatabaseProvider';
import { useLanguage } from '../i18n/LanguageProvider';
import { savedHaptic } from '../lib/haptics';
import { createStyles, useDisplayFont } from '../theme/ThemeProvider';
import { radius, space, type } from '../theme/tokens';
import { readShownRealm, writeShownRealm } from './readTuVi';
import { realmName } from './tuVi';

export const BREAKTHROUGH_TEST_ID = 'breakthrough';
export const BREAKTHROUGH_CONTINUE_TEST_ID = 'breakthrough-continue';

/**
 * The moment a new realm is reached: a gold ring opens over the screen, a light haptic, the realm's name, one tap to
 * go on. Shown once per realm (the realm last shown is remembered on the device), never the first time the card is
 * seen (a person who already stands in Trúc Cơ is not congratulated for it), and plain, with no motion, when the
 * system is asked to reduce it.
 */
export function BreakthroughOverlay({ realm }: { readonly realm: number }) {
  const database = useDatabase();
  const { language } = useLanguage();
  const styles = useStyles();
  const serif = useDisplayFont('bold');
  const [open, setOpen] = useState(false);

  // The ring opens, then the words fade in. Plain `Animated`: nothing here needs to run off the JS thread.
  const ring = useRef(new Animated.Value(0.2)).current;
  const glow = useRef(new Animated.Value(0)).current;
  const ringStyle = {
    transform: [{ scale: ring }],
    opacity: glow.interpolate({ inputRange: [0, 1], outputRange: [1, 0.65] }),
  };
  const textStyle = { opacity: glow };

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const shown = await readShownRealm(database);
      if (cancelled) return;
      if (shown === null || realm <= shown) {
        // First sight, or nothing new: remember where the person stands, and say nothing.
        if (shown === null || realm < shown) await writeShownRealm(database, realm);
        return;
      }
      await writeShownRealm(database, realm);
      const reduce = await AccessibilityInfo.isReduceMotionEnabled().catch(() => false);
      if (cancelled) return;
      setOpen(true);
      savedHaptic();
      if (reduce) {
        ring.setValue(1);
        glow.setValue(1);
      } else {
        Animated.timing(ring, {
          toValue: 1.25,
          duration: 900,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }).start();
        Animated.timing(glow, {
          toValue: 1,
          duration: 700,
          delay: 350,
          useNativeDriver: true,
        }).start();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [database, realm, ring, glow]);

  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
      <View style={styles.scrim} testID={BREAKTHROUGH_TEST_ID}>
        <Animated.View style={[styles.ring, ringStyle]} accessibilityElementsHidden />
        <Animated.View style={[styles.copy, textStyle]}>
          <Text style={[styles.title, serif]} accessibilityRole="header">
            {COPY.cultivation.breakthroughTitle}
          </Text>
          <Text style={styles.body}>
            {COPY.cultivation.breakthroughBody.replace('{realm}', realmName(realm, language))}
          </Text>
          <Pressable
            testID={BREAKTHROUGH_CONTINUE_TEST_ID}
            onPress={() => setOpen(false)}
            accessibilityRole="button"
            style={styles.button}
          >
            <Text style={[styles.buttonText, serif]}>{COPY.cultivation.continue}</Text>
          </Pressable>
        </Animated.View>
      </View>
    </Modal>
  );
}

const useStyles = createStyles((color) =>
  StyleSheet.create({
    scrim: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'rgba(5,8,7,0.92)',
    },
    ring: {
      position: 'absolute',
      width: 260,
      height: 260,
      borderRadius: 130,
      borderWidth: 3,
      borderColor: color.primary.default,
    },
    copy: { alignItems: 'center', gap: space[3], paddingHorizontal: space[8] },
    title: {
      ...type.title1,
      fontSize: 34,
      lineHeight: 42,
      color: color.primary.default,
      textAlign: 'center',
    },
    body: { ...type.title2, color: color.text.primary, textAlign: 'center' },
    button: {
      marginTop: space[4],
      paddingVertical: space[3],
      paddingHorizontal: space[8],
      borderRadius: radius.sm,
      backgroundColor: color.primary.default,
      borderWidth: 2,
      borderColor: color.text.inverse,
    },
    buttonText: { ...type.headline, color: color.text.inverse },
  }),
);
