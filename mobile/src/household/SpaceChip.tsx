import Feather from '@expo/vector-icons/Feather';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { COPY } from '../copy/strings';
import { HIT_SLOP_44, radius, space, type } from '../theme/tokens';
import { createStyles, useColors } from '../theme/ThemeProvider';
import { spaceName } from './spaceModel';
import { SpaceSwitcherSheet } from './SpaceSwitcherSheet';
import { useSpaces } from './useSpaces';

export const SPACE_CHIP_TEST_ID = 'space-chip';

/**
 * Which book is open, under Home's title: the space's name with a chevron, opening the switcher. A person
 * with only their own books has nothing to switch to, so it is not drawn at all
 * (`docs/design/13-multiple-households.md`).
 */
export function SpaceChip() {
  const styles = useStyles();
  const color = useColors();
  const router = useRouter();
  const { active, switchable } = useSpaces();
  const [open, setOpen] = useState(false);

  if (!switchable || active === null) return null;
  const name = spaceName(active);

  return (
    <View style={styles.wrap}>
      <Pressable
        testID={SPACE_CHIP_TEST_ID}
        onPress={() => setOpen(true)}
        hitSlop={HIT_SLOP_44}
        accessibilityRole="button"
        accessibilityLabel={COPY.spaces.chipLabel.replace('{name}', name)}
        accessibilityHint={COPY.spaces.chipHint}
        style={({ pressed }) => [styles.chip, pressed ? styles.pressed : null]}
      >
        <Text style={styles.name} numberOfLines={1}>
          {name}
        </Text>
        <Feather name="chevron-down" size={16} color={color.text.secondary} />
      </Pressable>
      <SpaceSwitcherSheet
        visible={open}
        onClose={() => setOpen(false)}
        onManage={() => {
          setOpen(false);
          router.push('/(app)/settings/household');
        }}
      />
    </View>
  );
}

const useStyles = createStyles((color) =>
  StyleSheet.create({
    // The header's own surface, so the chip does not sit on a strip of canvas between two white bands.
    wrap: {
      paddingHorizontal: space[4],
      paddingBottom: space[2],
      flexDirection: 'row',
      backgroundColor: color.bg.surface,
    },
    chip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space[1],
      maxWidth: '100%',
      paddingVertical: space[1],
      paddingHorizontal: space[3],
      borderRadius: radius.pill,
      backgroundColor: color.bg.surface,
      borderWidth: 1,
      borderColor: color.border.input,
    },
    pressed: { opacity: 0.7 },
    name: { ...type.subhead, color: color.text.primary, flexShrink: 1 },
  }),
);
