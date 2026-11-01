import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { ApiRequestError } from '../api/errors';
import { useApiClient } from '../bootstrap/AppProviders';
import { Button } from '../components/Button';
import { useSnackbar } from '../components/Snackbar';
import { COPY } from '../copy/strings';
import { useLanguage } from '../i18n/LanguageProvider';
import { useOptionalSyncStatus } from '../sync/SyncProvider';
import { space, type } from '../theme/tokens';
import { createStyles } from '../theme/ThemeProvider';

export const RECAP_BUTTON_TEST_ID = 'summary-recap-button';
export const RECAP_AGAIN_TEST_ID = 'summary-recap-again';
export const RECAP_TEXT_TEST_ID = 'summary-recap-text';

/**
 * A recap written for each month's sentences, kept for the session only, in memory (`docs/design/16-monthly-insights.md`).
 * It is a convenience, not a record: nothing is stored or synced, and a restart forgets it. Keyed by the month,
 * the language and the sentences themselves, so a change in the figures asks again.
 */
const written = new Map<string, string>();

/** Whether the server has said it cannot write recaps, as last heard: a restart asks afresh. */
let unavailable = false;

export function resetRecapStateForTests(): void {
  written.clear();
  unavailable = false;
}

/**
 * "Write my recap" under the Insights card's list, and the recap once it exists.
 *
 * The model is given only the sentences the card is showing, so nothing is sent that the person cannot see
 * above the button, and the hint says plainly where they go. Tapping is the act. However it goes, the card
 * is as it was: a failure is a snackbar, and an unavailable server takes the button away for the session.
 */
export function RecapSection({
  month,
  facts,
}: {
  readonly month: string;
  readonly facts: readonly string[];
}) {
  const styles = useStyles();
  const api = useApiClient();
  const showSnackbar = useSnackbar();
  const { language } = useLanguage();
  const status = useOptionalSyncStatus();
  const offline = status !== null && !status.reachable;

  const key = `${month}|${language}|${facts.join('\n')}`;
  const [asking, setAsking] = useState(false);
  const [off, setOff] = useState(unavailable);
  // Bumped when the month or the sentences change, or a new request starts, so a late answer is dropped.
  const ticket = useRef(0);
  const [, rerender] = useState(0);

  useEffect(() => {
    ticket.current += 1;
    setAsking(false);
  }, [key]);

  async function ask(): Promise<void> {
    if (asking) return;
    ticket.current += 1;
    const mine = ticket.current;
    setAsking(true);
    try {
      const { data } = await api.recap({ month, language, facts: [...facts] });
      if (mine === ticket.current) {
        written.set(key, data.text);
        rerender((count) => count + 1);
      }
    } catch (error) {
      if (error instanceof ApiRequestError && error.code === 'recap_unavailable') {
        unavailable = true;
        setOff(true);
      } else if (mine === ticket.current) {
        showSnackbar({ message: COPY.summary.recap.failed });
      }
    } finally {
      if (mine === ticket.current) setAsking(false);
    }
  }

  if (off) return null;
  const text = written.get(key);
  const disabledReason = offline ? COPY.summary.recap.offline : undefined;

  if (text !== undefined) {
    return (
      <View style={styles.wrap}>
        <Text testID={RECAP_TEXT_TEST_ID} style={styles.recap}>
          {text}
        </Text>
        <Text style={styles.caption}>{COPY.summary.recap.byAi}</Text>
        <Button
          label={COPY.summary.recap.again}
          variant="ghost"
          onPress={() => void ask()}
          busy={asking}
          {...(disabledReason === undefined ? {} : { disabledReason })}
          testID={RECAP_AGAIN_TEST_ID}
        />
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      <Button
        label={COPY.summary.recap.button}
        variant="secondary"
        onPress={() => void ask()}
        busy={asking}
        {...(disabledReason === undefined ? {} : { disabledReason })}
        testID={RECAP_BUTTON_TEST_ID}
      />
      <Text style={styles.caption}>{COPY.summary.recap.hint}</Text>
    </View>
  );
}

const useStyles = createStyles((color) =>
  StyleSheet.create({
    wrap: { gap: space[2], marginTop: space[2] },
    recap: { ...type.body, color: color.text.primary },
    caption: { ...type.footnote, color: color.text.tertiary },
  }),
);
