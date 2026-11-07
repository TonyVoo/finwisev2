import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { type LayoutChangeEvent, StyleSheet, Text, View } from 'react-native';
import { COPY } from '../copy/strings';
import { useDatabase } from '../db/DatabaseProvider';
import { useLanguage } from '../i18n/LanguageProvider';
import { useSelectedMonth } from '../month/MonthProvider';
import { createStyles, useColors, useDisplayFont, useTheme } from '../theme/ThemeProvider';
import { PanelCorners } from '../components/PanelCorners';
import { radius, space, type } from '../theme/tokens';
import { BreakthroughOverlay } from './BreakthroughOverlay';
import { readCultivation } from './readTuVi';
import { STAGES, realmName, stageName } from './tuVi';

const SEGMENTS = 28;
const JADE = [0x59, 0xc3, 0xa0] as const;
const GOLD = [0xd8, 0xb2, 0x5e] as const;

/** A colour part-way from `from` to `to`, as a hex string. */
function mix(from: readonly number[], to: readonly number[], t: number): string {
  const channel = (i: number) =>
    Math.round((from[i] as number) + ((to[i] as number) - (from[i] as number)) * t);
  return `#${[0, 1, 2].map((i) => channel(i).toString(16).padStart(2, '0')).join('')}`;
}

export const CULTIVATION_TEST_ID = 'cultivation-card';
export const CULTIVATION_GAUGE_TEST_ID = 'cultivation-gauge';
export const CULTIVATION_STREAK_TEST_ID = 'cultivation-streak';

/**
 * Home's cultivation card, shown only in the cultivation appearance: the realm and stage reached, a qi gauge to the next
 * stage, and the unbroken run of days with an entry. All of it is worked out on the device from what is recorded
 * (`cultivation/tuVi.ts`); the first time a new realm is reached, a breakthrough is shown once.
 */
export function CultivationCard() {
  const { scheme } = useTheme();
  if (scheme !== 'tutien') return null;
  return <Card />;
}

function Card() {
  const color = useColors();
  const styles = useStyles();
  const serif = useDisplayFont('bold');
  const database = useDatabase();
  const { language } = useLanguage();
  const { today } = useSelectedMonth();
  const [width, setWidth] = useState(0);

  const query = useQuery({
    queryKey: ['local', 'cultivation', today] as const,
    queryFn: () => readCultivation(database, today),
  });
  const tuVi = query.data;
  if (tuVi === undefined) return null;

  const ascended = tuVi.toNext === null;
  const name = realmName(tuVi.realm, language);
  const nextName = ascended
    ? ''
    : tuVi.nextIsRealm
      ? realmName(tuVi.realm + 1, language)
      : `${realmName(tuVi.realm, language)} · ${stageName(tuVi.stage + 1, language)}`;

  const fill = Math.max(0, Math.min(1, tuVi.progress)) * width;
  const onLayout = (event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width);

  return (
    <View testID={CULTIVATION_TEST_ID} style={styles.panel}>
      <View style={styles.top}>
        <Text style={styles.caption}>{COPY.cultivation.caption}</Text>
        <Text style={styles.caption}>
          {COPY.cultivation.points.replace('{points}', String(tuVi.points))}
        </Text>
      </View>

      <Text style={[styles.realm, serif]} accessibilityRole="header">
        {ascended ? name : `${name} · ${stageName(tuVi.stage, language)}`}
      </Text>

      {/* The qi gauge: jade into gold, drawn with a gradient so it reads as light rather than a filled bar. */}
      <View
        testID={CULTIVATION_GAUGE_TEST_ID}
        style={styles.gauge}
        onLayout={onLayout}
        accessible
        accessibilityRole="progressbar"
        accessibilityLabel={COPY.cultivation.gauge}
        accessibilityValue={{ min: 0, max: 100, now: Math.round(tuVi.progress * 100) }}
      >
        <View style={[styles.track, { backgroundColor: color.bg.sunken }]} />
        {fill > 0 ? (
          <View style={[styles.fill, { width: Math.max(10, fill) }]}>
            {/* Jade into gold: a run of thin segments, each a step along the way, so it reads as light and
                needs no gradient library (and renders in a test). */}
            {Array.from({ length: SEGMENTS }, (_, i) => (
              <View
                key={i}
                style={{
                  width: width / SEGMENTS + 1,
                  backgroundColor: mix(JADE, GOLD, i / (SEGMENTS - 1)),
                }}
              />
            ))}
          </View>
        ) : null}
      </View>

      {/* One pip per stage of the realm: lit for each stage reached. */}
      {ascended ? null : (
        <View
          style={styles.pips}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          {Array.from({ length: STAGES }, (_, i) => (
            <View key={i} style={[styles.pip, i <= tuVi.stage ? styles.pipOn : null]} />
          ))}
        </View>
      )}

      <Text testID={CULTIVATION_STREAK_TEST_ID} style={styles.line}>
        {tuVi.streak > 0
          ? COPY.cultivation.streak.replace('{days}', String(tuVi.streak))
          : COPY.cultivation.streakNone}
      </Text>
      <Text style={styles.line}>
        {ascended
          ? COPY.cultivation.ascended
          : (tuVi.nextIsRealm ? COPY.cultivation.toRealm : COPY.cultivation.toNext)
              .replace('{count}', String(tuVi.toNext))
              .replace('{name}', nextName)}
      </Text>

      <PanelCorners />
      <BreakthroughOverlay realm={tuVi.realm} />
    </View>
  );
}

const useStyles = createStyles((color) =>
  StyleSheet.create({
    panel: {
      marginHorizontal: space[4],
      marginTop: space[3],
      padding: space[4],
      gap: space[2],
      borderRadius: radius.md,
      backgroundColor: color.bg.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: color.border.strong,
    },
    top: { flexDirection: 'row', justifyContent: 'space-between' },
    caption: { ...type.caption, color: color.text.tertiary, letterSpacing: 1 },
    realm: { ...type.title2, color: color.primary.default },
    gauge: { height: 10, borderRadius: 5, overflow: 'hidden' },
    track: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: 5 },
    fill: { height: 10, borderRadius: 5, overflow: 'hidden', flexDirection: 'row' },
    pips: { flexDirection: 'row', gap: space[1] },
    pip: { width: 18, height: 3, borderRadius: 2, backgroundColor: color.border.hairline },
    pipOn: { backgroundColor: color.primary.default },
    line: { ...type.footnote, color: color.text.secondary },
  }),
);
