import Feather from '@expo/vector-icons/Feather';
import { useEffect, useRef } from 'react';
import { Animated, Easing, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Button } from '../components/Button';
import { COPY } from '../copy/strings';
import { useReduceMotion } from '../lib/useReduceMotion';
import { HIT_SLOP_44, radius, space, type } from '../theme/tokens';
import { createStyles, useColors } from '../theme/ThemeProvider';

export const RECEIPT_ROW_TEST_ID = 'expense-receipt-row';
export const RECEIPT_SCAN_TEST_ID = 'receipt-scan';
export const RECEIPT_CARD_TAKE_TEST_ID = 'receipt-card-take';
export const RECEIPT_CARD_CHOOSE_TEST_ID = 'receipt-card-choose';
export const RECEIPT_CARD_RETAKE_TEST_ID = 'receipt-card-retake';
export const RECEIPT_CARD_THUMB_TEST_ID = 'receipt-card-thumb';
export const RECEIPT_SCANNING_TEST_ID = 'receipt-scanning';

export interface ReceiptCardProps {
  /** The form's choice is "this expense has a receipt" (the bytes may still be on another device). */
  readonly present: boolean;
  /** The image the form would save, base64, or null. */
  readonly dataBase64: string | null;
  /** Whether to offer reading the photo: false when the server has said it cannot. */
  readonly canScan: boolean;
  /** True while a reading is in flight. */
  readonly scanning: boolean;
  /** Opens the receipt sheet: the photo full size, to replace or remove it. */
  readonly onOpen: () => void;
  readonly onTake: () => void;
  readonly onChoose: () => void;
  readonly onScan: () => void;
}

/**
 * The Receipt card on the expense form (`docs/design/11-receipt-scan.md`).
 *
 * With no photo it is an invitation - two big tiles, **Take photo** and **Choose photo**, each one tap to the
 * camera or the library, with no sheet in between (the way expense and receipt apps put the camera first).
 * With a photo it is a thumbnail, **Read receipt** as the one prominent action, and **Retake**; while a
 * reading is in flight a line sweeps down the photo, so waiting looks like work. The header always opens the
 * receipt sheet for the full photo, replacing and removing.
 *
 * The photo leaves the phone only when Read receipt is tapped, and the sentence saying so sits under that
 * button; the card never sends anything by itself.
 */
export function ReceiptCard(props: ReceiptCardProps) {
  const { present, dataBase64, canScan, scanning } = props;
  const styles = useStyles();
  const color = useColors();
  const status = present ? COPY.form.field.receiptAttached : COPY.form.field.receiptAdd;

  return (
    <View style={styles.card}>
      <Pressable
        testID={RECEIPT_ROW_TEST_ID}
        onPress={props.onOpen}
        accessibilityRole="button"
        accessibilityLabel={`${COPY.form.field.receipt}, ${status}`}
        style={styles.header}
      >
        {dataBase64 === null ? (
          <View style={styles.iconTile}>
            <Feather name="camera" size={20} color={color.primary.default} />
          </View>
        ) : (
          <View style={styles.thumbWrap}>
            <Image
              testID={RECEIPT_CARD_THUMB_TEST_ID}
              source={{ uri: `data:image/jpeg;base64,${dataBase64}` }}
              style={styles.thumb}
              resizeMode="cover"
              accessibilityLabel={COPY.form.receipt.imageLabel}
            />
            {scanning ? <ScanSweep /> : null}
          </View>
        )}
        <View style={styles.headerText}>
          <Text style={styles.title}>{COPY.form.field.receipt}</Text>
          <Text style={styles.subtitle} numberOfLines={2}>
            {present ? status : COPY.form.receipt.pitch}
          </Text>
        </View>
        <Feather name="chevron-right" size={20} color={color.text.tertiary} />
      </Pressable>

      {present ? (
        <>
          {dataBase64 !== null && canScan ? (
            <>
              <Button
                label={scanning ? COPY.form.receipt.scan.reading : COPY.form.receipt.scan.action}
                onPress={props.onScan}
                busy={scanning}
                fullWidth
                testID={RECEIPT_SCAN_TEST_ID}
              />
              {/* The photo leaves the phone for this, so the card says so right under the button. */}
              <Text style={styles.hint}>{COPY.form.receipt.scan.hint}</Text>
            </>
          ) : null}
          <Pressable
            testID={RECEIPT_CARD_RETAKE_TEST_ID}
            onPress={props.onTake}
            accessibilityRole="button"
            accessibilityLabel={COPY.form.receipt.retake}
            hitSlop={HIT_SLOP_44}
            style={styles.retake}
          >
            <Feather name="rotate-ccw" size={16} color={color.primary.default} />
            <Text style={styles.retakeText}>{COPY.form.receipt.retake}</Text>
          </Pressable>
        </>
      ) : (
        <View style={styles.tiles}>
          <Tile
            testID={RECEIPT_CARD_TAKE_TEST_ID}
            icon="camera"
            label={COPY.form.receipt.take}
            onPress={props.onTake}
          />
          <Tile
            testID={RECEIPT_CARD_CHOOSE_TEST_ID}
            icon="image"
            label={COPY.form.receipt.chooseTile}
            onPress={props.onChoose}
          />
        </View>
      )}
    </View>
  );
}

function Tile({
  testID,
  icon,
  label,
  onPress,
}: {
  readonly testID: string;
  readonly icon: keyof typeof Feather.glyphMap;
  readonly label: string;
  readonly onPress: () => void;
}) {
  const styles = useStyles();
  const color = useColors();
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.tile, pressed ? styles.tilePressed : null]}
    >
      <Feather name={icon} size={24} color={color.primary.default} />
      <Text style={styles.tileLabel}>{label}</Text>
    </Pressable>
  );
}

/** A teal line sweeping down the thumbnail while the receipt is read. Still under Reduce Motion. */
function ScanSweep() {
  const styles = useStyles();
  const reduceMotion = useReduceMotion();
  const position = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (reduceMotion) return undefined;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(position, {
          toValue: 1,
          duration: 1100,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(position, {
          toValue: 0,
          duration: 1100,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [position, reduceMotion]);

  const translateY = position.interpolate({ inputRange: [0, 1], outputRange: [0, THUMB_HEIGHT] });

  return (
    <View testID={RECEIPT_SCANNING_TEST_ID} style={overlayStyles.overlay} pointerEvents="none">
      <Animated.View
        style={[styles.sweep, reduceMotion ? styles.sweepStill : { transform: [{ translateY }] }]}
      />
    </View>
  );
}

const THUMB_WIDTH = 56;
const THUMB_HEIGHT = 72;

const overlayStyles = StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFill, overflow: 'hidden', borderRadius: radius.sm },
});

const useStyles = createStyles((color) =>
  StyleSheet.create({
    card: {
      marginHorizontal: space[4],
      marginTop: space[3],
      marginBottom: space[2],
      padding: space[3],
      gap: space[3],
      borderRadius: radius.lg,
      backgroundColor: color.bg.surface,
      borderWidth: 1,
      borderColor: color.border.hairline,
    },
    header: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
    iconTile: {
      width: THUMB_WIDTH,
      height: THUMB_WIDTH,
      borderRadius: radius.md,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: color.primary.subtle,
    },
    thumbWrap: { width: THUMB_WIDTH, height: THUMB_HEIGHT },
    thumb: {
      width: THUMB_WIDTH,
      height: THUMB_HEIGHT,
      borderRadius: radius.sm,
      backgroundColor: color.bg.sunken,
    },
    headerText: { flex: 1, gap: 2 },
    title: { ...type.bodyStrong, color: color.text.primary },
    subtitle: { ...type.footnote, color: color.text.secondary },
    tiles: { flexDirection: 'row', gap: space[3] },
    tile: {
      flex: 1,
      minHeight: 88,
      alignItems: 'center',
      justifyContent: 'center',
      gap: space[2],
      borderRadius: radius.md,
      borderWidth: 1.5,
      borderStyle: 'dashed',
      borderColor: color.primary.default,
      backgroundColor: color.primary.subtle,
    },
    tilePressed: { opacity: 0.7 },
    tileLabel: { ...type.subhead, color: color.primary.default },
    hint: { ...type.footnote, color: color.text.secondary, textAlign: 'center' },
    retake: {
      flexDirection: 'row',
      alignSelf: 'center',
      alignItems: 'center',
      gap: space[1],
      minHeight: 32,
    },
    retakeText: { ...type.subhead, color: color.primary.default },
    sweep: {
      height: 3,
      backgroundColor: color.primary.default,
      opacity: 0.85,
    },
    sweepStill: { marginTop: THUMB_HEIGHT / 2 },
  }),
);
