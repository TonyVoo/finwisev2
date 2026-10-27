import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { COPY } from '@/copy/strings';
import { radius, size, space, type } from '@/theme/tokens';
import { createStyles, useColors, useTheme } from '@/theme/ThemeProvider';

/**
 * The Home search bar: a text field plus a row of category chips.
 *
 * Controlled and stateless. What the text and chip *mean* (which rows match) lives in
 * `db/queries.ts`; this only reports what the user typed or tapped.
 */

export interface SearchBarCategory {
  readonly id: string;
  readonly name: string;
}

export function SearchBar({
  text,
  onChangeText,
  categoryId,
  onChangeCategory,
  categories,
}: {
  readonly text: string;
  readonly onChangeText: (next: string) => void;
  readonly categoryId: string | null;
  readonly onChangeCategory: (next: string | null) => void;
  readonly categories: readonly SearchBarCategory[];
}) {
  const color = useColors();
  const { isDark } = useTheme();
  const styles = useStyles();
  return (
    <View style={styles.wrap}>
      <View style={styles.field}>
        <Feather name="search" size={18} color={color.text.tertiary} />
        <TextInput
          testID="search-input"
          style={styles.input}
          value={text}
          onChangeText={onChangeText}
          placeholder={COPY.home.search.placeholder}
          placeholderTextColor={color.text.tertiary}
          keyboardAppearance={isDark ? 'dark' : 'light'}
          autoFocus
          autoCorrect={false}
          returnKeyType="search"
          accessibilityLabel={COPY.home.search.placeholder}
        />
        {text !== '' ? (
          <Pressable
            testID="search-clear"
            accessibilityRole="button"
            accessibilityLabel={COPY.home.search.clear}
            onPress={() => onChangeText('')}
            hitSlop={8}
          >
            <Feather name="x" size={18} color={color.text.tertiary} />
          </Pressable>
        ) : null}
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chips}
        keyboardShouldPersistTaps="handled"
      >
        <Chip
          testID="search-chip-all"
          label={COPY.home.search.allCategories}
          selected={categoryId === null}
          onPress={() => onChangeCategory(null)}
        />
        {categories.map((category) => (
          <Chip
            key={category.id}
            testID={`search-chip-${category.id}`}
            label={category.name}
            selected={categoryId === category.id}
            onPress={() => onChangeCategory(categoryId === category.id ? null : category.id)}
          />
        ))}
      </ScrollView>
    </View>
  );
}

function Chip({
  label,
  selected,
  onPress,
  testID,
}: {
  readonly label: string;
  readonly selected: boolean;
  readonly onPress: () => void;
  readonly testID: string;
}) {
  const styles = useStyles();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[styles.chip, selected && styles.chipSelected]}
    >
      <Text style={[styles.chipLabel, selected && styles.chipLabelSelected]}>{label}</Text>
    </Pressable>
  );
}

const useStyles = createStyles((color) =>
  StyleSheet.create({
    wrap: { paddingBottom: space[2] },
    field: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space[2],
      marginHorizontal: space[4],
      paddingHorizontal: space[3],
      height: size.tapTargetMin,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: color.border.input,
      backgroundColor: color.bg.surface,
    },
    input: { flex: 1, ...type.body, color: color.text.primary, paddingVertical: 0 },
    chips: { gap: space[2], paddingHorizontal: space[4], paddingTop: space[2] },
    chip: {
      paddingHorizontal: space[3],
      height: 32,
      justifyContent: 'center',
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: color.border.input,
    },
    chipSelected: { backgroundColor: color.text.primary, borderColor: color.text.primary },
    chipLabel: { ...type.footnote, color: color.text.secondary },
    chipLabelSelected: { color: color.bg.surface },
  }),
);
