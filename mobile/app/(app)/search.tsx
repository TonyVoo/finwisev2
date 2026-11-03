import { useCallback, useEffect, useState } from 'react';
import { SectionList, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppBar, IconButton } from '@/components/Chrome';
import { EmptyIcon } from '@/components/EmptyIcon';
import { useSnackbar } from '@/components/Snackbar';
import { COPY } from '@/copy/strings';
import { useDatabase } from '@/db/DatabaseProvider';
import {
  useExpenseSearch,
  useExpenseSearchSummary,
  useLiveCategories,
  useUserCurrency,
} from '@/db/hooks';
import { isSearchActive } from '@/db/queries';
import { ExpenseRow } from '@/expenses/ExpenseRow';
import { SearchEmpty } from '@/expenses/ListStates';
import { SearchBar } from '@/expenses/SearchBar';
import { groupByDate } from '@/expenses/listModel';
import { useDeleteExpense } from '@/expenses/useDeleteExpense';
import { useAddedBy } from '@/household/useAddedBy';
import { SelectButton } from '@/household/SelectButton';
import { SelectionBar } from '@/household/SelectionBar';
import { useExpenseSelection } from '@/household/useExpenseSelection';
import { useInHousehold } from '@/household/useInHousehold';
import { parseAmount } from '@/import/planImport';
import { currencyDecimals, formatMoney } from '@/lib/money';
import { FiltersSheet } from '@/search/FiltersSheet';
import { activeFilterCount, toSearch } from '@/search/filterModel';
import {
  type DatePreset,
  type SavedSearch,
  readSavedSearches,
  removeSavedSearch,
  saveSearch,
} from '@/search/savedSearches';
import { plainAmount } from '@/export/csv';
import { useSelectedMonth } from '@/month/MonthProvider';
import { space, type } from '@/theme/tokens';
import { createStyles, useColors } from '@/theme/ThemeProvider';

/**
 * Search: a screen of its own, opened from the magnifier on Home.
 *
 * It looks across every month, so the month switcher and the month total have no place here;
 * what it shows instead is how many expenses matched and what they add up to. Which rows match
 * is `db/queries.ts`'s business (`searchExpenses`); this only collects what was typed and
 * tapped. Local screen state: leaving discards it, and nothing about it is worth restoring.
 */
export default function SearchScreen() {
  const color = useColors();
  const styles = useStyles();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { today } = useSelectedMonth();
  const addedBy = useAddedBy();
  const onDelete = useDeleteExpense();
  const categories = useLiveCategories();
  const currency = useUserCurrency().data ?? null;
  const inHousehold = useInHousehold();
  const selection = useExpenseSelection();

  const [text, setText] = useState('');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [privateOnly, setPrivateOnly] = useState(false);
  const [kind, setKind] = useState<'expense' | 'income' | null>(null);
  const [minText, setMinText] = useState('');
  const [maxText, setMaxText] = useState('');
  const [range, setRange] = useState<DatePreset | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const database = useDatabase();
  const queryClient = useQueryClient();
  const showSnackbar = useSnackbar();
  const decimals = currencyDecimals(currency ?? 'USD');
  const amountOf = (text: string) => (text.trim() === '' ? null : parseAmount(text, decimals));
  const saved = useQuery({
    queryKey: ['local', 'search', 'saved'] as const,
    queryFn: () => readSavedSearches(database),
  });
  const refreshSaved = useCallback(
    () => queryClient.invalidateQueries({ queryKey: ['local', 'search', 'saved'] }),
    [queryClient],
  );
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    // Clearing is immediate; typing waits 200ms so a query is not run per keystroke.
    if (text === '') {
      setDebounced('');
      return undefined;
    }
    const handle = setTimeout(() => setDebounced(text), 200);
    return () => clearTimeout(handle);
  }, [text]);

  const filters = {
    text: debounced,
    categoryId,
    kind,
    minMinor: amountOf(minText),
    maxMinor: amountOf(maxText),
    range,
  };
  const search = {
    ...toSearch(filters, today),
    privateOnly: inHousehold && privateOnly,
  };
  const searching = isSearchActive(search);
  const none = { text: '', categoryId: null, privateOnly: false };

  const applySaved = (view: SavedSearch) => {
    setText(view.search.text);
    setDebounced(view.search.text);
    setCategoryId(view.search.categoryId);
    setKind(view.search.kind ?? null);
    setMinText(
      view.search.minMinor === undefined || view.search.minMinor === null
        ? ''
        : plainAmount(view.search.minMinor, decimals),
    );
    setMaxText(
      view.search.maxMinor === undefined || view.search.maxMinor === null
        ? ''
        : plainAmount(view.search.maxMinor, decimals),
    );
    setRange(view.search.range ?? null);
    setFiltersOpen(false);
  };
  const rows = useExpenseSearch(searching ? search : none);
  const summary = useExpenseSearchSummary(searching ? search : none);
  const sections = groupByDate(searching ? (rows.data ?? []) : [], today);

  return (
    <View style={styles.screen}>
      <AppBar
        title={COPY.home.search.open}
        leading={
          <IconButton
            icon="chevron-left"
            label={COPY.common.back}
            onPress={() => router.back()}
            tint={color.text.primary}
            testID="search-back"
          />
        }
        trailing={<SelectButton selection={selection} testID="search-select" />}
      />

      {selection.active ? <SelectionBar selection={selection} /> : null}

      <SearchBar
        text={text}
        onChangeText={setText}
        categoryId={categoryId}
        onChangeCategory={setCategoryId}
        categories={categories.data ?? []}
        privateOnly={privateOnly}
        onChangePrivateOnly={inHousehold ? setPrivateOnly : undefined}
        filterCount={activeFilterCount(filters)}
        onOpenFilters={() => setFiltersOpen(true)}
      />

      <FiltersSheet
        visible={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        kind={kind}
        onKind={setKind}
        minText={minText}
        onMinText={setMinText}
        maxText={maxText}
        onMaxText={setMaxText}
        range={range}
        onRange={setRange}
        onClear={() => {
          setKind(null);
          setMinText('');
          setMaxText('');
          setRange(null);
        }}
        saved={saved.data ?? []}
        onApplySaved={applySaved}
        onRemoveSaved={(id) => void removeSavedSearch(database, id).then(refreshSaved)}
        onSave={(name) => {
          void saveSearch(database, name, filters).then(refreshSaved);
          showSnackbar({ message: COPY.searchFilters.saveDone });
        }}
      />

      {searching ? (
        // Across every month, so this is the aggregate over all matches, not over the page.
        <Text testID="search-summary" style={styles.summary} accessibilityLiveRegion="polite">
          {summary.data === undefined || currency === null
            ? ' '
            : `${
                summary.data.count === 1
                  ? COPY.home.search.resultsOne
                  : COPY.home.search.resultsMany.replace('{count}', String(summary.data.count))
              } · ${formatMoney(summary.data.totalMinor, currency)}`}
        </Text>
      ) : null}

      <SectionList
        sections={sections}
        keyExtractor={(item) => item.id}
        stickySectionHeadersEnabled={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerStyle={{ paddingBottom: insets.bottom + space[4] }}
        renderSectionHeader={({ section }) => (
          <Text style={styles.sectionHeader} accessibilityRole="header">
            {section.title}
          </Text>
        )}
        renderItem={({ item, index, section }) => (
          <ExpenseRow
            item={item}
            today={today}
            lastInGroup={index === section.data.length - 1}
            addedBy={addedBy(item.createdBy)}
            {...selection.rowProps(item, () => router.push(`/(app)/expense/${item.id}`))}
            onDelete={() => void onDelete(item.id)}
          />
        )}
        ListEmptyComponent={
          searching ? (
            rows.isPending ? null : (
              <SearchEmpty />
            )
          ) : (
            <View testID="search-prompt" style={styles.prompt}>
              <EmptyIcon name="search" />
              <Text style={styles.promptText}>{COPY.home.search.placeholder}</Text>
            </View>
          )
        }
      />
    </View>
  );
}

const useStyles = createStyles((color) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: color.bg.canvas },
    summary: {
      ...type.callout,
      color: color.text.secondary,
      paddingHorizontal: space[4],
      paddingVertical: space[2],
    },
    sectionHeader: {
      ...type.caption,
      color: color.text.tertiary,
      paddingHorizontal: space[4],
      paddingTop: space[3],
      paddingBottom: space[1],
    },
    prompt: { alignItems: 'center', gap: space[2], padding: space[8] },
    promptText: { ...type.body, color: color.text.secondary, textAlign: 'center' },
  }),
);
