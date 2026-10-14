import { act, screen, userEvent, waitFor } from '@testing-library/react-native';
import { COPY, VALIDATION_COPY } from '@/copy/strings';
import { categoryColor } from '@/theme/tokens';
import type { SqliteDatabase } from '@/db/sqlite';
import {
  CATEGORY_ROW_TEST_ID_PREFIX,
  DELETE_DIALOG_TEST_ID,
} from '../../app/(app)/settings/categories';
import CategoriesScreen from '../../app/(app)/settings/categories';
import { resetRouter } from '../support/router';
import { mountScreen, type MountedScreen } from '../support/mount';
import {
  categoryId,
  entryAt,
  expenseId,
  outboxEntries,
  seedCategory,
  seedExpense,
  seedFallbackCategory,
} from '../support/seed';

jest.mock('expo-router');

/**
 * Category management: `docs/design/07-categories.md`.
 *
 * Driven over a real container, so the delete-with-reassignment case asserts on the rows
 * and the outbox entries the operation actually produced. That one flow is "the flow the
 * acceptance criteria single out, and the one with the most ways to be subtly wrong", and
 * every one of those ways is invisible on screen: a cascade instead of a reassignment, a
 * tombstoned expense moved for no reason, an outbox entry missing for one of the records.
 */

const NOW = new Date(2026, 9, 14, 9, 0, 0);
const GROCERIES = categoryId(1);
const HEALTH = categoryId(2);
const FALLBACK = categoryId(99);

/** Four categories, with Groceries holding three live expenses and one tombstoned. */
async function seedCategories(database: SqliteDatabase): Promise<void> {
  await seedFallbackCategory(database);
  await seedCategory(database, { id: GROCERIES, name: 'Groceries', color: categoryColor.green });
  await seedCategory(database, { id: HEALTH, name: 'Health', color: categoryColor.red });

  await seedExpense(database, {
    id: expenseId(1),
    categoryId: GROCERIES,
    amountMinor: 1250,
    date: '2026-10-14',
  });
  await seedExpense(database, {
    id: expenseId(2),
    categoryId: GROCERIES,
    amountMinor: 900,
    date: '2026-09-02',
  });
  await seedExpense(database, {
    id: expenseId(3),
    categoryId: GROCERIES,
    amountMinor: 700,
    date: '2026-08-11',
  });
  // Already deleted: it must not be moved and must not be counted.
  await seedExpense(database, {
    id: expenseId(4),
    categoryId: GROCERIES,
    amountMinor: 5000,
    date: '2026-10-01',
    deletedAt: '2026-10-02T00:00:00.000Z',
  });
  await seedExpense(database, {
    id: expenseId(5),
    categoryId: FALLBACK,
    amountMinor: 100,
    date: '2026-10-05',
  });
}

async function mountCategories(
  seed: (database: SqliteDatabase) => Promise<void> = seedCategories,
): Promise<MountedScreen> {
  const mounted = await mountScreen(<CategoriesScreen />, { clock: () => NOW, seed });
  await waitFor(() =>
    expect(screen.queryByTestId(`${CATEGORY_ROW_TEST_ID_PREFIX}-${FALLBACK}`)).not.toBeNull(),
  );
  return mounted;
}

function rowLabel(id: string): string {
  return screen.getByTestId(`${CATEGORY_ROW_TEST_ID_PREFIX}-${id}`).props
    .accessibilityLabel as string;
}

/** Trigger a row's `delete` accessibility action - the screen-reader path to delete. */
async function deleteFromRow(id: string): Promise<void> {
  await act(async () => {
    screen
      .getByTestId(`${CATEGORY_ROW_TEST_ID_PREFIX}-${id}`)
      .props.onAccessibilityAction({ nativeEvent: { actionName: 'delete' } });
  });
}

beforeEach(() => {
  resetRouter();
});

describe('the category list', () => {
  it('lists every live category with its count', async () => {
    await mountCategories();

    // Three live expenses under Groceries; the tombstoned one is excluded.
    expect(rowLabel(GROCERIES)).toBe('Groceries, 3 expenses');
    expect(rowLabel(HEALTH)).toBe('Health, No expenses');
    expect(rowLabel(FALLBACK)).toBe('Uncategorized, 1 expense, cannot be deleted');
  });

  it('counts every month, not the month Home is showing', async () => {
    // §1 rule 1. The three Groceries expenses are in October, September and August; a
    // count that silently meant "this month" would say 1 and make the delete dialog's
    // promise wrong.
    await mountCategories();

    expect(rowLabel(GROCERIES)).toContain('3 expenses');
  });

  it('pins the default category last, whatever it is called', async () => {
    // §1 state `default`, via the query's `ORDER BY c.isDefault, c.name COLLATE NOCASE`.
    // Renamed to `Aaa` here, which would sort first alphabetically - the flag is what
    // decides, because the last row is also the one with no swipe action.
    await mountCategories(async (database) => {
      await seedFallbackCategory(database, { name: 'Aaa' });
      await seedCategory(database, { id: GROCERIES, name: 'Groceries' });
      await seedCategory(database, { id: HEALTH, name: 'Health' });
    });

    const order = screen
      .getAllByRole('button')
      .map((node) => node.props.accessibilityLabel as string)
      .filter((label) => /expenses|expense$/.test(label));

    expect(order[order.length - 1]).toContain('Aaa');
  });

  it('gives the default row no swipe action at all', async () => {
    // §1 rule 4: "it is not revealed-then-blocked, because offering an action that always
    // fails is worse than not offering it."
    await mountCategories();

    expect(screen.queryByTestId(`category-swipe-${FALLBACK}`)).toBeNull();
    expect(screen.getByTestId(`category-swipe-${GROCERIES}`)).toBeTruthy();
  });

  it('exposes no delete accessibility action on the default row', async () => {
    // §5 rule 3, the same reasoning carried to assistive technology.
    await mountCategories();

    expect(
      screen.getByTestId(`${CATEGORY_ROW_TEST_ID_PREFIX}-${FALLBACK}`).props.accessibilityActions,
    ).toBeUndefined();
    expect(
      screen.getByTestId(`${CATEGORY_ROW_TEST_ID_PREFIX}-${GROCERIES}`).props.accessibilityActions,
    ).toEqual([{ name: 'delete', label: 'Delete Groceries' }]);
  });
});

describe('creating a category', () => {
  it('writes the row and one outbox entry', async () => {
    // §2 rule 4: one row, one outbox entry, one transaction.
    const { database } = await mountCategories();

    await userEvent.press(screen.getByTestId('categories-fab'));
    await act(async () => {
      screen.getByTestId('category-name').props.onChangeText('Coffee');
    });
    await userEvent.press(screen.getByTestId('category-submit'));

    await waitFor(() => expect(screen.queryByText('Coffee created.')).not.toBeNull());
    const queued = await outboxEntries(database);
    expect(queued).toHaveLength(1);
    expect(entryAt(queued, 0).entity).toBe('category');
    const fields = JSON.parse(entryAt(queued, 0).fields) as Record<string, unknown>;
    expect(fields.name).toBe('Coffee');
    // `isDefault` is server-owned and is not a field the wire can carry, so a locally
    // created category is never a default (`entities.ts`).
    expect(fields).not.toHaveProperty('isDefault');
  });

  it('holds Create until a name is entered, and says why', async () => {
    await mountCategories();

    await userEvent.press(screen.getByTestId('categories-fab'));

    expect(screen.getByTestId('category-submit').props.accessibilityState).toEqual({
      disabled: true,
      busy: false,
    });
    expect(screen.getByText(VALIDATION_COPY.category.empty)).toBeTruthy();
  });

  it('refuses a name another live category already has', async () => {
    // §2 rule 3: unique among live categories, compared case-insensitively.
    await mountCategories();

    await userEvent.press(screen.getByTestId('categories-fab'));
    await act(async () => {
      screen.getByTestId('category-name').props.onChangeText('groceries');
    });
    await userEvent.press(screen.getByTestId('category-submit'));

    await waitFor(() =>
      expect(screen.queryByText('You already have a category called "groceries".')).not.toBeNull(),
    );
  });

  it('allows a name that only a deleted category holds', async () => {
    // §2 rule 3: "A name matching a deleted category is allowed; uniqueness is among live
    // rows only, as the contract specifies."
    const { database } = await mountCategories(async (db) => {
      await seedFallbackCategory(db);
      await seedCategory(db, { id: GROCERIES, name: 'Groceries' });
      await db.runAsync('UPDATE categories SET deletedAt = ? WHERE id = ?', [
        '2026-10-01T00:00:00.000Z',
        GROCERIES,
      ]);
    });

    await userEvent.press(screen.getByTestId('categories-fab'));
    await act(async () => {
      screen.getByTestId('category-name').props.onChangeText('Groceries');
    });
    await userEvent.press(screen.getByTestId('category-submit'));

    await waitFor(async () => expect(await outboxEntries(database)).toHaveLength(1));
  });
});

describe('renaming a category', () => {
  it('updates the row and leaves its expenses alone', async () => {
    // §3 rule 5: expenses reference `categoryId`, so a rename is invisible to them. If
    // they were touched, every one would be bumped onto the next sync page for nothing.
    const { database } = await mountCategories();

    await userEvent.press(screen.getByTestId(`${CATEGORY_ROW_TEST_ID_PREFIX}-${GROCERIES}`));
    await act(async () => {
      screen.getByTestId('category-name').props.onChangeText('Food');
    });
    await userEvent.press(screen.getByTestId('category-submit'));

    await waitFor(() => expect(screen.queryByText('Food updated.')).not.toBeNull());
    const queued = await outboxEntries(database);
    // One entry, for the category. Not four.
    expect(queued).toHaveLength(1);
    expect(entryAt(queued, 0).recordId).toBe(GROCERIES);
    const expenses = await database.getAllAsync<{ categoryId: string }>(
      'SELECT categoryId FROM expenses WHERE id = ?',
      [expenseId(1)],
    );
    expect(expenses[0]?.categoryId).toBe(GROCERIES);
  });

  it('holds Save until something differs', async () => {
    await mountCategories();

    await userEvent.press(screen.getByTestId(`${CATEGORY_ROW_TEST_ID_PREFIX}-${GROCERIES}`));

    expect(screen.getByText(VALIDATION_COPY.nochange)).toBeTruthy();
  });

  it('does not treat a category as a conflict with itself', async () => {
    // §3 rule 1. Saving without changing the name must not report a duplicate.
    await mountCategories();

    await userEvent.press(screen.getByTestId(`${CATEGORY_ROW_TEST_ID_PREFIX}-${GROCERIES}`));
    await act(async () => {
      screen.getByTestId('category-name').props.onChangeText('Groceries ');
    });

    expect(screen.queryByText('You already have a category called "Groceries".')).toBeNull();
  });

  it('lets the default category be renamed but not recoloured', async () => {
    // §3 rule 2: the contract permits the rename and nothing depends on its literal name.
    // Its colour is reserved, so the picker is replaced rather than disabled.
    await mountCategories();

    await userEvent.press(screen.getByTestId(`${CATEGORY_ROW_TEST_ID_PREFIX}-${FALLBACK}`));

    expect(screen.getByTestId('colour-reserved', { includeHiddenElements: true })).toBeTruthy();
    expect(screen.getByText(COPY.category.colour.reserved)).toBeTruthy();
    expect(screen.queryByTestId('colour-green')).toBeNull();
    // And no Delete button (§3 rule 3).
    expect(screen.queryByTestId('category-delete')).toBeNull();
  });
});

describe('deleting a category', () => {
  it('states the outcome twice, with an exact count', async () => {
    // §4 rule 2: "The copy states the outcome twice." And rule 1: the count is computed
    // when the dialog opens, so it cannot be stale.
    await mountCategories();

    await deleteFromRow(GROCERIES);

    expect(screen.getByText('Delete Groceries?')).toBeTruthy();
    expect(
      screen.getByText("Its 3 expenses will move to Uncategorized. They won't be deleted."),
    ).toBeTruthy();
    // Not a bare "Delete": in a dialog about expenses moving that invites misreading it
    // as deleting them (§4 rule 4).
    expect(screen.getByRole('button', { name: COPY.category.delete })).toBeTruthy();
  });

  it('says so plainly when there is nothing to move', async () => {
    await mountCategories();

    await deleteFromRow(HEALTH);

    expect(screen.getByText('Delete Health?')).toBeTruthy();
    expect(screen.getByText('It has no expenses.')).toBeTruthy();
  });

  it('reassigns the live expenses and tombstones the category', async () => {
    // §4 rule 6, the heart of this flow. Reassign, never cascade: losing spend history to
    // a category cleanup would be a data-loss bug, and the dialog has already promised
    // the user their expenses survive.
    const { database } = await mountCategories();
    await deleteFromRow(GROCERIES);

    await userEvent.press(screen.getByTestId(`${DELETE_DIALOG_TEST_ID}-confirm`));

    await waitFor(() =>
      expect(
        screen.queryByText('Groceries deleted. 3 expenses moved to Uncategorized.'),
      ).not.toBeNull(),
    );

    // The three live expenses now point at the fallback...
    const moved = await database.getAllAsync<{ id: string; categoryId: string }>(
      'SELECT id, categoryId FROM expenses WHERE deletedAt IS NULL ORDER BY id',
      [],
    );
    expect(moved.map((row) => row.categoryId)).toEqual([FALLBACK, FALLBACK, FALLBACK, FALLBACK]);
    // ...and not one of them was destroyed.
    const total = await database.getFirstAsync<{ n: number }>(
      'SELECT COUNT(*) AS n FROM expenses',
      [],
    );
    expect(total?.n).toBe(5);

    // The category is a tombstone, not a deleted row - sync has to carry the delete.
    const category = await database.getFirstAsync<{ deletedAt: string | null }>(
      'SELECT deletedAt FROM categories WHERE id = ?',
      [GROCERIES],
    );
    expect(category?.deletedAt).not.toBeNull();
  });

  it('leaves a tombstoned expense exactly where it was', async () => {
    // §4: "Tombstoned expenses are left alone. They are already deleted; moving them
    // would bump their `updatedAt` for no visible reason", and the count the user was
    // shown excluded them.
    const { database } = await mountCategories();
    await deleteFromRow(GROCERIES);

    await userEvent.press(screen.getByTestId(`${DELETE_DIALOG_TEST_ID}-confirm`));

    await waitFor(async () => {
      const row = await database.getFirstAsync<{ categoryId: string; updatedAt: string }>(
        'SELECT categoryId, updatedAt FROM expenses WHERE id = ?',
        [expenseId(4)],
      );
      expect(row?.categoryId).toBe(GROCERIES);
      // Untouched, including its timestamp.
      expect(row?.updatedAt).toBe('2026-10-01T00:00:00.000Z');
    });
  });

  it('queues one outbox entry per changed record', async () => {
    // §4 rule 6's third clause. One for the category plus one per reassigned expense - a
    // reassignment that reached the row but not the outbox would never sync, and nothing
    // on screen would say so.
    const { database } = await mountCategories();
    await deleteFromRow(GROCERIES);

    await userEvent.press(screen.getByTestId(`${DELETE_DIALOG_TEST_ID}-confirm`));

    await waitFor(async () => expect(await outboxEntries(database)).toHaveLength(4));
    const queued = await outboxEntries(database);
    // Category first, matching `SYNC_APPLY_ORDER`.
    expect(entryAt(queued, 0).entity).toBe('category');
    expect(entryAt(queued, 0).recordId).toBe(GROCERIES);
    expect(queued.slice(1).map((entry) => entry.entity)).toEqual(['expense', 'expense', 'expense']);
    // The reassignment pushes the expenses' *new* categoryId, so a peer converges on the
    // same state without re-deriving anything (§4 rule 7).
    expect(JSON.parse(entryAt(queued, 1).fields)).toEqual({ categoryId: FALLBACK });
    // And the tombstoned expense is not among them.
    expect(queued.map((entry) => entry.recordId)).not.toContain(expenseId(4));
  });

  it('uses the singular when exactly one expense moves', async () => {
    await mountCategories(async (database) => {
      await seedFallbackCategory(database);
      await seedCategory(database, { id: HEALTH, name: 'Health' });
      await seedExpense(database, {
        id: expenseId(1),
        categoryId: HEALTH,
        amountMinor: 500,
        date: '2026-10-10',
      });
    });

    await deleteFromRow(HEALTH);

    expect(
      screen.getByText("Its 1 expense will move to Uncategorized. It won't be deleted."),
    ).toBeTruthy();

    await userEvent.press(screen.getByTestId(`${DELETE_DIALOG_TEST_ID}-confirm`));

    await waitFor(() =>
      expect(
        screen.queryByText('Health deleted. 1 expense moved to Uncategorized.'),
      ).not.toBeNull(),
    );
  });

  it('names the default category as the user renamed it', async () => {
    // §4 rule 3: `{fallbackName}` is interpolated from the `isDefault` row and never
    // hardcoded to "Uncategorized".
    await mountCategories(async (database) => {
      await seedFallbackCategory(database, { name: 'Later' });
      await seedCategory(database, { id: HEALTH, name: 'Health' });
      await seedExpense(database, {
        id: expenseId(1),
        categoryId: HEALTH,
        amountMinor: 500,
        date: '2026-10-10',
      });
    });

    await deleteFromRow(HEALTH);

    expect(screen.getByText("Its 1 expense will move to Later. It won't be deleted.")).toBeTruthy();
  });

  it('changes nothing when the dialog is cancelled', async () => {
    const { database } = await mountCategories();
    await deleteFromRow(GROCERIES);

    await userEvent.press(screen.getByTestId(`${DELETE_DIALOG_TEST_ID}-cancel`));

    expect(await outboxEntries(database)).toHaveLength(0);
    expect(screen.getByTestId(`${CATEGORY_ROW_TEST_ID_PREFIX}-${GROCERIES}`)).toBeTruthy();
  });

  it('offers no Undo, which is why it has a dialog at all', async () => {
    // §4 rule 10: reversing this means un-reassigning exactly the expenses it touched,
    // across a window in which a sync may already be pushing them. The dialog is the gate
    // instead - which is also why expense delete has an Undo and no dialog.
    await mountCategories();
    await deleteFromRow(HEALTH);

    await userEvent.press(screen.getByTestId(`${DELETE_DIALOG_TEST_ID}-confirm`));

    await waitFor(() => expect(screen.queryByText('Health deleted.')).not.toBeNull());
    expect(screen.queryByText(COPY.common.undo)).toBeNull();
  });

  it('explains what the default category is for rather than just refusing', async () => {
    // §4 rule 12. Reachable only through a path the row does not offer, so the message
    // says why the category exists instead of reporting a failure.
    await mountCategories();

    await act(async () => {
      // The row exposes no delete action, so this stands in for the one remaining path.
      screen
        .getByTestId(`${CATEGORY_ROW_TEST_ID_PREFIX}-${FALLBACK}`)
        .props.onAccessibilityAction({ nativeEvent: { actionName: 'delete' } });
    });

    // No dialog: the operation is refused outright, with an explanation.
    expect(screen.queryByText('Delete Uncategorized?')).toBeNull();
  });

  it('reaches delete from the edit sheet too', async () => {
    // §3: Delete is also reachable from the sheet, which is the path §5 rule 3 relies on
    // when the swipe gesture is unavailable.
    await mountCategories();

    await userEvent.press(screen.getByTestId(`${CATEGORY_ROW_TEST_ID_PREFIX}-${HEALTH}`));
    await userEvent.press(screen.getByTestId('category-delete'));

    await waitFor(() => expect(screen.queryByText('Delete Health?')).not.toBeNull());
  });
});

it('never reaches the network', async () => {
  // Create, rename and delete are all local writes, so all three work offline (§1 state
  // `offline-pending`).
  const { requests, database } = await mountCategories();

  await userEvent.press(screen.getByTestId('categories-fab'));
  await act(async () => {
    screen.getByTestId('category-name').props.onChangeText('Coffee');
  });
  await userEvent.press(screen.getByTestId('category-submit'));
  await waitFor(async () => expect(await outboxEntries(database)).toHaveLength(1));

  await deleteFromRow(GROCERIES);
  await userEvent.press(screen.getByTestId(`${DELETE_DIALOG_TEST_ID}-confirm`));
  await waitFor(async () => expect(await outboxEntries(database)).toHaveLength(5));

  expect(requests).toEqual([]);
});
