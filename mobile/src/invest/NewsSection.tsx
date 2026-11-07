import Feather from '@expo/vector-icons/Feather';
import type { MarketBrief } from '@expense-tracker/shared';
import { useEffect, useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import type { ApiClient } from '../api/client';
import { ApiRequestError } from '../api/errors';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { COPY } from '../copy/strings';
import { keyHaptic } from '../lib/haptics';
import { radius, space, type } from '../theme/tokens';
import { createStyles, useColors } from '../theme/ThemeProvider';
import { SymbolAvatar } from './SymbolAvatar';

/**
 * Headlines that name the stocks the person holds or watches, and a short brief written by AI.
 *
 * The headlines load by themselves (they are public feeds, cached by the server). The brief does not: it sends the
 * symbols to an outside AI service, so it waits for a tap and says so under the button, as the monthly recap does. A
 * server with no AI set up hides the button for the session rather than offering something that cannot work.
 */

export const NEWS_TEST_ID = 'invest-news';
export const NEWS_ITEM_PREFIX = 'invest-news-item';
export const BRIEF_BUTTON_TEST_ID = 'invest-brief-button';
export const BRIEF_TEST_ID = 'invest-brief';

const SHOWN = 6;

/** Whether the server has said it has no AI to write a brief with; kept for the session. */
let briefUnavailable = false;

/** Forget it. For tests. */
export function resetBriefStateForTests(): void {
  briefUnavailable = false;
}

type NewsState =
  | { readonly status: 'idle' | 'loading' }
  | { readonly status: 'ready'; readonly items: ReadonlyArray<NewsItem> }
  | { readonly status: 'failed' };

interface NewsItem {
  readonly symbol: string;
  readonly source: string;
  readonly title: string;
  readonly link: string;
}

export function NewsSection({
  api,
  symbols,
  offline,
}: {
  readonly api: Pick<ApiClient, 'getMarketNews' | 'getMarketBrief'>;
  readonly symbols: readonly string[];
  readonly offline: boolean;
}) {
  const styles = useStyles();
  const color = useColors();
  const key = symbols.join(',');
  const [news, setNews] = useState<NewsState>({ status: 'idle' });
  const [brief, setBrief] = useState<MarketBrief | null>(null);
  const [writing, setWriting] = useState(false);
  const [briefFailed, setBriefFailed] = useState(false);
  const [off, setOff] = useState(briefUnavailable);

  useEffect(() => {
    if (key === '' || offline) {
      setNews({ status: 'idle' });
      return;
    }
    let cancelled = false;
    setNews((current) => (current.status === 'ready' ? current : { status: 'loading' }));
    api
      .getMarketNews({ symbols: key })
      .then(({ data }) => {
        if (!cancelled) setNews({ status: 'ready', items: data.items });
      })
      .catch(() => {
        if (!cancelled) setNews({ status: 'failed' });
      });
    return () => {
      cancelled = true;
    };
  }, [api, key, offline]);

  async function write(): Promise<void> {
    if (writing || key === '') return;
    setWriting(true);
    setBriefFailed(false);
    try {
      const { data } = await api.getMarketBrief({ symbols: key });
      setBrief(data);
    } catch (error) {
      if (error instanceof ApiRequestError && error.code === 'market_unavailable') {
        briefUnavailable = true;
        setOff(true);
      }
      setBriefFailed(true);
    } finally {
      setWriting(false);
    }
  }

  if (key === '') return null;

  const items = news.status === 'ready' ? news.items.slice(0, SHOWN) : [];
  const impactText = (impact: string) =>
    impact === 'tich_cuc'
      ? COPY.invest.impactPositive
      : impact === 'tieu_cuc'
        ? COPY.invest.impactNegative
        : COPY.invest.impactNeutral;
  const impactColor = (impact: string) =>
    impact === 'tich_cuc'
      ? color.success.default
      : impact === 'tieu_cuc'
        ? color.danger.default
        : color.text.secondary;

  return (
    <View style={styles.wrap} testID={NEWS_TEST_ID}>
      <View style={styles.titleRow}>
        <Text style={styles.sectionTitle}>{COPY.invest.newsTitle}</Text>
      </View>
      <Card>
        <View style={styles.body}>
          {news.status === 'loading' ? (
            <Text style={styles.caption}>…</Text>
          ) : news.status === 'failed' ? (
            <Text style={styles.caption}>{COPY.invest.newsFailed}</Text>
          ) : news.status === 'ready' && items.length === 0 ? (
            <Text style={styles.caption}>{COPY.invest.newsEmpty}</Text>
          ) : (
            items.map((item, index) => (
              <Pressable
                key={`${item.link}-${item.symbol}`}
                testID={`${NEWS_ITEM_PREFIX}-${index}`}
                onPress={() => {
                  keyHaptic();
                  void Linking.openURL(item.link).catch(() => undefined);
                }}
                accessibilityRole="link"
                accessibilityLabel={`${item.symbol}, ${item.title}, ${item.source}`}
                style={({ pressed }) => [styles.item, pressed ? { opacity: 0.6 } : null]}
              >
                <SymbolAvatar symbol={item.symbol} size={32} />
                <View style={styles.itemText}>
                  <Text style={styles.itemTitle} numberOfLines={3}>
                    {item.title}
                  </Text>
                  <Text style={styles.caption}>{`${item.symbol} · ${item.source}`}</Text>
                </View>
              </Pressable>
            ))
          )}
        </View>
      </Card>

      {off || offline ? null : (
        <Card>
          <View style={styles.body}>
            <View style={styles.titleRow}>
              <Text style={styles.cardTitle}>{COPY.invest.briefTitle}</Text>
              <Feather name="cpu" size={16} color={color.text.tertiary} />
            </View>

            {brief === null ? (
              <>
                <Button
                  testID={BRIEF_BUTTON_TEST_ID}
                  label={COPY.invest.briefButton}
                  variant="secondary"
                  busy={writing}
                  fullWidth
                  onPress={() => void write()}
                />
                <Text style={styles.caption}>{COPY.invest.briefHint}</Text>
              </>
            ) : (
              <View style={styles.brief} testID={BRIEF_TEST_ID}>
                <Text style={styles.label}>{COPY.invest.briefOverview}</Text>
                <Text style={styles.text}>{brief.overview}</Text>
                {brief.worldLink === '' ? null : <Text style={styles.text}>{brief.worldLink}</Text>}

                {brief.topNews.map((item) => (
                  <View key={item.title} style={styles.briefNews}>
                    <Text style={[styles.impact, { color: impactColor(item.impact) }]}>
                      {impactText(item.impact)}
                    </Text>
                    <View style={styles.itemText}>
                      <Text style={styles.itemTitle}>{item.title}</Text>
                      <Text style={styles.caption}>{item.comment}</Text>
                    </View>
                  </View>
                ))}

                {brief.notes.length > 0 ? (
                  <>
                    <Text style={styles.label}>{COPY.invest.briefNotes}</Text>
                    {brief.notes.map((note) => (
                      <Text key={note.symbol} style={styles.text}>
                        {`${note.symbol}: ${note.comment}`}
                      </Text>
                    ))}
                  </>
                ) : null}
                {brief.risks.length > 0 ? (
                  <>
                    <Text style={styles.label}>{COPY.invest.briefRisks}</Text>
                    {brief.risks.map((risk) => (
                      <Text key={risk} style={styles.text}>{`• ${risk}`}</Text>
                    ))}
                  </>
                ) : null}

                <Text style={styles.caption}>{COPY.invest.briefByAi}</Text>
                <Text style={styles.caption}>{brief.disclaimer}</Text>
                <Button
                  label={COPY.invest.briefAgain}
                  variant="ghost"
                  busy={writing}
                  onPress={() => void write()}
                />
              </View>
            )}
            {briefFailed ? <Text style={styles.problem}>{COPY.invest.briefFailed}</Text> : null}
          </View>
        </Card>
      )}
    </View>
  );
}

const useStyles = createStyles((color, { display }) =>
  StyleSheet.create({
    wrap: { gap: space[2] },
    titleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: space[4],
    },
    sectionTitle: { ...type.subhead, ...display('semibold'), color: color.text.secondary },
    cardTitle: { ...type.headline, ...display('semibold'), color: color.text.primary },
    body: { padding: space[4], gap: space[3] },
    item: { flexDirection: 'row', alignItems: 'flex-start', gap: space[3] },
    itemText: { flex: 1, gap: 2 },
    itemTitle: { ...type.body, color: color.text.primary },
    caption: { ...type.footnote, color: color.text.secondary },
    brief: { gap: space[3] },
    briefNews: { flexDirection: 'row', gap: space[3], alignItems: 'flex-start' },
    impact: { ...type.caption, width: 64, paddingTop: 3 },
    label: { ...type.subhead, color: color.text.secondary },
    text: { ...type.body, color: color.text.primary },
    problem: { ...type.footnote, color: color.danger.default, borderRadius: radius.sm },
  }),
);
