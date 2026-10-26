import { useCallback, useState } from 'react';
import { AccessibilityInfo, FlatList, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { AppBar, Fab, IconButton, PendingGlyph, SkeletonBlock } from '@/components/Chrome';
import { Dialog } from '@/components/Dialog';
import { Row, RowTitle, Swatch } from '@/components/Row';
import { SwipeToDelete } from '@/components/SwipeToDelete';
import { useSnackbar } from '@/components/Snackbar';
import {
  CategoryFormSheet,
  type CategoryDraft,
  type EditedCategory,
} from '@/categories/CategoryFormSheet';
import { categoryRowLabel } from '@/categories/categoryModel';
import {
  COPY,
  categoryCreated,
  categoryDeleteBlocked,
  categoryDeleteBody,
  categoryDeleteTitle,
  categoryDeleted,
  categoryUpdated,
} from '@/copy/strings';
import {
  useCategoriesWithCounts,
  useColoursInUse,
  useFallbackCategory,
  useUserCurrency,
} from '@/db/hooks';
import { useDatabase } from '@/db/DatabaseProvider';
import { useLocalWrite } from '@/db/localWrite';
import {
  CategoryNotDeletableError,
  createCategory,
  deleteCategoryWithReassignment,
  updateCategory,
} from '@/db/mutations';
import { countCategoryExpenses, isCategoryNameTaken, type CategoryWithCount } from '@/db/queries';
import { color, size, space, type } from '@/theme/tokens';

/**
 * Category management: `docs/design/07-categories.md`.
 *
 * The screen's whole job, beyond listing, is to make one thing unmistakable: **deleting a
 * category moves its expenses rather than destroying them.** The dialog says so twice -
 * "will move to {fallbackName}" and "They won't be deleted." - which is the one place in
 * the app where the copy is deliberately redundant, because `Delete` is the louder word in
 * that dialog and losing spend history is the actual fear (§4 rule 2).
 *
 * ### Why the `isDefault` row is guarded three times over
 *
 * It has **no swipe action** (§1 rule 4), **no Delete button in its sheet** (§3 rule 3),
 * and the server answers `category_not_deletable` (§4 rule 12). The first two are not
 * belt-and-braces: "offering an action that always fails is worse than not offering it".
 * The snackbar exists for the one remaining path - an `accessibilityAction` on a row - and
 * says what the category is *for*, not merely that the delete was refused.
 *
 * ### Counts
 *
 * **All-time and local, never month-scoped** (§1 rule 1). The delete dialog promises "its
 * {count} expenses will move", so a count that silently meant "this month" would make that
 * promise wrong.
 */

export const CATEGORY_ROW_TEST_ID_PREFIX = 'category-row';
export const DELETE_DIALOG_TEST_ID = 'category-delete-dialog';

/** What the delete dialog is asking about. Null when no dialog is up. */
interface PendingDelete {
  readonly category: CategoryWithCount;
  /** Read when the dialog opens, so it cannot be stale (§4 rule 1). */
  readonly count: number;
  readonly fallbackName: string;
}

export default function CategoriesScreen() {
  const router = useRouter();
  const database = useDatabase();
  const showSnackbar = useSnackbar();
  const localWrite = useLocalWrite();

  const categories = useCategoriesWithCounts();
  // Decides the budget field's decimals only. Categories render before it resolves, and the
  // sheet cannot be reached faster than a local read, so the fallback is never seen.
  const currencyCode = useUserCurrency().data ?? 'USD';
  const fallback = useFallbackCategory();
  const coloursInUse = useColoursInUse();

  const [editing, setEditing] = useState<EditedCategory | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);

  const rows = categories.data ?? [];
  const fallbackName = fallback.data?.name ?? COPY.category.new.title;

  /** Refuse, and say what the fallback category is for (§4 rule 12). */
  const refuseDelete = useCallback(
    (name: string) => {
      const message = categoryDeleteBlocked(name);
      showSnackbar({ message });
      AccessibilityInfo.announceForAccessibility(message);
    },
    [showSnackbar],
  );

  const askToDelete = useCallback(
    async (category: CategoryWithCount) => {
      if (category.isDefault) {
        refuseDelete(fallback.data?.name ?? category.name);
        return;
      }
      // Counted at the moment the dialog opens rather than taken from the list render,
      // so the number the user is shown cannot be stale (§4 rule 1).
      const count = await countCategoryExpenses(database, category.id);
      setPendingDelete({ category, count, fallbackName });
    },
    [database, fallback.data?.name, fallbackName, refuseDelete],
  );

  const confirmDelete = useCallback(async () => {
    if (pendingDelete === null) return;
    const { category } = pendingDelete;
    setPendingDelete(null);

    try {
      const result = await localWrite((db) => deleteCategoryWithReassignment(db, category.id));
      // The snackbar reports what happened, not that it happened - including the
      // reassignment count, which is the only confirmation the expenses survived, so it
      // must not be visual-only (§5 rule 8).
      const message = categoryDeleted(category.name, result.movedCount, result.fallbackName);
      showSnackbar({ message });
      AccessibilityInfo.announceForAccessibility(message);
    } catch (error) {
      // Reachable only by a race - the row became the fallback, or vanished - since the
      // row offered no delete for an `isDefault` category.
      if (error instanceof CategoryNotDeletableError) {
        refuseDelete(error.fallbackName);
        return;
      }
      throw error;
    }
  }, [pendingDelete, localWrite, showSnackbar, refuseDelete]);

  const submitSheet = useCallback(
    async ({ name, color: hex, monthlyBudgetMinor }: CategoryDraft) => {
      if (editing === null) {
        await localWrite((db) => createCategory(db, { name, color: hex, monthlyBudgetMinor }));
        setSheetOpen(false);
        showSnackbar({ message: categoryCreated(name) });
        return;
      }
      // A rename is one UPDATE plus one outbox row. Expenses are untouched: they
      // reference `categoryId`, so a rename is invisible to them (§3 rule 5).
      await localWrite((db) =>
        updateCategory(db, editing.id, { name, color: hex, monthlyBudgetMinor }),
      );
      setSheetOpen(false);
      showSnackbar({ message: categoryUpdated(name) });
    },
    [editing, localWrite, showSnackbar],
  );

  return (
    <View style={styles.screen}>
      <AppBar
        title={COPY.categories.title}
        leading={
          <IconButton
            icon="chevron-left"
            label={COPY.common.back}
            onPress={() => router.back()}
            tint={color.text.primary}
            testID="categories-back"
          />
        }
      />

      <FlatList
        data={rows}
        keyExtractor={(category) => category.id}
        contentContainerStyle={styles.list}
        renderItem={({ item, index }) => (
          <CategoryRow
            category={item}
            lastInGroup={index === rows.length - 1}
            onPress={() => {
              setEditing(item);
              setSheetOpen(true);
            }}
            onDelete={() => void askToDelete(item)}
          />
        )}
        ListEmptyComponent={categories.isPending ? <ListSkeleton /> : null}
      />

      <Fab
        label={COPY.categories.fab}
        onPress={() => {
          setEditing(null);
          setSheetOpen(true);
        }}
        testID="categories-fab"
      />

      <CategoryFormSheet
        currency={currencyCode}
        visible={sheetOpen}
        onClose={() => setSheetOpen(false)}
        editing={editing}
        coloursInUse={coloursInUse.data ?? []}
        isNameTaken={(name) => isCategoryNameTaken(database, name, editing?.id)}
        onSubmit={submitSheet}
        // No Delete in create mode, and none on the `isDefault` row (§3 rule 3).
        onDelete={
          editing === null || editing.isDefault
            ? undefined
            : () => {
                const found = rows.find((row) => row.id === editing.id);
                if (found === undefined) return;
                setSheetOpen(false);
                void askToDelete(found);
              }
        }
      />

      <Dialog
        visible={pendingDelete !== null}
        title={pendingDelete === null ? '' : categoryDeleteTitle(pendingDelete.category.name)}
        body={
          pendingDelete === null
            ? undefined
            : categoryDeleteBody(pendingDelete.count, pendingDelete.fallbackName)
        }
        // "Delete category", not "Delete": in a dialog about expenses moving, a bare
        // "Delete" invites misreading it as deleting them (§4 rule 4).
        destructive={{ label: COPY.category.delete, onPress: () => void confirmDelete() }}
        onCancel={() => setPendingDelete(null)}
        testID={DELETE_DIALOG_TEST_ID}
      />
    </View>
  );
}

function CategoryRow({
  category,
  lastInGroup,
  onPress,
  onDelete,
}: {
  readonly category: CategoryWithCount;
  readonly lastInGroup: boolean;
  readonly onPress: () => void;
  readonly onDelete: () => void;
}) {
  const row = (
    <Row
      testID={`${CATEGORY_ROW_TEST_ID_PREFIX}-${category.id}`}
      onPress={onPress}
      chevron
      lastInGroup={lastInGroup}
      leading={<Swatch colorHex={category.color} />}
      accessibilityLabel={categoryRowLabel(category)}
      accessibilityHint="Double tap to edit this category."
      // The `isDefault` row exposes **no** delete action, so assistive technology is not
      // offered one that always fails (§5 rule 3).
      accessibilityActions={
        category.isDefault ? undefined : [{ name: 'delete', label: `Delete ${category.name}` }]
      }
      onAccessibilityAction={(event) => {
        if (event.nativeEvent.actionName === 'delete') onDelete();
      }}
      trailing={
        <View style={styles.trailing}>
          {category.pending ? <PendingGlyph /> : null}
          <Text style={styles.count}>{category.expenseCount}</Text>
        </View>
      }
    >
      <RowTitle>{category.name}</RowTitle>
    </Row>
  );

  // No swipe action at all on the fallback row - not revealed then blocked (§1 rule 4).
  if (category.isDefault) return row;

  return (
    <SwipeToDelete
      onDelete={onDelete}
      actionLabel={COPY.common.delete}
      testID={`category-swipe-${category.id}`}
    >
      {row}
    </SwipeToDelete>
  );
}

/** State `loading:first-paint`: four skeleton rows, resolved with the count query. */
function ListSkeleton() {
  return (
    <View
      testID="categories-skeleton"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {[0, 1, 2, 3].map((index) => (
        <View key={index} style={styles.skeletonRow}>
          <SkeletonBlock width={size.swatch} height={size.swatch} />
          <SkeletonBlock width={120} height={16} />
          <View style={styles.skeletonSpacer} />
          <SkeletonBlock width={24} height={16} />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: color.bg.canvas,
  },
  list: {
    paddingBottom: size.fab + space[4] + space[4],
  },
  trailing: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
  },
  count: {
    ...type.callout,
    color: color.text.tertiary,
    fontVariant: ['tabular-nums'],
  },
  skeletonRow: {
    minHeight: size.rowMinHeight,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: color.bg.surface,
    paddingHorizontal: space[4],
    gap: space[3],
  },
  skeletonSpacer: {
    flex: 1,
  },
});
