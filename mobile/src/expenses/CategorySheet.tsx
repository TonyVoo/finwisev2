import { ScrollView, StyleSheet, Text, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { Button } from '../components/Button';
import { Row, RowTitle, Swatch } from '../components/Row';
import { Sheet } from '../components/Sheet';
import { COPY, EMPTY_COPY } from '../copy/strings';
import { space, type } from '../theme/tokens';
import { createStyles, useColors } from '../theme/ThemeProvider';
import type { CategoryListItem } from '../db/queries';

/**
 * The category picker: `docs/design/06-expense-form.md` rule 4.
 *
 * **A category is always set.** There is no "none" option, because the `isDefault`
 * category already *is* the "I will sort this out later" choice - which is exactly what it
 * exists for. Adding a null option would create a second way to express the same thing and
 * a nullable column to carry it.
 *
 * Tapping a row **selects and dismisses**, with no confirm step: the selection is the
 * confirmation, and a one-tap action should not cost two.
 *
 * The `New category` button opens the create sheet from `07-categories.md` §2 inline, and
 * on create the new category is selected automatically and **both** sheets dismiss - "the
 * user came here to pick a category, not to manage them" (rule 4).
 *
 * The empty state is reachable by two routes, and in practice only one: the post-signup
 * category fetch failed and no sync has succeeded since. Deleting every category cannot
 * reach it, because the `isDefault` row cannot be deleted. Both self-repair on the next
 * successful sync, which is why the sheet offers creation rather than an explanation.
 */

export const CATEGORY_PICKER_TEST_ID = 'category-picker';
export const CATEGORY_PICKER_CHECK_TEST_ID = 'category-picker-check';

export interface CategorySheetProps {
  readonly visible: boolean;
  readonly onClose: () => void;
  readonly categories: readonly CategoryListItem[];
  readonly selectedId: string | null;
  readonly onSelect: (id: string) => void;
  readonly onCreateNew: () => void;
}

export function CategorySheet({
  visible,
  onClose,
  categories,
  selectedId,
  onSelect,
  onCreateNew,
}: CategorySheetProps) {
  const color = useColors();
  const styles = useStyles();
  return (
    <Sheet
      visible={visible}
      title={COPY.picker.category.title}
      onClose={onClose}
      testID={CATEGORY_PICKER_TEST_ID}
    >
      {categories.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyHeadline} accessibilityRole="header">
            {EMPTY_COPY.categoryPicker.headline}
          </Text>
          <Button
            testID="category-picker-create-first"
            label={EMPTY_COPY.categoryPicker.action}
            variant="primary"
            fullWidth
            onPress={onCreateNew}
          />
        </View>
      ) : (
        <>
          {/* Scrolls rather than growing: a user with twenty categories must still be able
              to reach the New category button under the list. */}
          <ScrollView style={styles.list}>
            {categories.map((category, index) => {
              const selected = category.id === selectedId;
              return (
                <Row
                  key={category.id}
                  testID={`category-option-${category.id}`}
                  onPress={() => onSelect(category.id)}
                  lastInGroup={index === categories.length - 1}
                  leading={<Swatch colorHex={category.color} />}
                  accessibilityLabel={category.name}
                  // Carried as state, not only by the glyph: a check mark is a visual cue
                  // (`00-foundations.md` §8 rule 4).
                  accessibilityState={{ selected }}
                  trailing={
                    selected ? (
                      <Feather
                        testID={`${CATEGORY_PICKER_CHECK_TEST_ID}-${category.id}`}
                        name="check"
                        size={20}
                        color={color.primary.default}
                      />
                    ) : null
                  }
                >
                  <RowTitle>{category.name}</RowTitle>
                </Row>
              );
            })}
          </ScrollView>

          <View style={styles.footer}>
            <Button
              testID="category-picker-new"
              label={COPY.picker.category.new}
              variant="ghost"
              fullWidth
              onPress={onCreateNew}
            />
          </View>
        </>
      )}
    </Sheet>
  );
}

const useStyles = createStyles((color) =>
  StyleSheet.create({
    list: {
      // A cap rather than a height, so a short list does not leave a gap below it.
      maxHeight: 360,
    },
    footer: {
      paddingTop: space[2],
    },
    empty: {
      alignItems: 'center',
      gap: space[4],
      paddingVertical: space[6],
    },
    emptyHeadline: {
      ...type.title2,
      color: color.text.primary,
    },
  }),
);
