import Feather from '@expo/vector-icons/Feather';
import {
  ASSISTANT_ANSWER_ECHO_MAX,
  ASSISTANT_HISTORY_MAX,
  ASSISTANT_QUESTION_MAX,
} from '@expense-tracker/shared';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { ApiRequestError } from '@/api/errors';
import { useExpenseSearch, useExpenseSearchSummary, useUserCurrency } from '@/db/hooks';
import { formatMoney } from '@/lib/money';
import { useFallbackCategory, useLiveCategories } from '@/db/hooks';
import { useLocalWrite } from '@/db/localWrite';
import { createExpense } from '@/db/mutations';
import { parseQuickAdd } from '@/quickAdd/parseQuickAdd';
import { quickAddSummary } from '@/quickAdd/planQuickAdd';
import { dateRowLabel } from '@/lib/calendar';
import { useSnackbar } from '@/components/Snackbar';
import { useApiClient } from '@/bootstrap/AppProviders';
import { useDigest } from '@/assistant/useDigest';
import { AppBar, IconButton } from '@/components/Chrome';
import { FadeInUp } from '@/components/FadeInUp';
import { COPY } from '@/copy/strings';
import { keyHaptic, savedHaptic, warnHaptic } from '@/lib/haptics';
import { useSelectedMonth } from '@/month/MonthProvider';
import { goBack } from '@/navigation/goBack';
import { useOptionalSyncStatus } from '@/sync/SyncProvider';
import { createStyles, useColors, useTheme } from '@/theme/ThemeProvider';
import { HIT_SLOP_44, radius, size, space, type } from '@/theme/tokens';

export const ASSISTANT_INPUT_TEST_ID = 'assistant-input';
export const ASSISTANT_SEND_TEST_ID = 'assistant-send';
export const ASSISTANT_CLEAR_TEST_ID = 'assistant-clear';
export const ASSISTANT_SUGGESTION_PREFIX = 'assistant-suggestion';
export const ASSISTANT_ANSWER_PREFIX = 'assistant-answer';
export const ASSISTANT_RESULTS_TEST_ID = 'assistant-results';
export const ASSISTANT_RECORD_TEST_ID = 'assistant-record';
export const ASSISTANT_REVIEW_TEST_ID = 'assistant-review';
export const ASSISTANT_RESULT_PREFIX = 'assistant-result';
export const ASSISTANT_SEE_ALL_TEST_ID = 'assistant-see-all';

type Turn =
  | { readonly id: number; readonly question: string; readonly status: 'loading' }
  | {
      readonly id: number;
      readonly question: string;
      readonly status: 'done';
      readonly answer: string;
      readonly disclaimer: string;
    }
  | {
      readonly id: number;
      readonly question: string;
      readonly status: 'failed' | 'unavailable';
    };

/**
 * Ask a question about the person's own money. The device builds a digest of its figures (never notes) and
 * sends it with the question; the answer is written by a model on the server, which keeps neither. Answers
 * live only on this screen: leaving it forgets them, as there is nothing here worth keeping or syncing.
 */
export default function AssistantScreen() {
  const color = useColors();
  const styles = useStyles();
  const { isDark } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const api = useApiClient();
  const { month, today } = useSelectedMonth();
  const localWrite = useLocalWrite();
  const showSnackbar = useSnackbar();
  const status = useOptionalSyncStatus();
  const offline = status !== null && !status.reachable;
  const digest = useDigest(api, month, !offline);

  const [text, setText] = useState('');
  // What is typed also searches the expenses, live, so the one box does both jobs.
  const query = text.trim().length >= 2 ? text.trim() : '';
  const found = useExpenseSearch({ text: query, categoryId: null });
  const foundSummary = useExpenseSearchSummary({ text: query, categoryId: null });
  const currency = useUserCurrency().data ?? 'USD';
  // Typed like an expense ("lunch 50k"), the same box offers to record it. The person's tap is what saves it.
  const categories = useLiveCategories();
  const fallback = useFallbackCategory();
  const reading = useMemo(() => {
    const t = text.trim();
    if (t.length < 3 || t.includes('?') || categories.data === undefined) return null;
    const read = parseQuickAdd(t, {
      currency,
      today,
      categories: categories.data.map((c) => ({ id: c.id, name: c.name })),
    });
    return read.amountMinor !== null && read.confident ? read : null;
  }, [text, currency, today, categories.data]);
  const recordable = reading !== null && (reading.categoryId ?? fallback.data?.id ?? null) !== null;

  async function record(): Promise<void> {
    if (reading === null || reading.amountMinor === null) return;
    const categoryId = reading.categoryId ?? fallback.data?.id ?? null;
    if (categoryId === null) return;
    const amountMinor = reading.amountMinor;
    await localWrite((db) =>
      createExpense(db, {
        categoryId,
        kind: reading.type,
        amountMinor,
        currency,
        date: reading.date ?? today,
        note: reading.note,
      }),
    );
    savedHaptic();
    setText('');
    showSnackbar({ message: COPY.assistant.added });
  }
  const [turns, setTurns] = useState<readonly Turn[]>([]);
  const next = useRef(1);
  const scroller = useRef<ScrollView>(null);
  // Whether the server has said it has no model: kept for the screen, so the box says so instead of failing.
  const [off, setOff] = useState(false);

  const busy = turns.some((t) => t.status === 'loading');
  const canAsk = !offline && !off && !busy && digest.text !== null;

  async function ask(raw: string): Promise<void> {
    const question = raw.trim();
    if (question === '' || !canAsk || digest.text === null) return;
    keyHaptic();
    const id = next.current++;
    setText('');
    setTurns((current) => [...current, { id, question, status: 'loading' }]);
    const settle = (turn: Turn) =>
      setTurns((current) => current.map((t) => (t.id === id ? turn : t)));
    try {
      // The last few answered turns go along, so a follow-up is understood. An answer is cut to what the server takes.
      const history = turns
        .filter((t): t is Extract<Turn, { status: 'done' }> => t.status === 'done')
        .slice(-ASSISTANT_HISTORY_MAX)
        .map((t) => ({
          question: t.question,
          answer: t.answer.slice(0, ASSISTANT_ANSWER_ECHO_MAX),
        }));
      const { data } = await api.askAssistant({
        question,
        context: digest.text,
        ...(history.length === 0 ? {} : { history }),
      });
      settle({ id, question, status: 'done', answer: data.answer, disclaimer: data.disclaimer });
      savedHaptic();
    } catch (error) {
      warnHaptic();
      if (error instanceof ApiRequestError && error.code === 'market_unavailable') {
        setOff(true);
        settle({ id, question, status: 'unavailable' });
      } else {
        settle({ id, question, status: 'failed' });
      }
    }
  }

  const suggestions = [COPY.assistant.s1, COPY.assistant.s2, COPY.assistant.s3, COPY.assistant.s4];
  const hint = offline ? COPY.assistant.offline : off ? COPY.assistant.unavailable : null;

  return (
    <View style={styles.screen}>
      <AppBar
        title={COPY.assistant.title}
        leading={
          <IconButton
            icon="chevron-left"
            label={COPY.common.back}
            onPress={() => goBack(router, '/(app)/(tabs)')}
            tint={color.text.primary}
            testID="assistant-back"
          />
        }
        trailing={
          turns.length === 0 ? undefined : (
            <IconButton
              icon="trash-2"
              label={COPY.assistant.clear}
              onPress={() => setTurns([])}
              tint={color.text.primary}
              testID={ASSISTANT_CLEAR_TEST_ID}
            />
          )
        }
      />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          ref={scroller}
          style={styles.flex}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          onContentSizeChange={() => scroller.current?.scrollToEnd({ animated: true })}
        >
          <FadeInUp>
            <View style={styles.intro}>
              <View style={styles.badge}>
                <Feather name="message-circle" size={22} color={color.primary.default} />
              </View>
              <Text style={styles.introText}>{COPY.assistant.intro}</Text>
              <Text style={styles.consent}>{COPY.assistant.consent}</Text>
            </View>
          </FadeInUp>

          {turns.length === 0 ? (
            <View style={styles.chips}>
              <Pressable
                testID={ASSISTANT_REVIEW_TEST_ID}
                onPress={() => void ask(COPY.assistant.reviewQuestion)}
                disabled={!canAsk}
                accessibilityRole="button"
                accessibilityState={{ disabled: !canAsk }}
                style={({ pressed }) => [
                  styles.review,
                  !canAsk ? styles.chipDisabled : null,
                  pressed ? { opacity: 0.85 } : null,
                ]}
              >
                <Feather name="file-text" size={18} color={color.text.inverse} />
                <Text style={styles.reviewText}>{COPY.assistant.review}</Text>
              </Pressable>
              {suggestions.map((s, index) => (
                <Pressable
                  key={s}
                  testID={`${ASSISTANT_SUGGESTION_PREFIX}-${index}`}
                  onPress={() => void ask(s)}
                  disabled={!canAsk}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: !canAsk }}
                  style={({ pressed }) => [
                    styles.chip,
                    !canAsk ? styles.chipDisabled : null,
                    pressed ? { backgroundColor: color.bg.sunken } : null,
                  ]}
                >
                  <Text style={styles.chipText}>{s}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}

          {turns.map((turn) => (
            <FadeInUp key={turn.id}>
              <View style={styles.turn} testID={`${ASSISTANT_ANSWER_PREFIX}-${turn.id}`}>
                <View style={styles.asked}>
                  <Text
                    style={styles.askedText}
                    accessibilityLabel={`${COPY.assistant.youAsked}: ${turn.question}`}
                  >
                    {turn.question}
                  </Text>
                </View>
                <View style={styles.answer}>
                  {turn.status === 'loading' ? (
                    <View style={styles.thinking}>
                      <ActivityIndicator size="small" color={color.text.tertiary} />
                      <Text style={styles.muted}>{COPY.assistant.thinking}</Text>
                    </View>
                  ) : turn.status === 'done' ? (
                    <>
                      <Text style={styles.answerText} selectable>
                        {turn.answer}
                      </Text>
                      <Text style={styles.muted}>{COPY.invest.briefByAi}</Text>
                      <Text style={styles.muted}>{turn.disclaimer}</Text>
                    </>
                  ) : (
                    <Text style={styles.error}>
                      {turn.status === 'unavailable'
                        ? COPY.assistant.unavailable
                        : COPY.assistant.failed}
                    </Text>
                  )}
                </View>
              </View>
            </FadeInUp>
          ))}
        </ScrollView>

        {reading === null || !recordable ? null : (
          <Pressable
            testID={ASSISTANT_RECORD_TEST_ID}
            onPress={() => void record()}
            accessibilityRole="button"
            style={styles.recordRow}
          >
            <Feather name="plus-circle" size={20} color={color.primary.default} />
            <Text style={styles.recordText} numberOfLines={2}>
              {COPY.assistant.addRow.replace(
                '{summary}',
                quickAddSummary(reading, currency, (d) => dateRowLabel(d, today)),
              )}
            </Text>
          </Pressable>
        )}

        {query === '' || (found.data ?? []).length === 0 ? null : (
          <View style={styles.results} testID={ASSISTANT_RESULTS_TEST_ID}>
            {(found.data ?? []).slice(0, 4).map((item) => (
              <Pressable
                key={item.id}
                testID={`${ASSISTANT_RESULT_PREFIX}-${item.id}`}
                onPress={() => router.push(`/(app)/expense/${item.id}`)}
                accessibilityRole="button"
                style={({ pressed }) => [
                  styles.resultRow,
                  pressed ? { backgroundColor: color.bg.sunken } : null,
                ]}
              >
                <View style={styles.resultText}>
                  <Text style={styles.resultTitle} numberOfLines={1}>
                    {item.note !== null && item.note !== ''
                      ? item.note
                      : (item.categoryName ?? item.fallbackName ?? '')}
                  </Text>
                  <Text style={styles.muted} numberOfLines={1}>
                    {`${item.categoryName ?? item.fallbackName ?? ''} · ${item.date}`}
                  </Text>
                </View>
                <Text style={styles.resultAmount}>
                  {formatMoney(item.amountMinor, item.currency)}
                </Text>
              </Pressable>
            ))}
            <Pressable
              testID={ASSISTANT_SEE_ALL_TEST_ID}
              onPress={() => router.push({ pathname: '/(app)/search', params: { q: query } })}
              accessibilityRole="button"
              style={styles.seeAll}
            >
              <Text style={styles.muted}>
                {COPY.assistant.found.replace('{count}', String(foundSummary.data?.count ?? 0))}
                {foundSummary.data === undefined
                  ? ''
                  : ` · ${formatMoney(foundSummary.data.totalMinor, currency)}`}
              </Text>
              <Text style={styles.seeAllText}>
                {COPY.assistant.seeAll.replace('{count}', String(foundSummary.data?.count ?? 0))}
              </Text>
            </Pressable>
          </View>
        )}

        <View style={[styles.composer, { paddingBottom: space[3] + insets.bottom }]}>
          {hint === null ? null : <Text style={styles.hint}>{hint}</Text>}
          <View style={styles.field}>
            <TextInput
              testID={ASSISTANT_INPUT_TEST_ID}
              style={styles.input}
              value={text}
              onChangeText={setText}
              placeholder={COPY.assistant.placeholder}
              placeholderTextColor={color.text.tertiary}
              keyboardAppearance={isDark ? 'dark' : 'light'}
              maxLength={ASSISTANT_QUESTION_MAX}
              multiline
              returnKeyType="send"
              blurOnSubmit
              onSubmitEditing={() => void ask(text)}
              editable={!offline && !off}
              accessibilityLabel={COPY.assistant.placeholder}
            />
            <Pressable
              testID={ASSISTANT_SEND_TEST_ID}
              onPress={() => void ask(text)}
              disabled={!canAsk || text.trim() === ''}
              hitSlop={HIT_SLOP_44}
              accessibilityRole="button"
              accessibilityLabel={COPY.assistant.send}
              accessibilityState={{ disabled: !canAsk || text.trim() === '', busy }}
              style={({ pressed }) => [
                styles.go,
                !canAsk || text.trim() === '' ? styles.goDisabled : null,
                pressed ? { backgroundColor: color.primary.pressed } : null,
              ]}
            >
              <Feather name="arrow-up" size={18} color={color.text.inverse} />
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const useStyles = createStyles((color, { display }) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: color.bg.canvas },
    flex: { flex: 1 },
    content: { flexGrow: 1, gap: space[3], padding: space[4] },
    intro: { gap: space[2], alignItems: 'flex-start' },
    badge: {
      width: 44,
      height: 44,
      borderRadius: 22,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: color.bg.sunken,
    },
    introText: { ...type.title2, ...display('semibold'), color: color.text.primary },
    consent: { ...type.footnote, color: color.text.tertiary },
    chips: { gap: space[2] },
    chip: {
      paddingVertical: space[3],
      paddingHorizontal: space[4],
      borderRadius: radius.lg,
      backgroundColor: color.bg.surface,
      borderWidth: 1,
      borderColor: color.border.hairline,
    },
    chipDisabled: { opacity: 0.5 },
    review: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space[2],
      paddingVertical: space[3],
      paddingHorizontal: space[4],
      borderRadius: radius.lg,
      backgroundColor: color.primary.default,
    },
    reviewText: { ...type.bodyStrong, color: color.text.inverse },
    chipText: { ...type.body, color: color.text.primary },
    turn: { gap: space[2] },
    asked: {
      alignSelf: 'flex-end',
      maxWidth: '85%',
      paddingVertical: space[2],
      paddingHorizontal: space[3],
      borderRadius: radius.lg,
      backgroundColor: color.primary.default,
    },
    askedText: { ...type.body, color: color.text.inverse },
    answer: {
      alignSelf: 'flex-start',
      maxWidth: '95%',
      gap: space[2],
      padding: space[4],
      borderRadius: radius.lg,
      backgroundColor: color.bg.surface,
      borderWidth: 1,
      borderColor: color.border.hairline,
    },
    answerText: { ...type.body, color: color.text.primary },
    thinking: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
    muted: { ...type.footnote, color: color.text.tertiary },
    error: { ...type.body, color: color.danger.default },
    recordRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space[3],
      marginHorizontal: space[4],
      marginBottom: space[2],
      paddingVertical: space[3],
      paddingHorizontal: space[4],
      borderRadius: radius.lg,
      backgroundColor: color.bg.sunken,
    },
    recordText: { ...type.bodyStrong, flex: 1, color: color.text.primary },
    results: {
      marginHorizontal: space[4],
      marginBottom: space[2],
      borderRadius: radius.lg,
      backgroundColor: color.bg.surface,
      borderWidth: 1,
      borderColor: color.border.hairline,
      overflow: 'hidden',
    },
    resultRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space[3],
      paddingVertical: space[2],
      paddingHorizontal: space[4],
    },
    resultText: { flex: 1, gap: 2 },
    resultTitle: { ...type.body, color: color.text.primary },
    resultAmount: { ...type.bodyStrong, color: color.text.primary, fontVariant: ['tabular-nums'] },
    seeAll: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingVertical: space[3],
      paddingHorizontal: space[4],
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: color.border.hairline,
    },
    seeAllText: { ...type.callout, color: color.primary.default },
    composer: {
      gap: space[1],
      paddingHorizontal: space[4],
      paddingTop: space[2],
      paddingBottom: space[3],
      backgroundColor: color.bg.canvas,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: color.border.hairline,
    },
    hint: { ...type.footnote, color: color.text.tertiary, paddingHorizontal: space[2] },
    field: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      gap: space[2],
      minHeight: size.inputHeight,
      paddingLeft: space[4],
      paddingRight: space[2],
      paddingVertical: space[1],
      borderRadius: radius.lg,
      backgroundColor: color.bg.surface,
      borderWidth: 1.5,
      borderColor: color.border.hairline,
    },
    input: {
      flex: 1,
      ...type.body,
      color: color.text.primary,
      maxHeight: 120,
      paddingTop: space[2],
      paddingBottom: space[2],
    },
    go: {
      width: 36,
      height: 36,
      borderRadius: 18,
      marginBottom: 4,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: color.primary.default,
    },
    goDisabled: { opacity: 0.4 },
  }),
);
