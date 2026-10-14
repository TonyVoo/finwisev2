import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Button } from './Button';
import { color, elevation, radius, space, type } from '../theme/tokens';
import { COPY } from '../copy/strings';

/**
 * The dialog, as `docs/design/00-foundations.md` §6 specifies it.
 *
 * Two rules from that section are enforced here rather than left to each caller, because
 * both are about what happens when the user does *not* choose:
 *
 * - **The destructive action sits on top and Cancel below it.** The props are named
 *   `destructive` and `cancel` rather than `primary`/`secondary` so a caller cannot order
 *   them the other way round.
 * - **Scrim tap and Android back both resolve as Cancel**, never as the destructive
 *   action. `onRequestClose` and the scrim's `onPress` are therefore the same callback as
 *   the Cancel button, not a separate "dismiss" path that a caller might wire to the
 *   wrong thing.
 */

export interface DialogProps {
  readonly visible: boolean;
  readonly title: string;
  readonly body?: string;
  /** The destructive action. Rendered first, above Cancel. */
  readonly destructive: { readonly label: string; readonly onPress: () => void };
  /** Cancel. Also what a scrim tap and Android back resolve to. */
  readonly onCancel: () => void;
  readonly cancelLabel?: string;
  readonly testID?: string;
}

export function Dialog({
  visible,
  title,
  body,
  destructive,
  onCancel,
  cancelLabel = COPY.common.cancel,
  testID,
}: DialogProps) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      // The system contract on Android, and it means Cancel.
      onRequestClose={onCancel}
    >
      <Pressable
        style={styles.scrim}
        testID={testID === undefined ? undefined : `${testID}-scrim`}
        onPress={onCancel}
        // The scrim is a dismissal affordance for a pointer, not an element to land on:
        // a screen reader user reaches Cancel itself.
        //
        // So it removes *itself* from the accessibility tree and not its descendants.
        // `accessibilityElementsHidden`/`no-hide-descendants` here would hide the whole
        // dialog it wraps — title, Delete and Cancel included — leaving a screen reader
        // user with a modal they cannot read or answer.
        accessible={false}
        importantForAccessibility="no"
      >
        {/* Stops a tap inside the dialog from reaching the scrim behind it. */}
        <Pressable style={styles.dialog} testID={testID} onPress={() => undefined}>
          <Text style={styles.title} accessibilityRole="header">
            {title}
          </Text>
          {body === undefined ? null : <Text style={styles.body}>{body}</Text>}

          <View style={styles.actions}>
            <Button
              label={destructive.label}
              variant="destructive"
              fullWidth
              onPress={destructive.onPress}
              testID={testID === undefined ? undefined : `${testID}-confirm`}
            />
            <Button
              label={cancelLabel}
              variant="secondary"
              fullWidth
              onPress={onCancel}
              testID={testID === undefined ? undefined : `${testID}-cancel`}
            />
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: {
    flex: 1,
    backgroundColor: color.bg.scrim,
    alignItems: 'center',
    justifyContent: 'center',
    padding: space[4],
  },
  dialog: {
    ...elevation[2],
    width: '100%',
    maxWidth: 320,
    backgroundColor: color.bg.surface,
    borderRadius: radius.lg,
    padding: space[5],
    gap: space[3],
  },
  title: {
    ...type.title2,
    color: color.text.primary,
  },
  body: {
    ...type.callout,
    color: color.text.secondary,
  },
  actions: {
    marginTop: space[2],
    gap: space[2],
  },
});
