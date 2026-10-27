import { Share, StyleSheet, Text, View } from 'react-native';
import { Button } from '../components/Button';
import { Sheet } from '../components/Sheet';
import { COPY } from '../copy/strings';
import { radius, space, type } from '../theme/tokens';
import { createStyles } from '../theme/ThemeProvider';

export const INVITE_SHEET_TEST_ID = 'household-invite-sheet';
export const INVITE_SHARE_TEST_ID = 'household-invite-share';
export const INVITE_CLOSE_TEST_ID = 'household-invite-close';

/** The invite code, shown once. Nothing here can retrieve it again: the server keeps only a hash. */
export function InviteSheet({
  code,
  onClose,
}: {
  /** `null` while closed. */
  readonly code: string | null;
  readonly onClose: () => void;
}) {
  const styles = useStyles();

  return (
    <Sheet
      visible={code !== null}
      title={COPY.household.invite.title}
      onClose={onClose}
      testID={INVITE_SHEET_TEST_ID}
    >
      <View style={styles.body}>
        <View style={styles.codeBox}>
          <Text
            style={styles.code}
            selectable
            accessibilityLabel={(code ?? '').split('').join(' ')}
          >
            {code ?? ''}
          </Text>
        </View>
        <Text style={styles.hint}>{COPY.household.invite.body}</Text>
        <Button
          testID={INVITE_SHARE_TEST_ID}
          label={COPY.household.invite.share}
          variant="primary"
          fullWidth
          onPress={() => {
            if (code === null) return;
            void Share.share({ message: COPY.household.invite.message.replace('{code}', code) });
          }}
        />
        <Button
          testID={INVITE_CLOSE_TEST_ID}
          label={COPY.household.invite.close}
          variant="ghost"
          fullWidth
          onPress={onClose}
        />
      </View>
    </Sheet>
  );
}

const useStyles = createStyles((color) =>
  StyleSheet.create({
    body: { gap: space[4], paddingBottom: space[4] },
    codeBox: {
      alignItems: 'center',
      paddingVertical: space[4],
      borderRadius: radius.md,
      backgroundColor: color.primary.subtle,
    },
    code: {
      ...type.display,
      color: color.text.primary,
      letterSpacing: 4,
      fontVariant: ['tabular-nums'],
    },
    hint: { ...type.callout, color: color.text.secondary, textAlign: 'center' },
  }),
);
