import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { defaultCategories } from '@expense-tracker/shared';
import { COPY, SNACK_COPY } from '@/copy/strings';
import { META_KEYS, readMeta, writeMeta } from '@/db/meta';
import { applyLanguagePreference } from '@/i18n/apply';
import SettingsScreen from '../../app/(app)/(tabs)/settings';
import { resetRouter } from '../support/router';
import { type MountedScreen, authResponse, mountScreen, ok } from '../support/mount';
import type { Transport } from '@/api/transport';
import type { SqliteDatabase } from '@/db/sqlite';

jest.mock('expo-router');

/**
 * The one-time offer, in Settings, to give the untouched default categories Vietnamese names.
 * It is only ever an offer: nothing is renamed until the person says yes, and it is only made
 * in Vietnamese, to someone who still has English defaults.
 */

const EMPTY_PAGE = {
  changes: [],
  nextCursor: 0,
  hasMore: false,
  resyncRequired: false,
  serverTime: '2026-10-26T09:00:00.000Z',
};
const transport: Transport = async () => ok(200, EMPTY_PAGE);

const ROW = 'settings-rename-categories';
const EN = defaultCategories('en');

async function seedEnglishDefaults(database: SqliteDatabase): Promise<void> {
  for (const [index, seed] of EN.entries()) {
    await database.runAsync(
      `INSERT INTO categories (id, name, color, isDefault, updatedAt, revision)
       VALUES (?, ?, ?, ?, '2026-10-01T00:00:00.000Z', 1)`,
      [
        `0192f5a0-0000-7000-8000-00000000000${index}`,
        seed.name,
        seed.color,
        seed.isDefault ? 1 : 0,
      ],
    );
  }
}

describe('offering Vietnamese names for the default categories', () => {
  let mounted: MountedScreen;

  async function mount(options: { language?: 'vi' | 'en'; seed?: boolean; answered?: boolean }) {
    const { language = 'vi', seed = true, answered = false } = options;
    mounted = await mountScreen(<SettingsScreen />, {
      transport,
      seed: async (database) => {
        await writeMeta(database, META_KEYS.languagePreference, language);
        // Signing in as anyone but the store's owner wipes it, so seed it as this user's.
        await writeMeta(database, META_KEYS.owner, authResponse().user.id);
        if (answered) await writeMeta(database, META_KEYS.categoryRenameAnswered, '1');
        if (seed) await seedEnglishDefaults(database);
      },
    });
    await mounted.container.session.signIn(authResponse());
  }

  const names = async () =>
    (
      await mounted.database.getAllAsync<{ name: string }>(
        'SELECT name FROM categories ORDER BY id',
        [],
      )
    ).map((row) => row.name);

  beforeEach(() => resetRouter());

  afterEach(async () => {
    await cleanup();
    mounted.database.close();
    applyLanguagePreference('en');
  });

  it('offers it in Vietnamese when there are untouched English defaults', async () => {
    await mount({});
    expect(await screen.findByTestId(ROW)).toBeTruthy();
    expect(screen.getByText(COPY.settings.renameCategories)).toBeTruthy();
  });

  it('does not offer it in English', async () => {
    await mount({ language: 'en' });
    await screen.findByTestId('settings-language');
    expect(screen.queryByTestId(ROW)).toBeNull();
  });

  it('does not offer it when there is nothing left to rename', async () => {
    await mount({ seed: false });
    await screen.findByTestId('settings-language');
    expect(screen.queryByTestId(ROW)).toBeNull();
  });

  it('does not offer it again once it has been answered', async () => {
    await mount({ answered: true });
    await screen.findByTestId('settings-language');
    expect(screen.queryByTestId(ROW)).toBeNull();
  });

  it('asks first, says how many, and renames nothing until confirmed', async () => {
    await mount({});
    fireEvent.press(await screen.findByTestId(ROW));

    expect(await screen.findByText(COPY.categoryRename.title.replace('{count}', '6'))).toBeTruthy();
    expect(screen.getByText(COPY.categoryRename.body)).toBeTruthy();
    expect(await names()).toEqual(EN.map((c) => c.name));
  });

  it('renames the untouched defaults on yes, queues them to sync, and stops offering', async () => {
    await mount({});
    fireEvent.press(await screen.findByTestId(ROW));
    fireEvent.press(await screen.findByTestId('category-rename-confirm'));

    await waitFor(async () => expect(await names()).toContain('Tạp hóa'));
    expect(await names()).toEqual(defaultCategories('vi').map((c) => c.name));
    await waitFor(() => expect(screen.queryByTestId(ROW)).toBeNull());
    expect(await readMeta(mounted.database, META_KEYS.categoryRenameAnswered)).toBe('1');
    expect(screen.getByText(SNACK_COPY.category.defaultsRenamed)).toBeTruthy();
  });

  it('leaves a category the person already renamed alone, and says only how many it will change', async () => {
    await mount({});
    await mounted.database.runAsync(
      "UPDATE categories SET name = 'Siêu thị' WHERE id = '0192f5a0-0000-7000-8000-000000000001'",
      [],
    );
    fireEvent.press(await screen.findByTestId(ROW));

    expect(await screen.findByText(COPY.categoryRename.title.replace('{count}', '5'))).toBeTruthy();
    fireEvent.press(await screen.findByTestId('category-rename-confirm'));

    await waitFor(async () => expect(await names()).toContain('Di chuyển'));
    expect(await names()).toContain('Siêu thị');
    expect(await names()).not.toContain('Tạp hóa');
  });

  it('on not now, renames nothing and never asks again', async () => {
    await mount({});
    fireEvent.press(await screen.findByTestId(ROW));
    fireEvent.press(await screen.findByTestId('category-rename-dismiss'));

    await waitFor(() => expect(screen.queryByTestId(ROW)).toBeNull());
    expect(await names()).toEqual(EN.map((c) => c.name));
    expect(await readMeta(mounted.database, META_KEYS.categoryRenameAnswered)).toBe('1');
  });
});
