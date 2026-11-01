import type { Space } from '@expense-tracker/shared';
import { screen, waitFor } from '@testing-library/react-native';
import { COPY } from '@/copy/strings';
import { META_KEYS, writeMeta } from '@/db/meta';
import { applyLocalMutation } from '@/db/write';
import { SpaceChip, SPACE_CHIP_TEST_ID } from '@/household/SpaceChip';
import { createMemoryReachability } from '@/sync/reachability';
import { resetRouter, routerRecord } from '../support/router';
import { mountScreen, pressOn } from '../support/mount';
import { seedFallbackCategory } from '../support/seed';
import { BOOK, HOUSEHOLD_ID, ME, fakeServer, household } from '../support/householdServer';
import type { TestDatabase } from '../support/sqlite';

jest.mock('expo-router');

const PERSONAL: Space = { id: ME, kind: 'personal', name: null, currency: 'EUR' };
const HOME: Space = {
  id: BOOK,
  kind: 'household',
  householdId: HOUSEHOLD_ID,
  name: 'Home',
  role: 'owner',
  currency: 'USD',
};

beforeEach(() => {
  resetRouter();
  jest.clearAllMocks();
});

/** A phone that already holds `scope` and knows `spaces`, as after a sync. */
function seedSpaces(spaces: Space[], scope: string) {
  return async (database: TestDatabase) => {
    await seedFallbackCategory(database);
    await writeMeta(database, META_KEYS.owner, ME);
    await writeMeta(database, META_KEYS.spaces, JSON.stringify(spaces));
    await writeMeta(database, META_KEYS.dataScope, scope);
  };
}

describe('the space chip', () => {
  it('is not drawn for a person with only their own books', async () => {
    await mountScreen(<SpaceChip />, { seed: seedSpaces([PERSONAL], ME) });

    await waitFor(() => expect(screen.queryByTestId(SPACE_CHIP_TEST_ID)).toBeNull());
  });

  it('names the open space, Personal or a household', async () => {
    await mountScreen(<SpaceChip />, { seed: seedSpaces([PERSONAL, HOME], ME) });
    await waitFor(() => expect(screen.queryByTestId(SPACE_CHIP_TEST_ID)).not.toBeNull());
    expect(screen.getByText(COPY.spaces.personal)).toBeTruthy();
  });

  it('shows the household’s name while it is open', async () => {
    await mountScreen(<SpaceChip />, { seed: seedSpaces([PERSONAL, HOME], BOOK) });

    await waitFor(() => expect(screen.queryByText('Home')).not.toBeNull());
    expect(screen.getByLabelText(COPY.spaces.chipLabel.replace('{name}', 'Home'))).toBeTruthy();
  });
});

describe('the switcher', () => {
  async function open(options: { reachable?: boolean; scope?: string } = {}) {
    const server = fakeServer(household('owner', 'Home'));
    const reachability = createMemoryReachability(options.reachable ?? true);
    const mounted = await mountScreen(<SpaceChip />, {
      transport: server.transport,
      seed: seedSpaces([PERSONAL, HOME], options.scope ?? ME),
      reachability,
      startSync: options.reachable === false,
    });
    await waitFor(() => expect(screen.queryByTestId(SPACE_CHIP_TEST_ID)).not.toBeNull());
    await pressOn(SPACE_CHIP_TEST_ID);
    return { server, mounted };
  }

  it('lists the spaces with the open one marked, and a way to manage households', async () => {
    await open();

    expect(screen.getByText(COPY.spaces.switcherTitle)).toBeTruthy();
    expect(screen.getByTestId(`space-row-${ME}`).props.accessibilityState).toMatchObject({
      selected: true,
    });
    expect(screen.getByTestId(`space-row-${BOOK}`).props.accessibilityState).toMatchObject({
      selected: false,
    });
    await pressOn('space-manage');
    expect(routerRecord.push).toContain('/(app)/settings/household');
  });

  it('moves the device to the space chosen, asking the server as that space', async () => {
    const { server } = await open();

    await pressOn(`space-row-${BOOK}`);

    await waitFor(() => expect(screen.queryByText('Home')).not.toBeNull());
    expect(server.calls()).toContain('GET /v1/me');
    expect(server.spacesSent()).toContain(BOOK);
  });

  it('can go back to the personal space', async () => {
    const { server } = await open({ scope: BOOK });

    await pressOn(`space-row-${ME}`);

    await waitFor(() => expect(screen.queryByText(COPY.spaces.personal)).not.toBeNull());
    expect(server.spacesSent()).toContain(ME);
  });

  it('says to sync first, and asks the server nothing, while changes are waiting', async () => {
    const { server, mounted } = await open();
    await applyLocalMutation(
      mounted.database,
      {
        entity: 'category',
        id: '0192f5a0-0000-7000-8000-0000000000c9',
        fields: { name: 'Pets', color: '#2F8044' },
      },
      { clock: () => new Date('2026-10-26T09:00:00.000Z') },
    );

    await pressOn(`space-row-${BOOK}`);

    await waitFor(() => expect(screen.queryByText(COPY.household.syncFirst)).not.toBeNull());
    expect(server.calls()).not.toContain('GET /v1/me');
  });

  it('says to connect, and does not switch, while offline', async () => {
    const { server } = await open({ reachable: false });

    expect(screen.getByText(COPY.spaces.offline)).toBeTruthy();
    expect(screen.getByTestId(`space-row-${BOOK}`).props.accessibilityState).toMatchObject({
      disabled: true,
    });
    await pressOn(`space-row-${BOOK}`);
    expect(server.calls()).not.toContain('GET /v1/me');
  });
});
