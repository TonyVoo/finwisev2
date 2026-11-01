import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { COPY } from '@/copy/strings';
import { META_KEYS, WIPED_META_KEYS, readMeta, writeMeta } from '@/db/meta';
import { applyLanguagePreference } from '@/i18n/apply';
import { LANGUAGE_OPTION_TEST_ID_PREFIX } from '@/i18n/LanguageSheet';
import SettingsScreen from '../../app/(app)/(tabs)/settings';
import { resetRouter } from '../support/router';
import { type MountedScreen, authResponse, mountScreen, ok } from '../support/mount';
import type { Transport } from '@/api/transport';

jest.mock('expo-router');

/**
 * Choosing a language in Settings: the screen changes at once, the choice is remembered on
 * this device, and a restart comes back in it.
 */

const EMPTY_PAGE = {
  changes: [],
  nextCursor: 0,
  hasMore: false,
  resyncRequired: false,
  serverTime: '2026-10-26T09:00:00.000Z',
};
const transport: Transport = async () => ok(200, EMPTY_PAGE);

describe('the language setting', () => {
  let mounted: MountedScreen;

  async function mount(saved?: string): Promise<void> {
    mounted = await mountScreen(<SettingsScreen />, {
      transport,
      seed:
        saved === undefined
          ? undefined
          : async (database) => writeMeta(database, META_KEYS.languagePreference, saved),
    });
    await mounted.container.session.signIn(authResponse());
  }

  beforeEach(() => resetRouter());

  afterEach(async () => {
    await cleanup();
    mounted.database.close();
    applyLanguagePreference('en');
  });

  it('starts in English with the language following the phone', async () => {
    await mount();
    await waitFor(() => expect(screen.getByTestId('settings-language')).toBeTruthy());

    expect(screen.getByText(COPY.settings.title)).toBeTruthy();
    expect(screen.getByLabelText('Language, Match system')).toBeTruthy();
  });

  it('offers system, English and Vietnamese, with the current one ticked', async () => {
    await mount();
    fireEvent.press(await screen.findByTestId('settings-language'));

    for (const option of ['system', 'en', 'vi']) {
      expect(await screen.findByTestId(`${LANGUAGE_OPTION_TEST_ID_PREFIX}-${option}`)).toBeTruthy();
    }
    expect(screen.getByText('Tiếng Việt')).toBeTruthy();
    expect(screen.getByText('English')).toBeTruthy();
    expect(
      screen.getByTestId(`${LANGUAGE_OPTION_TEST_ID_PREFIX}-system`).props.accessibilityState,
    ).toMatchObject({ selected: true });
  });

  it('switches the whole screen to Vietnamese at once, and remembers it', async () => {
    await mount();
    fireEvent.press(await screen.findByTestId('settings-language'));
    fireEvent.press(await screen.findByTestId(`${LANGUAGE_OPTION_TEST_ID_PREFIX}-vi`));

    // The title, rows and the language row's own value are all in Vietnamese.
    await waitFor(() => expect(screen.getByText('Cài đặt')).toBeTruthy());
    expect(screen.getByText('Ngôn ngữ')).toBeTruthy();
    expect(screen.getByText('Tiếng Việt')).toBeTruthy();
    expect(screen.getByText('Chi tiêu định kỳ')).toBeTruthy();
    expect(screen.getByText('Mục tiêu tiết kiệm')).toBeTruthy();
    expect(screen.getByLabelText('Đăng xuất')).toBeTruthy();
    // And none of it is still English.
    expect(screen.queryByText('Settings')).toBeNull();
    expect(screen.queryByText('Recurring expenses')).toBeNull();

    await waitFor(async () =>
      expect(await readMeta(mounted.database, META_KEYS.languagePreference)).toBe('vi'),
    );
  });

  it('switches back to English', async () => {
    await mount();
    fireEvent.press(await screen.findByTestId('settings-language'));
    fireEvent.press(await screen.findByTestId(`${LANGUAGE_OPTION_TEST_ID_PREFIX}-vi`));
    await waitFor(() => expect(screen.getByText('Cài đặt')).toBeTruthy());

    fireEvent.press(await screen.findByTestId('settings-language'));
    fireEvent.press(await screen.findByTestId(`${LANGUAGE_OPTION_TEST_ID_PREFIX}-en`));

    await waitFor(() => expect(screen.getByText('Settings')).toBeTruthy());
    expect(screen.queryByText('Cài đặt')).toBeNull();
    expect(await readMeta(mounted.database, META_KEYS.languagePreference)).toBe('en');
  });

  it('comes back in Vietnamese on the next launch, before the first frame', async () => {
    await mount('vi');

    // No flash of English: the very first thing on screen is already Vietnamese.
    expect(await screen.findByText('Cài đặt')).toBeTruthy();
    expect(screen.queryByText('Settings')).toBeNull();
  });

  it('treats an unrecognised saved value as the phone language, not an error', async () => {
    await mount('klingon');
    expect(await screen.findByText('Settings')).toBeTruthy();
  });
});

describe('the language setting, as stored', () => {
  it('is a device setting: signing out does not forget it', () => {
    expect(WIPED_META_KEYS).not.toContain(META_KEYS.languagePreference);
  });
});
