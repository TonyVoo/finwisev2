import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button } from '../components/Button';
import { Row, RowTitle } from '../components/Row';
import { Sheet } from '../components/Sheet';
import { TextField } from '../components/TextField';
import { COPY } from '../copy/strings';
import { radius, space, type } from '../theme/tokens';
import { createStyles } from '../theme/ThemeProvider';
import type { DatePreset, SavedSearch } from './savedSearches';

/**
 * The filters behind the Filters chip on Search: spending or income, an amount range, a date preset, and the
 * searches saved to run again. Controlled; what the filters mean is `filterModel.ts` and `db/queries.ts`.
 */

export const FILTERS_SHEET_TEST_ID = 'filters-sheet';
export const FILTER_MIN_TEST_ID = 'filter-min';
export const FILTER_MAX_TEST_ID = 'filter-max';
export const FILTER_SAVE_NAME_TEST_ID = 'filter-save-name';
export const FILTER_SAVE_TEST_ID = 'filter-save';
export const FILTER_CLEAR_TEST_ID = 'filter-clear';
export const SAVED_SEARCH_TEST_ID_PREFIX = 'saved-search';

export interface FiltersSheetProps {
  readonly visible: boolean;
  readonly onClose: () => void;
  readonly kind: 'expense' | 'income' | null;
  readonly onKind: (next: 'expense' | 'income' | null) => void;
  readonly minText: string;
  readonly onMinText: (next: string) => void;
  readonly maxText: string;
  readonly onMaxText: (next: string) => void;
  readonly range: DatePreset | null;
  readonly onRange: (next: DatePreset | null) => void;
  readonly onClear: () => void;
  readonly saved: readonly SavedSearch[];
  readonly onApplySaved: (saved: SavedSearch) => void;
  readonly onRemoveSaved: (id: string) => void;
  readonly onSave: (name: string) => void;
}

export function FiltersSheet(props: FiltersSheetProps) {
  const styles = useStyles();
  const [name, setName] = useState('');
  const copy = COPY.searchFilters;
  const presets: readonly (readonly [DatePreset | null, string])[] = [
    [null, copy.anyTime],
    ['thisMonth', copy.thisMonth],
    ['lastMonth', copy.lastMonth],
    ['last3Months', copy.last3Months],
    ['thisYear', copy.thisYear],
  ];
  const kinds: readonly (readonly ['expense' | 'income' | null, string])[] = [
    [null, copy.typeAll],
    ['expense', copy.typeSpending],
    ['income', copy.typeIncome],
  ];

  return (
    <Sheet
      visible={props.visible}
      title={copy.filtersTitle}
      onClose={props.onClose}
      testID={FILTERS_SHEET_TEST_ID}
    >
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.body}>
        <Text style={styles.label}>{copy.type}</Text>
        <View style={styles.chips}>
          {kinds.map(([value, label]) => (
            <Chip
              key={label}
              testID={`filter-kind-${value ?? 'all'}`}
              label={label}
              selected={props.kind === value}
              onPress={() => props.onKind(value)}
            />
          ))}
        </View>

        <Text style={styles.label}>{copy.amount}</Text>
        <View style={styles.amounts}>
          <View style={styles.amountField}>
            <TextField
              label={copy.amountMin}
              value={props.minText}
              onChangeText={props.onMinText}
              keyboardType="decimal-pad"
              testID={FILTER_MIN_TEST_ID}
            />
          </View>
          <View style={styles.amountField}>
            <TextField
              label={copy.amountMax}
              value={props.maxText}
              onChangeText={props.onMaxText}
              keyboardType="decimal-pad"
              testID={FILTER_MAX_TEST_ID}
            />
          </View>
        </View>

        <Text style={styles.label}>{copy.dates}</Text>
        <View style={styles.chips}>
          {presets.map(([value, label]) => (
            <Chip
              key={label}
              testID={`filter-range-${value ?? 'any'}`}
              label={label}
              selected={props.range === value}
              onPress={() => props.onRange(value)}
            />
          ))}
        </View>

        <Button
          label={copy.clearFilters}
          variant="secondary"
          onPress={props.onClear}
          fullWidth
          testID={FILTER_CLEAR_TEST_ID}
        />

        <Text style={styles.label}>{copy.savedTitle}</Text>
        {props.saved.map((saved, index) => (
          <View key={saved.id} style={styles.savedRow}>
            <View style={styles.savedName}>
              <Row
                testID={`${SAVED_SEARCH_TEST_ID_PREFIX}-${index}`}
                onPress={() => props.onApplySaved(saved)}
                lastInGroup
                accessibilityLabel={saved.name}
              >
                <RowTitle>{saved.name}</RowTitle>
              </Row>
            </View>
            <Pressable
              testID={`${SAVED_SEARCH_TEST_ID_PREFIX}-remove-${index}`}
              accessibilityRole="button"
              accessibilityLabel={`${copy.remove} ${saved.name}`}
              onPress={() => props.onRemoveSaved(saved.id)}
              hitSlop={8}
            >
              <Text style={styles.remove}>{copy.remove}</Text>
            </Pressable>
          </View>
        ))}
        <TextField
          label={copy.saveName}
          value={name}
          onChangeText={setName}
          testID={FILTER_SAVE_NAME_TEST_ID}
        />
        <Button
          label={copy.saveCurrent}
          onPress={() => {
            props.onSave(name);
            setName('');
          }}
          fullWidth
          testID={FILTER_SAVE_TEST_ID}
        />
      </ScrollView>
    </Sheet>
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
    body: { gap: space[2], paddingBottom: space[4] },
    label: { ...type.subhead, color: color.text.secondary, marginTop: space[2] },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
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
    amounts: { flexDirection: 'row', gap: space[2] },
    amountField: { flex: 1 },
    savedRow: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
    savedName: { flex: 1 },
    remove: { ...type.footnote, color: color.danger.default },
  }),
);
