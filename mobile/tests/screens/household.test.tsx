import { AppState } from 'react-native';
import { act, screen, waitFor } from '@testing-library/react-native';
import { COPY } from '@/copy/strings';
import HouseholdDetailScreen from '../../app/(app)/settings/household-detail';
import { resetRouter, routerRecord, setSearchParams } from '../support/router';
import { mountScreen, pressOn, typeInto } from '../support/mount';
import { seedFallbackCategory } from '../support/seed';
import {
  HOUSEHOLD_ID,
  OWNER,
  fakeServer,
  household,
  type FakeServer,
} from '../support/householdServer';

jest.mock('expo-router');

const BASE = `/v1/households/${HOUSEHOLD_ID}`;

beforeEach(() => {
  resetRouter();
  setSearchParams({ id: HOUSEHOLD_ID });
  jest.clearAllMocks();
});

async function mount(server: FakeServer) {
  return await mountScreen(<HouseholdDetailScreen />, {
    transport: server.transport,
    seed: async (database) => {
      await seedFallbackCategory(database);
    },
  });
}

describe('the owner of a household', () => {
  it('sees the members with their roles', async () => {
    await mount(fakeServer(household('owner')));

    await waitFor(() => expect(screen.queryByText('Bao')).not.toBeNull());
    expect(screen.getByText('Ana', { exact: false })).toBeTruthy();
    expect(screen.getAllByText(COPY.household.role.member).length).toBeGreaterThan(0);
  });

  it('names a member by the name they chose, and by their email when they chose none', async () => {
    const withName = household('owner');
    await mount(
      fakeServer({
        ...withName,
        members: withName.members.map((m) =>
          m.userId === OWNER ? { ...m, displayName: 'Bảo' } : m,
        ),
      }),
    );

    await waitFor(() => expect(screen.queryByText('Bảo')).not.toBeNull());
    expect(screen.queryByText('bao@example.com')).toBeNull();
    // The other member has no name, so the email's start stands in.
    expect(screen.getByText('Ana', { exact: false })).toBeTruthy();
  });

  it('can make an invite code, which is shown once with a way to share it', async () => {
    const server = fakeServer(household('owner'));
    await mount(server);
    await waitFor(() => expect(screen.queryByTestId('household-invite')).not.toBeNull());

    await pressOn('household-invite');

    await waitFor(() => expect(screen.queryByText('K7QM4T2X')).not.toBeNull());
    expect(screen.getByText(COPY.household.invite.body)).toBeTruthy();
    expect(screen.getByTestId('household-invite-share')).toBeTruthy();
  });

  it('removes a member after confirming', async () => {
    const server = fakeServer(household('owner'));
    await mount(server);
    await waitFor(() => expect(screen.queryByTestId(`household-member-${OWNER}`)).not.toBeNull());

    await pressOn(`household-member-${OWNER}`);
    await pressOn('household-member-remove');
    await waitFor(() =>
      expect(
        screen.queryByText(COPY.household.remove.title.replace('{email}', 'Bao')),
      ).not.toBeNull(),
    );
    await pressOn('household-remove-dialog-confirm');

    await waitFor(() => expect(screen.queryByText(COPY.household.snack.removed)).not.toBeNull());
    expect(server.calls()).toContain(`DELETE ${BASE}/members/${OWNER}`);
  });

  it('offers the two things you can do to a member, in a sheet', async () => {
    await mount(fakeServer(household('owner')));
    await waitFor(() => expect(screen.queryByTestId(`household-member-${OWNER}`)).not.toBeNull());

    await pressOn(`household-member-${OWNER}`);

    expect(screen.getByTestId('household-member-transfer')).toBeTruthy();
    expect(screen.getByTestId('household-member-remove')).toBeTruthy();
  });

  it('hands the household to a member after confirming, and becomes a member', async () => {
    const server = fakeServer(household('owner'));
    await mount(server);
    await waitFor(() => expect(screen.queryByTestId(`household-member-${OWNER}`)).not.toBeNull());

    await pressOn(`household-member-${OWNER}`);
    await pressOn('household-member-transfer');
    await waitFor(() =>
      expect(
        screen.queryByText(COPY.household.transfer.title.replace('{email}', 'Bao')),
      ).not.toBeNull(),
    );
    expect(server.calls()).not.toContain(`POST ${BASE}/transfer`);
    await pressOn('household-transfer-dialog-confirm');

    await waitFor(() =>
      expect(screen.queryByText(COPY.household.snack.transferred)).not.toBeNull(),
    );
    expect(server.calls()).toContain(`POST ${BASE}/transfer`);
    // No books moved, so the device did not need to ask whose they are.
    expect(server.calls()).not.toContain('GET /v1/me');
    // And the screen now shows the caller as a member: Leave instead of Delete.
    await waitFor(() => expect(screen.queryByTestId('household-leave')).not.toBeNull());
    expect(screen.queryByTestId('household-delete')).toBeNull();
  });

  it('deletes the household after confirming', async () => {
    const server = fakeServer(household('owner'));
    await mount(server);
    await waitFor(() => expect(screen.queryByTestId('household-delete')).not.toBeNull());

    await pressOn('household-delete');
    await pressOn('household-delete-dialog-confirm');

    await waitFor(() => expect(screen.queryByText(COPY.household.snack.deleted)).not.toBeNull());
    expect(server.calls()).toContain(`DELETE ${BASE}`);
    // The shared books went back to the owner: the device re-learns whose books it holds.
    expect(server.calls()).toContain('GET /v1/me');
  });

  it('has no Leave button: the owner deletes instead', async () => {
    await mount(fakeServer(household('owner')));
    await waitFor(() => expect(screen.queryByTestId('household-delete')).not.toBeNull());

    expect(screen.queryByTestId('household-leave')).toBeNull();
  });
});

describe('a member of a household', () => {
  it('can leave after confirming, and returns to their own books', async () => {
    const server = fakeServer(household('member'));
    server.state.scope = OWNER;
    await mount(server);
    await waitFor(() => expect(screen.queryByTestId('household-leave')).not.toBeNull());

    await pressOn('household-leave');
    await pressOn('household-leave-dialog-confirm');

    await waitFor(() => expect(screen.queryByText(COPY.household.snack.left)).not.toBeNull());
    expect(server.calls()).toContain(`POST ${BASE}/leave`);
    expect(server.calls()).toContain('GET /v1/me');
  });

  it('cannot invite, remove or delete', async () => {
    await mount(fakeServer(household('member')));
    await waitFor(() => expect(screen.queryByTestId('household-leave')).not.toBeNull());

    expect(screen.queryByTestId('household-invite')).toBeNull();
    expect(screen.queryByTestId('household-delete')).toBeNull();
    expect(screen.queryByTestId(`household-member-${OWNER}`)).toBeNull();
  });
});

describe('staying current', () => {
  it('re-reads the household when the app comes back to the foreground', async () => {
    const handlers: Array<(state: string) => void> = [];
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, handler) => {
      handlers.push(handler as (state: string) => void);
      return { remove: () => undefined };
    });
    const server = fakeServer(household('owner'));
    await mount(server);
    await waitFor(() => expect(screen.queryByText('Bao')).not.toBeNull());
    const reads = () => server.calls().filter((call) => call === 'GET /v1/households').length;
    expect(reads()).toBe(1);

    // Someone joined while the screen sat open in the background.
    server.state.household = {
      ...household('owner'),
      members: [
        ...household('owner').members,
        {
          userId: '0192f5a0-0000-7000-8000-00000000d001',
          email: 'chi@example.com',
          displayName: null,
          role: 'member' as const,
          joinedAt: '2026-10-22T09:00:00.000Z',
        },
      ],
    };
    await act(async () => handlers.forEach((handler) => handler('active')));

    await waitFor(() => expect(screen.queryByText('Chi')).not.toBeNull());
    expect(reads()).toBe(2);
  });

  it('does not re-read for the app going to the background', async () => {
    const handlers: Array<(state: string) => void> = [];
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, handler) => {
      handlers.push(handler as (state: string) => void);
      return { remove: () => undefined };
    });
    const server = fakeServer(household('owner'));
    await mount(server);
    await waitFor(() => expect(screen.queryByText('Bao')).not.toBeNull());

    await act(async () => handlers.forEach((handler) => handler('background')));

    expect(server.calls().filter((call) => call === 'GET /v1/households')).toHaveLength(1);
  });
});

describe('renaming and switching', () => {
  it('lets the owner rename it, and shows the new name', async () => {
    const server = fakeServer(household('owner', 'Old name'));
    await mount(server);
    await waitFor(() => expect(screen.queryByTestId('household-rename')).not.toBeNull());

    await pressOn('household-rename');
    await typeInto('household-name', 'Flat 4');
    await pressOn('household-name-submit');

    await waitFor(() => expect(screen.queryByText(COPY.household.snack.renamed)).not.toBeNull());
    expect(server.calls()).toContain(`PATCH ${BASE}`);
    await waitFor(() => expect(screen.queryAllByText('Flat 4').length).toBeGreaterThan(0));
  });

  it('does not offer a member the rename', async () => {
    await mount(fakeServer(household('member')));
    await waitFor(() => expect(screen.queryByTestId('household-leave')).not.toBeNull());

    expect(screen.queryByTestId('household-rename')).toBeNull();
  });

  it('offers to switch to a household that is not open, and moves the device into it', async () => {
    const server = fakeServer(household('owner'));
    await mount(server);
    await waitFor(() => expect(screen.queryByTestId('household-switch')).not.toBeNull());

    await pressOn('household-switch');

    await waitFor(() => expect(server.calls()).toContain('GET /v1/me'));
    await waitFor(() => expect(screen.queryByTestId('household-open-now')).not.toBeNull());
    expect(screen.queryByTestId('household-switch')).toBeNull();
  });

  it('leaves the screen after deleting or leaving, since the household is gone', async () => {
    await mount(fakeServer(household('owner')));
    await waitFor(() => expect(screen.queryByTestId('household-delete')).not.toBeNull());

    await pressOn('household-delete');
    await pressOn('household-delete-dialog-confirm');

    await waitFor(() => expect(routerRecord.back).toBeGreaterThan(0));
  });
});
