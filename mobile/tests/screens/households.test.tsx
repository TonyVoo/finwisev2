import { screen, waitFor } from '@testing-library/react-native';
import { COPY } from '@/copy/strings';
import { applyLocalMutation } from '@/db/write';
import HouseholdsScreen from '../../app/(app)/settings/household';
import { NetworkUnavailableError } from '@/api/errors';
import { resetRouter, routerRecord } from '../support/router';
import { apiError, mountScreen, pressOn, typeInto } from '../support/mount';
import { seedFallbackCategory } from '../support/seed';
import { HOUSEHOLD_ID, fakeServer, household, type FakeServer } from '../support/householdServer';

jest.mock('expo-router');

const hidden = { includeHiddenElements: true };

beforeEach(() => {
  resetRouter();
  jest.clearAllMocks();
});

async function mount(server: FakeServer) {
  return await mountScreen(<HouseholdsScreen />, {
    transport: server.transport,
    seed: async (database) => {
      await seedFallbackCategory(database);
    },
  });
}

describe('a person in no household', () => {
  it('is offered to create one or to join with a code', async () => {
    await mount(fakeServer(null));

    await waitFor(() => expect(screen.queryByTestId('household-empty')).not.toBeNull());
    expect(screen.getByText(COPY.household.empty.headline)).toBeTruthy();
    expect(screen.getByTestId('household-create')).toBeTruthy();
    expect(screen.getByTestId('household-join')).toBeTruthy();
    expect(screen.getByTestId('empty-icon-users', hidden)).toBeTruthy();
  });

  it('asks for a name, says what will happen, then creates it and moves the device in', async () => {
    const server = fakeServer(null);
    await mount(server);
    await waitFor(() => expect(screen.queryByTestId('household-create')).not.toBeNull());

    await pressOn('household-create');
    expect(screen.getByText(COPY.household.nameSheet.createTitle)).toBeTruthy();
    expect(screen.getByText(COPY.household.nameSheet.createHint)).toBeTruthy();
    expect(server.calls()).not.toContain('POST /v1/household');
    await typeInto('household-name', 'Flat 4');
    await pressOn('household-name-submit');

    await waitFor(() => expect(screen.queryByText(COPY.household.snack.created)).not.toBeNull());
    expect(server.calls()).toContain('POST /v1/household');
    // The device moved into the new household, so it asked who it is now.
    expect(server.calls()).toContain('GET /v1/me');
    await waitFor(() => expect(screen.queryByText('Flat 4')).not.toBeNull());
  });

  it('will not make a household with a blank name', async () => {
    const server = fakeServer(null);
    await mount(server);
    await waitFor(() => expect(screen.queryByTestId('household-create')).not.toBeNull());

    await pressOn('household-create');
    await typeInto('household-name', '   ');
    await pressOn('household-name-submit');

    expect(screen.getByText(COPY.household.nameSheet.empty)).toBeTruthy();
    expect(server.calls()).not.toContain('POST /v1/household');
  });

  it('does not create while changes are waiting to sync, because the books move', async () => {
    const server = fakeServer(null);
    const mounted = await mount(server);
    await waitFor(() => expect(screen.queryByTestId('household-create')).not.toBeNull());
    await applyLocalMutation(
      mounted.database,
      {
        entity: 'category',
        id: '0192f5a0-0000-7000-8000-0000000000c9',
        fields: { name: 'Pets', color: '#2F8044' },
      },
      { clock: () => new Date('2026-10-26T09:00:00.000Z') },
    );

    await pressOn('household-create');
    await typeInto('household-name', 'Flat 4');
    await pressOn('household-name-submit');

    await waitFor(() => expect(screen.queryByText(COPY.household.syncFirst)).not.toBeNull());
    expect(server.calls()).not.toContain('POST /v1/household');
  });
});

describe('joining with a code', () => {
  async function openJoin(server: FakeServer) {
    const mounted = await mount(server);
    await waitFor(() => expect(screen.queryByTestId('household-join')).not.toBeNull());
    await pressOn('household-join');
    return mounted;
  }

  it('sends the code, then moves the device to the household books and says so', async () => {
    const server = fakeServer(null);
    await openJoin(server);

    await typeInto('household-code', 'k7qm4t2x');
    await pressOn('household-join-submit');

    await waitFor(() => expect(screen.queryByText(COPY.household.snack.joined)).not.toBeNull());
    expect(server.calls()).toContain('POST /v1/household/join');
    // The device asked who it is now, and so learned its data scope changed.
    expect(server.calls()).toContain('GET /v1/me');
  });

  it('says why when the code is wrong, and stays on the field', async () => {
    const server = fakeServer(null, {
      'POST /v1/household/join': apiError(400, 'invalid_invite_code'),
    });
    await openJoin(server);

    await typeInto('household-code', 'AAAAAAAA');
    await pressOn('household-join-submit');

    await waitFor(() =>
      expect(screen.queryByText(COPY.household.error.invalid_invite_code)).not.toBeNull(),
    );
    expect(screen.queryByText(COPY.household.snack.joined)).toBeNull();
  });

  it('does not send a malformed code', async () => {
    const server = fakeServer(null);
    await openJoin(server);

    await typeInto('household-code', 'abc');
    await pressOn('household-join-submit');

    expect(server.calls()).not.toContain('POST /v1/household/join');
  });

  it('refuses while changes are still waiting to sync, because joining clears them', async () => {
    const server = fakeServer(null);
    const mounted = await openJoin(server);
    await applyLocalMutation(
      mounted.database,
      {
        entity: 'category',
        id: '0192f5a0-0000-7000-8000-0000000000c9',
        fields: { name: 'Pets', color: '#2F8044' },
      },
      { clock: () => new Date('2026-10-26T09:00:00.000Z') },
    );

    await typeInto('household-code', 'K7QM4T2X');
    await pressOn('household-join-submit');

    await waitFor(() => expect(screen.queryByText(COPY.household.syncFirst)).not.toBeNull());
    expect(server.calls()).not.toContain('POST /v1/household/join');
  });
});

describe('a person in households', () => {
  it('lists each with its role and member count, and opens one on a tap', async () => {
    await mount(fakeServer(household('owner', 'Flat 4')));

    await waitFor(() => expect(screen.queryByText('Flat 4')).not.toBeNull());
    expect(
      screen.getByText(
        `${COPY.household.role.owner} · ${COPY.household.memberCountMany.replace('{count}', '2')}`,
        { exact: false },
      ),
    ).toBeTruthy();

    await pressOn(`household-row-${HOUSEHOLD_ID}`);

    expect(routerRecord.push).toEqual([
      { pathname: '/(app)/settings/household-detail', params: { id: HOUSEHOLD_ID } },
    ]);
  });

  it('can still create or join another', async () => {
    await mount(fakeServer(household('member')));

    await waitFor(() => expect(screen.queryByText('Household')).not.toBeNull());
    expect(screen.getByTestId('household-create')).toBeTruthy();
    expect(screen.getByTestId('household-join')).toBeTruthy();
  });
});

describe('offline', () => {
  it('says to connect, with a way to try again', async () => {
    let online = false;
    const server = fakeServer(null);
    await mountScreen(<HouseholdsScreen />, {
      transport: async (request) => {
        if (!online) throw new NetworkUnavailableError('offline');
        return server.transport(request);
      },
    });

    await waitFor(() => expect(screen.queryByText(COPY.household.offline)).not.toBeNull());

    online = true;
    await pressOn('household-retry');
    await waitFor(() => expect(screen.queryByTestId('household-empty')).not.toBeNull());
  });
});
