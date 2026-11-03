import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { SectionTitle } from '@/components/Card';
import { AppBar, IconButton } from '@/components/Chrome';
import { Button } from '@/components/Button';
import { useSnackbar } from '@/components/Snackbar';
import { COPY } from '@/copy/strings';
import { useUserCurrency } from '@/db/hooks';
import { monthKeyOf, monthName } from '@/lib/calendar';
import { formatMoney } from '@/lib/money';
import { useSelectedMonth } from '@/month/MonthProvider';
import { elevation, radius, space, type } from '@/theme/tokens';
import { createStyles, useColors } from '@/theme/ThemeProvider';
import { useYearReport } from '@/year/useYearReport';
import { yearReportHtml } from '@/year/yearReportHtml';

/**
 * Year in review (`docs/design/24-year-report.md`), opened from the Summary tab: twelve months at a glance, where the
 * year went, and how it compares with the one before. All from local data; the PDF is made on the phone and handed
 * to the system share sheet.
 */

export const YEAR_TEST_ID = 'year-report';
export const YEAR_PREVIOUS_TEST_ID = 'year-previous';
export const YEAR_NEXT_TEST_ID = 'year-next';
export const YEAR_SHARE_TEST_ID = 'year-share';
export const YEAR_MONTH_TEST_ID_PREFIX = 'year-month';

export default function YearReportScreen() {
  const color = useColors();
  const styles = useStyles();
  const router = useRouter();
  const showSnackbar = useSnackbar();
  const { today } = useSelectedMonth();
  const currentYear = Number(today.slice(0, 4));
  const [year, setYear] = useState(currentYear);
  const currency = useUserCurrency().data ?? null;
  const report = useYearReport(year, monthKeyOf(today)).data;
  const [sharing, setSharing] = useState(false);

  const money = (minor: number) => (currency === null ? '' : formatMoney(minor, currency));
  const copy = COPY.yearReport;

  async function share(): Promise<void> {
    if (report === undefined || currency === null || sharing) return;
    setSharing(true);
    try {
      if (!(await Sharing.isAvailableAsync())) {
        showSnackbar({ message: copy.shareUnavailable });
        return;
      }
      const file = await Print.printToFileAsync({ html: yearReportHtml(report, currency) });
      await Sharing.shareAsync(file.uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf' });
    } catch {
      showSnackbar({ message: copy.shareFailed });
    } finally {
      setSharing(false);
    }
  }

  const peak = report?.peak;
  const biggest = Math.max(1, ...(report?.months.map((m) => m.totalMinor) ?? [0]));
  const sentence = (template: string, name: string, amount: number) =>
    template
      .replace('{name}', name)
      .replace('{amount}', money(Math.abs(amount)))
      .replace('{year}', String(year - 1));

  return (
    <View style={styles.screen} testID={YEAR_TEST_ID}>
      <AppBar
        title={copy.title}
        leading={
          <IconButton
            icon="chevron-left"
            label={COPY.common.back}
            onPress={() => router.back()}
            tint={color.text.primary}
            testID="year-back"
          />
        }
      />
      <View style={styles.switcher}>
        <IconButton
          icon="chevron-left"
          label={copy.previousYear}
          onPress={() => setYear(year - 1)}
          tint={color.text.primary}
          testID={YEAR_PREVIOUS_TEST_ID}
        />
        <Text style={styles.year} accessibilityRole="header">
          {year}
        </Text>
        <IconButton
          icon="chevron-right"
          label={copy.nextYear}
          onPress={() => setYear(Math.min(currentYear, year + 1))}
          tint={year >= currentYear ? color.text.disabled : color.text.primary}
          testID={YEAR_NEXT_TEST_ID}
        />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {report === undefined || report.isEmpty ? (
          report === undefined ? null : (
            <Text style={styles.empty} testID="year-empty">
              {copy.empty.replace('{year}', String(year))}
            </Text>
          )
        ) : (
          <>
            <View style={styles.hero}>
              <View style={styles.facts}>
                <Fact label={copy.spent} value={money(report.totalMinor)} />
                <Fact label={copy.average} value={money(report.averageMinor)} />
                {/* Income is optional: with none recorded, "left over" would only repeat the spending, negated. */}
                {report.incomeMinor > 0 ? (
                  <>
                    <Fact label={copy.income} value={money(report.incomeMinor)} />
                    <Fact label={copy.saved} value={money(report.savedMinor)} />
                  </>
                ) : null}
              </View>

              {report.previousTotalMinor > 0 ? (
                <Text style={styles.note}>
                  {`${report.deltaMinor >= 0 ? '+' : '-'}${money(Math.abs(report.deltaMinor))} ${copy.vsLast.replace('{year}', String(year - 1))}`}
                </Text>
              ) : null}
              {report.biggestRise === null ? null : (
                <Text style={styles.note}>
                  {sentence(copy.rise, report.biggestRise.name, report.biggestRise.deltaMinor)}
                </Text>
              )}
              {report.biggestFall === null ? null : (
                <Text style={styles.note}>
                  {sentence(copy.fall, report.biggestFall.name, report.biggestFall.deltaMinor)}
                </Text>
              )}
              {peak === null || peak === undefined ? null : (
                <Text style={styles.note}>
                  {`${copy.peak}: ${monthName(peak.month)} · ${money(peak.totalMinor)}`}
                </Text>
              )}
              {report.lowest === null ? null : (
                <Text style={styles.note}>
                  {`${copy.lowest}: ${monthName(report.lowest.month)} · ${money(report.lowest.totalMinor)}`}
                </Text>
              )}
            </View>

            <SectionTitle>{copy.months}</SectionTitle>
            <View style={styles.panel}>
              {report.months.map((m) => (
                <View
                  key={m.month}
                  style={styles.monthRow}
                  testID={`${YEAR_MONTH_TEST_ID_PREFIX}-${m.month}`}
                  accessible
                  accessibilityLabel={`${monthName(m.month)}, ${money(m.totalMinor)}`}
                >
                  <Text style={styles.monthName}>{monthName(m.month).slice(0, 3)}</Text>
                  <View style={styles.track}>
                    <View
                      style={[
                        styles.fill,
                        { width: `${Math.round((m.totalMinor / biggest) * 100)}%` },
                      ]}
                    />
                  </View>
                  <Text style={[styles.monthAmount, m.totalMinor === 0 ? styles.zero : null]}>
                    {money(m.totalMinor)}
                  </Text>
                </View>
              ))}
            </View>

            <SectionTitle>{copy.categories}</SectionTitle>
            <View style={styles.panel}>
              {report.categories.map((c) => (
                <View key={c.id ?? c.name} style={styles.catBlock}>
                  <View style={styles.monthRow}>
                    <View style={[styles.dot, { backgroundColor: c.color }]} />
                    <Text style={styles.catName} numberOfLines={1}>
                      {c.name}
                    </Text>
                    <Text style={styles.monthAmount}>
                      {money(c.totalMinor)} · {Math.round(c.share * 100)}%
                    </Text>
                  </View>
                  <View style={styles.track}>
                    <View
                      style={[
                        styles.fill,
                        { width: `${Math.round(c.share * 100)}%`, backgroundColor: c.color },
                      ]}
                    />
                  </View>
                </View>
              ))}
            </View>

            <View style={styles.shareWrap}>
              <Button
                label={copy.share}
                onPress={() => void share()}
                busy={sharing}
                fullWidth
                testID={YEAR_SHARE_TEST_ID}
              />
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}

function Fact({ label, value }: { readonly label: string; readonly value: string }) {
  const styles = useStyles();
  return (
    <View style={styles.fact} accessible accessibilityLabel={`${label}, ${value}`}>
      <Text style={styles.factLabel}>{label}</Text>
      <Text style={styles.factValue}>{value}</Text>
    </View>
  );
}

const useStyles = createStyles((color) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: color.bg.canvas },
    switcher: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: space[3],
    },
    year: { ...type.title1, color: color.text.primary },
    content: { paddingBottom: space[8] },
    empty: { ...type.body, color: color.text.secondary, textAlign: 'center', padding: space[6] },
    hero: {
      marginHorizontal: space[4],
      marginTop: space[2],
      padding: space[4],
      gap: space[2],
      borderRadius: radius.lg + 4,
      backgroundColor: color.bg.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: color.border.hairline,
      ...elevation[1],
    },
    facts: { flexDirection: 'row', flexWrap: 'wrap', gap: space[3] },
    fact: { minWidth: '45%', flexGrow: 1 },
    factLabel: { ...type.footnote, color: color.text.secondary },
    factValue: { ...type.title1, color: color.text.primary },
    panel: {
      marginHorizontal: space[4],
      paddingVertical: space[2],
      paddingHorizontal: space[4],
      borderRadius: radius.lg,
      backgroundColor: color.bg.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: color.border.hairline,
    },
    catBlock: { gap: space[1], paddingVertical: space[2] },
    shareWrap: { padding: space[4], paddingTop: space[6] },
    zero: { color: color.text.tertiary },
    note: { ...type.callout, color: color.text.secondary },
    monthRow: { flexDirection: 'row', alignItems: 'center', gap: space[2], minHeight: 28 },
    monthName: { ...type.footnote, color: color.text.secondary, width: 36 },
    track: { flex: 1, height: 8, borderRadius: radius.pill, backgroundColor: color.bg.sunken },
    fill: { height: 8, borderRadius: radius.pill, backgroundColor: color.primary.default },
    monthAmount: { ...type.footnote, color: color.text.primary, minWidth: 84, textAlign: 'right' },
    dot: { width: 10, height: 10, borderRadius: 5 },
    catName: { ...type.body, color: color.text.primary, flex: 1 },
  }),
);
