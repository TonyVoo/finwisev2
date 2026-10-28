import type { Household } from '@expense-tracker/shared';
import { AppState } from 'react-native';
import { act, screen, waitFor } from '@testing-library/react-native';
import { COPY } from '@/copy/strings';
import { applyLocalMutation } from '@/db/write';
import HouseholdScreen from '../../app/(app)/settings/household';
import type { Transport, TransportRequest, TransportResponse } from '@/api/transport';
import { NetworkUnavailableError } from '@/api/errors';
import { resetRouter } from '../support/router';
import { apiError, mountScreen, ok, pressOn, typeInto } from '../support/mount';
import { seedFallbackCategory } from '../support/seed';

jest.mock('expo-router');

const ME = '0192f5a0-0000-7000-8000-00000000a001';
const OWNER = '0192f5a0-0000-7000-8000-00000000b001';
const HOUSEHOLD_ID = '0192f5a0-0000-7000-8000-00000000c001';
const BOOK = '0192f5a0-0000-7000-8000-00000000d0b0';
const hidden = { includeHiddenElements: true };

function household(role: 'owner' | 'member'): Household {
  const owner = {
    userId: role === 'owner' ? ME : OWNER,
    email: role === 'owner' ? 'ana@example.com' : 'bao@example.com',
    displayName: null,
    role: 'owner' as const,
    joinedAt: '2026-10-20T09:00:00.000Z',
  };
  const other = {
    userId: role === 'owner' ? OWNER : ME,
    email: role === 'owner' ? 'bao@example.com' : 'ana@example.com',
    displayName: null,
    role: 'member' as const,
    joinedAt: '2026-10-21T09:00:00.000Z',
  };
  return {
    id: HOUSEHOLD_ID,
    role,
    ownerId: OWNER,
    currency: 'USD',
    members: [owner, other],
  };
}

interface FakeServer {
  state: { household: Household | null; scope: string };
  transport: Transport;
  calls: () => string[];
}

/** Just enough server: the household routes and `GET /v1/me`. */
function fakeServer(
  initial: Household | null,
  overrides: Record<string, TransportResponse> = {},
): FakeServer {
  const state = { household: initial, scope: ME };
  const seen: string[] = [];
  const transport: Transport = async (request: TransportRequest) => {
    const key = `${request.method.toUpperCase()} ${request.path}`;
    seen.push(key);
    const override = overrides[key];
    if (override !== undefined) return override;
    switch (key) {
      case 'GET /v1/household':
        return ok(200, { household: state.household });
      case 'POST /v1/household':
        state.household = {
          ...household('owner'),
          ownerId: ME,
          members: [household('owner').members[0]!],
        };
        // The creator's books move into the household's own book.
        state.scope = BOOK;
        return ok(201, { household: state.household });
      case 'POST /v1/household/transfer': {
        const current = state.household!;
        state.household = {
          ...current,
          role: 'member',
          ownerId: OWNER,
          members: current.members.map((m) => ({
            ...m,
            role: m.userId === OWNER ? ('owner' as const) : ('member' as const),
          })),
        };
        return ok(200, { household: state.household });
      }
      case 'POST /v1/household/invite':
        return ok(201, { data: { code: 'K7QM4T2X', expiresAt: '2026-10-29T09:00:00.000Z' } });
      case 'POST /v1/household/join':
        state.household = household('member');
        state.scope = OWNER;
        return ok(200, { household: state.household });
      case 'POST /v1/household/leave':
        state.household = null;
        state.scope = ME;
        return ok(204, undefined);
      case 'DELETE /v1/household':
        state.household = null;
        state.scope = ME;
        return ok(204, undefined);
      case 'GET /v1/me':
        return ok(200, {
          user: {
            id: ME,
            email: 'ana@example.com',
            currency: 'EUR',
            createdAt: '2026-10-01T00:00:00.000Z',
          },
          dataOwnerId: state.scope,
        });
      case 'GET /v1/sync':
        return ok(200, { changes: [], cursor: 0, resyncRequired: false });
      default:
        if (key.startsWith('DELETE /v1/household/members/')) {
          state.household = { ...household('owner'), members: [household('owner').members[0]!] };
          return ok(204, undefined);
        }
        throw new Error(`unexpected request ${key}`);
    }
  };
  return { state, transport, calls: () => seen };
}

beforeEach(() => {
  resetRouter();
  jest.clearAllMocks();
});

async function mount(server: FakeServer) {
  return await mountScreen(<HouseholdScreen />, {
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

  it('creates a household and then shows its members, with the creator as owner', async () => {
    const server = fakeServer(null);
    await mount(server);
    await waitFor(() => expect(screen.queryByTestId('household-create')).not.toBeNull());

    await pressOn('household-create');
    // It moves their books in, so they are asked first, in plain words.
    expect(screen.getByText(COPY.household.createConfirm.title)).toBeTruthy();
    expect(server.calls()).not.toContain('POST /v1/household');
    await pressOn('household-create-dialog-confirm');

    await waitFor(() => expect(screen.queryByText(COPY.household.snack.created)).not.toBeNull());
    expect(screen.getByText('Ana', { exact: false })).toBeTruthy();
    // "Owner", plus "You" once the device has learned who it is.
    expect(screen.getByText(new RegExp(`^${COPY.household.role.owner}`))).toBeTruthy();
    expect(server.calls()).toContain('POST /v1/household');
    // The device's books changed hands, so it asked who it is now and learned its new scope.
    expect(server.calls()).toContain('GET /v1/me');
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
    await pressOn('household-create-dialog-confirm');

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
    expect(server.calls()).toContain(`DELETE /v1/household/members/${OWNER}`);
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
    expect(server.calls()).not.toContain('POST /v1/household/transfer');
    await pressOn('household-transfer-dialog-confirm');

    await waitFor(() =>
      expect(screen.queryByText(COPY.household.snack.transferred)).not.toBeNull(),
    );
    expect(server.calls()).toContain('POST /v1/household/transfer');
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
    expect(server.calls()).toContain('DELETE /v1/household');
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
    expect(server.calls()).toContain('POST /v1/household/leave');
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
    const reads = () => server.calls().filter((call) => call === 'GET /v1/household').length;
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

    expect(server.calls().filter((call) => call === 'GET /v1/household')).toHaveLength(1);
  });
});

describe('offline', () => {
  it('says to connect, with a way to try again', async () => {
    let online = false;
    const server = fakeServer(null);
    await mountScreen(<HouseholdScreen />, {
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
