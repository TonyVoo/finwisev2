import { Pressable, StyleSheet, Text, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { COPY } from '../copy/strings';
import {
  CATEGORY_COLOR_NAMES,
  CATEGORY_PICKER_ORDER,
  type CategoryColorToken,
  categoryColor,
  displayCategoryColor,
  radius,
  space,
  type,
} from '../theme/tokens';
import { createStyles, useColors, useTheme } from '../theme/ThemeProvider';

/**
 * The colour picker: `docs/design/07-categories.md` §2 element 7 and §5 rule 6.
 *
 * **Nine colours, not ten.** `category.slate` is reserved for the `isDefault` category so
 * the fallback stays visually consistent, and the order is the Designer's
 * `categoryPickerOrder` rather than object order (§2 rule 1).
 *
 * Selection is carried three ways and the redundancy is the requirement: the ring is a
 * purely visual cue, so it is paired with a `check` glyph **and** with
 * `accessibilityState={{ selected }}`. §5 rule 6 is explicit - "never by the ring alone".
 * Each swatch is also labelled by **colour name**, because "the purple one" is not
 * something a screen-reader user can act on.
 *
 * **Colour is not unique.** Two categories may share one: the name disambiguates, and
 * forcing uniqueness would make the tenth category impossible. A colour already worn by a
 * live category gets an `In use` caption so a user who wants distinct colours can avoid
 * collisions without being blocked by a rule (§2 rule 5).
 */

export const COLOUR_SWATCH_TEST_ID_PREFIX = 'colour';
export const COLOUR_CHECK_TEST_ID = 'colour-check';

export interface ColourPickerProps {
  readonly selected: string;
  readonly onSelect: (hex: string) => void;
  /** Hex values worn by a live category, for the `In use` captions. */
  readonly coloursInUse: readonly string[];
}

/**
 * The first colour the picker offers that nothing is using yet, or the first in the order
 * when every one is taken (`00-foundations.md` §1.3, the create sheet's `default` state).
 */
export function firstUnusedColour(coloursInUse: readonly string[]): string {
  const taken = new Set(coloursInUse.map((hex) => hex.toLowerCase()));
  const free = CATEGORY_PICKER_ORDER.find(
    (token) => !taken.has(categoryColor[token].toLowerCase()),
  );
  return categoryColor[free ?? CATEGORY_PICKER_ORDER[0]];
}

export function ColourPicker({ selected, onSelect, coloursInUse }: ColourPickerProps) {
  const styles = useStyles();
  const taken = new Set(coloursInUse.map((hex) => hex.toLowerCase()));

  return (
    <View>
      <Text style={styles.label} accessibilityRole="header">
        {COPY.category.field.colour}
      </Text>
      <View style={styles.grid}>
        {CATEGORY_PICKER_ORDER.map((token) => (
          <Swatch
            key={token}
            token={token}
            selected={categoryColor[token].toLowerCase() === selected.toLowerCase()}
            inUse={taken.has(categoryColor[token].toLowerCase())}
            onSelect={onSelect}
          />
        ))}
      </View>
    </View>
  );
}

function Swatch({
  token,
  selected,
  inUse,
  onSelect,
}: {
  readonly token: CategoryColorToken;
  readonly selected: boolean;
  readonly inUse: boolean;
  readonly onSelect: (hex: string) => void;
}) {
  const { isDark } = useTheme();
  const color = useColors();
  const styles = useStyles();
  const hex = categoryColor[token];

  return (
    <View style={styles.cell}>
      <Pressable
        testID={`${COLOUR_SWATCH_TEST_ID_PREFIX}-${token}`}
        onPress={() => onSelect(hex)}
        // No `hitSlop`: the ring wrapper's 2px border and 2px padding already take the
        // 40x40 swatch to a 48x48 target, past the 44 floor. Adding the shared
        // `HIT_SLOP_44` on top would extend each swatch 12pt into its neighbours and make
        // a tap between two of them ambiguous - the grid's gap is smaller than that.
        accessibilityRole="button"
        accessibilityLabel={CATEGORY_COLOR_NAMES[token]}
        accessibilityState={{ selected }}
        // The ring is drawn by this wrapper and the fill by the view inside it, which is
        // what produces element 7's "2px ring with a 2px `bg.surface` inset gap": the gap
        // is this border's padding, so it reads as a gap at any pixel density rather than
        // depending on an outline property's platform support.
        style={[styles.ring, selected ? styles.ringSelected : null]}
      >
        <View style={[styles.swatch, { backgroundColor: displayCategoryColor(hex, isDark) }]}>
          {selected ? (
            <Feather
              testID={COLOUR_CHECK_TEST_ID}
              name="check"
              size={20}
              color={color.text.inverse}
            />
          ) : null}
        </View>
      </Pressable>
      {/* Additive information, not a warning: the sheet shows no error for a colour in use. */}
      {inUse ? <Text style={styles.inUse}>{COPY.category.colour.inUse}</Text> : null}
    </View>
  );
}

/**
 * The `isDefault` category's colour row: one non-interactive swatch and a caption.
 *
 * §3 rule 2 - the fallback category can be renamed but its colour is read-only, because
 * `category.slate` is reserved. Rendered as a different control rather than a disabled
 * picker: there is nothing here the user could choose, so offering nine choices and
 * refusing all of them would be worse than not offering them.
 */
export function ReservedColour({ hex }: { readonly hex: string }) {
  const { isDark } = useTheme();
  const styles = useStyles();
  return (
    <View>
      <Text style={styles.label} accessibilityRole="header">
        {COPY.category.field.colour}
      </Text>
      <View style={styles.grid}>
        <View
          testID="colour-reserved"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={[styles.swatch, { backgroundColor: displayCategoryColor(hex, isDark) }]}
        />
      </View>
      <Text style={styles.reserved}>{COPY.category.colour.reserved}</Text>
    </View>
  );
}

const useStyles = createStyles((color) =>
  StyleSheet.create({
    label: {
      ...type.subhead,
      color: color.text.secondary,
      marginBottom: space[2],
    },
    grid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: space[3],
    },
    cell: {
      alignItems: 'center',
      gap: space[1],
    },
    ring: {
      // Transparent when unselected, so selecting one does not resize the grid.
      borderWidth: 2,
      borderColor: 'transparent',
      borderRadius: radius.md + 4,
      padding: 2,
    },
    ringSelected: {
      borderColor: color.text.primary,
    },
    swatch: {
      width: 40,
      height: 40,
      borderRadius: radius.md,
      alignItems: 'center',
      justifyContent: 'center',
    },
    inUse: {
      ...type.caption,
      color: color.text.tertiary,
    },
    reserved: {
      ...type.footnote,
      color: color.text.tertiary,
      marginTop: space[2],
    },
  }),
);
