import { act, screen, waitFor } from '@testing-library/react-native';
import { NetworkUnavailableError } from '@/api/errors';
import type { Transport, TransportRequest } from '@/api/transport';
import { COPY } from '@/copy/strings';
import { readUser, writeUser } from '@/db/user';
import DisplayNameScreen from '../../app/(app)/settings/display-name';
import { resetRouter, routerRecord } from '../support/router';
import { apiError, mountScreen, ok, pressOn, typeInto } from '../support/mount';
import type { SqliteDatabase } from '@/db/sqlite';

jest.mock('expo-router');

const ME = '0192f5a0-0000-7000-8000-00000000a001';

/** The field is filled once the saved name has been read; typing before that would be overwritten. */
async function loaded(): Promise<void> {
  await waitFor(() => expect(screen.queryByTestId('display-name-input')).not.toBeNull());
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function seed(database: SqliteDatabase, displayName: string | null = null) {
  await writeUser(database, {
    id: ME,
    email: 'ada@example.com',
    displayName,
    currency: 'USD',
    createdAt: '2026-10-01T00:00:00.000Z',
  });
}

function server(handler?: (body: unknown) => ReturnType<typeof ok>) {
  const calls: TransportRequest[] = [];
  const transport: Transport = async (request) => {
    calls.push(request);
    const body = request.body as { displayName: string | null };
    return (
      handler?.(body) ??
      ok(200, {
        user: {
          id: ME,
          email: 'ada@example.com',
          displayName:
            body.displayName === null || body.displayName.trim() === ''
              ? null
              : body.displayName.trim(),
          currency: 'USD',
          createdAt: '2026-10-01T00:00:00.000Z',
        },
      })
    );
  };
  return { transport, calls };
}

beforeEach(() => resetRouter());

describe('the display name screen', () => {
  it('starts with the current name in the field, and says who sees it', async () => {
    await mountScreen(<DisplayNameScreen />, {
      transport: server().transport,
      seed: (database) => seed(database, 'Ada'),
    });

    await waitFor(() => expect(screen.getByTestId('display-name-input').props.value).toBe('Ada'));
    expect(screen.getByText(COPY.account.displayName.hint)).toBeTruthy();
  });

  it('saves the name, keeps it on the phone, and goes back', async () => {
    const { transport, calls } = server();
    const { database } = await mountScreen(<DisplayNameScreen />, {
      transport,
      seed: (db) => seed(db),
    });

    await loaded();
    await typeInto('display-name-input', '  Ada Tran ');
    await pressOn('display-name-save');

    await waitFor(() => expect(routerRecord.back).toBe(1));
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual(['patch /v1/me/profile']);
    expect(calls[0]?.body).toEqual({ displayName: 'Ada Tran' });
    expect((await readUser(database))?.displayName).toBe('Ada Tran');
  });

  it('clears the name when the field is emptied', async () => {
    const { transport, calls } = server();
    const { database } = await mountScreen(<DisplayNameScreen />, {
      transport,
      seed: (db) => seed(db, 'Ada'),
    });
    await waitFor(() => expect(screen.getByTestId('display-name-input').props.value).toBe('Ada'));

    await typeInto('display-name-input', '');
    await pressOn('display-name-save');

    await waitFor(() => expect(routerRecord.back).toBe(1));
    expect(calls[0]?.body).toEqual({ displayName: null });
    expect((await readUser(database))?.displayName).toBeNull();
  });

  it('refuses a name that is too long without asking the server', async () => {
    const { transport, calls } = server();
    await mountScreen(<DisplayNameScreen />, { transport, seed: (db) => seed(db) });

    await loaded();
    await typeInto('display-name-input', 'x'.repeat(41));
    await pressOn('display-name-save');

    expect(screen.getByText(COPY.account.displayName.tooLong)).toBeTruthy();
    expect(calls).toHaveLength(0);
    expect(routerRecord.back).toBe(0);
  });

  it('says to connect when offline, and keeps the old name', async () => {
    const { database } = await mountScreen(<DisplayNameScreen />, {
      transport: async () => {
        throw new NetworkUnavailableError('offline');
      },
      seed: (db) => seed(db, 'Ada'),
    });
    await waitFor(() => expect(screen.getByTestId('display-name-input').props.value).toBe('Ada'));

    await typeInto('display-name-input', 'Bảo');
    await pressOn('display-name-save');

    expect(await screen.findByText(COPY.account.displayName.offline)).toBeTruthy();
    expect((await readUser(database))?.displayName).toBe('Ada');
    expect(routerRecord.back).toBe(0);
  });

  it('shows the generic message for any other failure', async () => {
    await mountScreen(<DisplayNameScreen />, {
      transport: server(() => apiError(500, 'internal_error')).transport,
      seed: (db) => seed(db),
    });

    await loaded();
    await typeInto('display-name-input', 'Ada');
    await pressOn('display-name-save');

    expect(await screen.findByText(COPY.error.generic)).toBeTruthy();
  });
});
