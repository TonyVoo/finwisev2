import { screen, userEvent, waitFor } from '@testing-library/react-native';
import { COPY } from '@/copy/strings';
import { writeUser } from '@/db/user';
import type { SqliteDatabase } from '@/db/sqlite';
import SettingsScreen from '../../app/(app)/(tabs)/settings';
import { resetRouter } from '../support/router';
import { mountScreen } from '../support/mount';
import { categoryId, outboxEntries, seedCategory, seedFallbackCategory } from '../support/seed';

jest.mock('expo-router');
jest.mock('expo-document-picker', () => ({ getDocumentAsync: jest.fn() }));

let mockPicked: string | null = null;
jest.mock('@/import/importExpenses', () => ({
  ...jest.requireActual('@/import/importExpenses'),
  nativePickText: async () => mockPicked,
}));

async function seed(database: SqliteDatabase): Promise<void> {
  await writeUser(database, {
    id: '0192f5a0-0000-7000-8000-00000000a001',
    email: 'ada@example.com',
    currency: 'USD',
    createdAt: '2026-10-01T00:00:00.000Z',
  });
  await seedFallbackCategory(database);
  await seedCategory(database, { id: categoryId(1), name: 'Food', color: '#2F8044' });
}

beforeEach(() => {
  resetRouter();
  mockPicked = null;
});

async function pressImport() {
  const row = await screen.findByTestId('settings-import');
  await userEvent.press(row);
}

describe('Import from CSV', () => {
  it('is offered next to the export, with its hint', async () => {
    await mountScreen(<SettingsScreen />, { seed });
    expect(await screen.findByText(COPY.settings.import)).toBeTruthy();
    expect(screen.getByText(COPY.settings.importHint)).toBeTruthy();
  });

  it('does nothing when the file picker is cancelled', async () => {
    const { database } = await mountScreen(<SettingsScreen />, { seed });
    await pressImport();
    expect(screen.queryByTestId('import-dialog')).toBeNull();
    expect(await outboxEntries(database)).toEqual([]);
  });

  it('says what it would add, adds nothing until Import is pressed, then adds', async () => {
    mockPicked = 'Date,Amount,Category,Note\n2026-10-05,12.50,Food,Lunch\nsoon,1,Food,Bad\n';
    const { database } = await mountScreen(<SettingsScreen />, { seed });

    await pressImport();

    await waitFor(() => expect(screen.queryByTestId('import-dialog')).not.toBeNull());
    expect(screen.getByText(/Add 1 entries/)).toBeTruthy();
    expect(screen.getByText(/1 rows are left out: 1 unreadable date/)).toBeTruthy();
    expect(await outboxEntries(database)).toEqual([]);

    await userEvent.press(screen.getByTestId('import-dialog-confirm'));

    await waitFor(() => expect(screen.queryByText('Imported 1 entries.')).not.toBeNull());
    const queued = (await outboxEntries(database)).filter((e) => e.entity === 'expense');
    expect(queued).toHaveLength(1);
  });

  it('says so when the file has no Date and Amount columns', async () => {
    mockPicked = 'Foo,Bar\n1,2\n';
    await mountScreen(<SettingsScreen />, { seed });
    await pressImport();
    expect(await screen.findByText(COPY.csvImport.columns)).toBeTruthy();
  });

  it('adds nothing and says so when everything is already here', async () => {
    mockPicked = 'Date,Amount,Note\n2026-10-05,1.00,Tea\n';
    await mountScreen(<SettingsScreen />, { seed });
    await pressImport();
    await userEvent.press(await screen.findByTestId('import-dialog-confirm'));
    await waitFor(() => expect(screen.queryByText('Imported 1 entries.')).not.toBeNull());

    await pressImport();

    expect(await screen.findByText(COPY.csvImport.nothing)).toBeTruthy();
  });
});
