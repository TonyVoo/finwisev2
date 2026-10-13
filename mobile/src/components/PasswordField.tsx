import { useState } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { COPY } from '../copy/strings';
import { HIT_SLOP_44, color } from '../theme/tokens';
import { TextField, type TextFieldProps } from './TextField';

/**
 * A {@link TextField} that starts masked, with the reveal toggle from
 * `docs/design/03-auth.md` §1.2 element 8.
 *
 * Composed rather than built into `TextField` with a flag, because the toggle is a
 * second interactive control with its own accessible name and its own tap target, and a
 * `secure` boolean on the field would not give it either.
 *
 * The toggle's label states the action rather than the state - `Show password` while the
 * value is hidden - so a screen reader announces what the next tap will do, which is the
 * convention for a control that flips.
 */

export type PasswordFieldProps = Omit<TextFieldProps, 'secureTextEntry' | 'trailing'>;

export function PasswordField(props: PasswordFieldProps) {
  const [revealed, setRevealed] = useState(false);

  return (
    <TextField
      {...props}
      secureTextEntry={!revealed}
      trailing={
        <Pressable
          onPress={() => setRevealed((current) => !current)}
          accessibilityRole="button"
          accessibilityLabel={revealed ? COPY.password.hide : COPY.password.show}
          accessibilityState={{ expanded: revealed }}
          // The glyph is 20px; `hitSlop` grows the touch area to the 44x44 floor without
          // padding the field out (`00-foundations.md` §8 rule 1).
          hitSlop={HIT_SLOP_44}
          style={styles.toggle}
        >
          <Feather name={revealed ? 'eye-off' : 'eye'} size={20} color={color.text.tertiary} />
        </Pressable>
      }
    />
  );
}

const styles = StyleSheet.create({
  toggle: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
