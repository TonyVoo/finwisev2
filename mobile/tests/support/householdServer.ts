import type { Household, Space } from '@expense-tracker/shared';
import type { Transport, TransportRequest } from '@/api/transport';
import { apiError, ok } from './mount';

export const ME = '0192f5a0-0000-7000-8000-00000000a001';
export const OWNER = '0192f5a0-0000-7000-8000-00000000b001';
export const HOUSEHOLD_ID = '0192f5a0-0000-7000-8000-00000000c001';
export const BOOK = '0192f5a0-0000-7000-8000-00000000d0b0';

export function household(role: 'owner' | 'member', name = 'Household'): Household {
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
    name,
    role,
    ownerId: OWNER,
    currency: 'USD',
    members: [owner, other],
  };
}

export interface FakeServer {
  state: { household: Household | null; scope: string };
  transport: Transport;
  calls: () => string[];
  /** The `X-Space-Id` each request carried, by `METHOD path`. */
  spacesSent: () => Array<string | null | undefined>;
}

/**
 * Just enough server for the household screens: the id-addressed routes and `GET /v1/me`, which lists the
 * spaces and answers as the one named (404 for a space it does not have).
 */
export function fakeServer(
  initial: Household | null,
  overrides: Record<string, ReturnType<typeof ok>> = {},
): FakeServer {
  const state = { household: initial, scope: ME };
  const seen: string[] = [];
  const spaces: Array<string | null | undefined> = [];
  const base = `/v1/households/${HOUSEHOLD_ID}`;

  const spaceList = (): Space[] => [
    { id: ME, kind: 'personal', name: null, currency: 'EUR' },
    ...(state.household === null
      ? []
      : [
          {
            id: BOOK,
            kind: 'household' as const,
            householdId: state.household.id,
            name: state.household.name,
            role: state.household.role,
            currency: state.household.currency,
          },
        ]),
  ];

  const transport: Transport = async (request: TransportRequest) => {
    const key = `${request.method.toUpperCase()} ${request.path}`;
    seen.push(key);
    spaces.push(request.spaceId);
    const override = overrides[key];
    if (override !== undefined) return override;
    switch (key) {
      case 'GET /v1/households':
        return ok(200, { households: state.household === null ? [] : [state.household] });
      case 'POST /v1/household': {
        const name = (request.body as { name?: string } | undefined)?.name ?? 'Household';
        state.household = {
          ...household('owner', name),
          ownerId: ME,
          members: [household('owner').members[0]!],
        };
        state.scope = BOOK;
        return ok(201, { household: state.household });
      }
      case `PATCH ${base}`:
        state.household = {
          ...state.household!,
          name: (request.body as { name: string }).name,
        };
        return ok(200, { household: state.household });
      case `POST ${base}/transfer`: {
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
      case `POST ${base}/invite`:
        return ok(201, { data: { code: 'K7QM4T2X', expiresAt: '2026-10-29T09:00:00.000Z' } });
      case 'POST /v1/household/join':
        state.household = household('member');
        state.scope = BOOK;
        return ok(200, { household: state.household });
      case `POST ${base}/leave`:
      case `DELETE ${base}`:
        state.household = null;
        state.scope = ME;
        return ok(204, undefined);
      case 'GET /v1/me': {
        const list = spaceList();
        let scope = state.scope;
        if (request.spaceId !== undefined && request.spaceId !== null) {
          if (!list.some((space) => space.id === request.spaceId)) {
            return apiError(404, 'not_found', { details: { header: 'X-Space-Id' } });
          }
          scope = request.spaceId;
          state.scope = scope;
        }
        return ok(200, {
          user: {
            id: ME,
            email: 'ana@example.com',
            currency: scope === ME ? 'EUR' : 'USD',
            createdAt: '2026-10-01T00:00:00.000Z',
          },
          dataOwnerId: scope,
          household: scope === ME ? null : state.household,
          spaces: list,
        });
      }
      case 'GET /v1/sync':
        return ok(200, { changes: [], cursor: 0, resyncRequired: false });
      default:
        if (key.startsWith(`DELETE ${base}/members/`)) {
          state.household = { ...household('owner'), members: [household('owner').members[0]!] };
          return ok(204, undefined);
        }
        throw new Error(`unexpected request ${key}`);
    }
  };
  return { state, transport, calls: () => seen, spacesSent: () => spaces };
}
