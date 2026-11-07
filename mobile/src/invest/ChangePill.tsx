import Feather from '@expo/vector-icons/Feather';
import { StyleSheet, Text, View } from 'react-native';
import { radius, space, type } from '../theme/tokens';
import { createStyles, useColors } from '../theme/ThemeProvider';
import { formatChange } from './investModel';

/**
 * A change as a small pill: an arrow, the percentage, on a tint of the market's own colour. Green up and red
 * down, as Vietnamese quotes are drawn; no movement is neutral grey, because "0%" in green or red says a thing
 * that is not true. The arrow means the pill still reads without colour.
 */

export type ChangeSize = 'regular' | 'small';

export function ChangePill({
  fraction,
  size = 'regular',
  testID,
}: {
  readonly fraction: number | null;
  readonly size?: ChangeSize;
  readonly testID?: string;
}) {
  const styles = useStyles();
  const color = useColors();
  if (fraction === null) return null;

  const rounded = Math.round(fraction * 1000) / 10;
  const tone = rounded > 0 ? 'up' : rounded < 0 ? 'down' : 'flat';
  const ink =
    tone === 'up'
      ? color.success.default
      : tone === 'down'
        ? color.danger.default
        : color.text.secondary;
  const fill =
    tone === 'up' ? color.success.subtle : tone === 'down' ? color.danger.subtle : color.bg.sunken;
  const icon = tone === 'up' ? 'arrow-up-right' : tone === 'down' ? 'arrow-down-right' : 'minus';
  const small = size === 'small';

  return (
    <View
      testID={testID}
      style={[styles.pill, small ? styles.small : null, { backgroundColor: fill }]}
      accessible
      accessibilityLabel={formatChange(fraction)}
    >
      <Feather name={icon} size={small ? 12 : 14} color={ink} />
      <Text style={[small ? styles.textSmall : styles.text, { color: ink }]}>
        {formatChange(fraction).replace(/^[+-]/, '')}
      </Text>
    </View>
  );
}

const useStyles = createStyles(() =>
  StyleSheet.create({
    pill: {
      flexDirection: 'row',
      alignItems: 'center',
      alignSelf: 'flex-start',
      gap: 2,
      paddingVertical: space[1],
      paddingHorizontal: space[2],
      borderRadius: radius.pill,
    },
    small: { paddingVertical: 2, paddingHorizontal: 6 },
    text: { ...type.subhead, fontVariant: ['tabular-nums'] },
    textSmall: { ...type.caption, fontVariant: ['tabular-nums'] },
  }),
);
