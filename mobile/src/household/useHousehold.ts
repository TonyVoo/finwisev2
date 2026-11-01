import type { Household, HouseholdResponse } from '@expense-tracker/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect } from 'react';
import { AppState } from 'react-native';
import { ApiRequestError, NetworkUnavailableError } from '../api/errors';
import { useApiClient } from '../bootstrap/AppProviders';
import { COPY } from '../copy/strings';
import { useDatabase } from '../db/DatabaseProvider';
import { countPendingRecords } from '../db/queries';
import { queryKeys } from '../query/keys';
import { useOptionalSyncStatus, useSync } from '../sync/SyncProvider';
import { reconcileDataScope, type ScopeResult } from './dataScope';
import { switchRefusal } from './spaceModel';
import { useSpaces } from './useSpaces';

/**
 * Household membership is **server state**: who is in the household, and who owns it. Unlike
 * expenses it is never read from SQLite and has no offline mode, which is why this module talks
 * to the API directly - the one deliberate exception to "feature code reads local data", in the
 * same spirit as the auth screens. The *effect* of membership on the books is local, and
 * `reconcileDataScope` is what brings the device into line with it.
 */

/** Why an action did not happen, as the words to show. */
export function householdErrorMessage(error: unknown): string {
  if (error instanceof PendingChangesError || error instanceof SwitchRefusedError) {
    return error.message;
  }
  if (error instanceof NetworkUnavailableError) return COPY.household.offline;
  if (error instanceof ApiRequestError) {
    const known = COPY.household.error as Readonly<Record<string, string>>;
    return known[error.code] ?? COPY.error.generic;
  }
  return COPY.error.generic;
}

/** A switch that did not happen, with the words to show: offline, changes waiting, or the space gone. */
export class SwitchRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SwitchRefusedError';
  }
}

/** Thrown, rather than sent, when a switch would discard changes that have not synced. */
export class PendingChangesError extends Error {
  constructor() {
    super(COPY.household.syncFirst);
    this.name = 'PendingChangesError';
  }
}

/** Every household the caller is in, from the server. */
export function useHouseholds() {
  const api = useApiClient();
  const query = useQuery({
    queryKey: queryKeys.households(),
    queryFn: async () => (await api.listHouseholds()).households,
    // Server state that other people change, so it is read afresh each time the screen opens.
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });

  // Other people change this while the screen sits open in the background: read it again
  // whenever the app comes back to the foreground.
  const { refetch } = query;
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refetch();
    });
    return () => subscription.remove();
  }, [refetch]);

  return query;
}

/**
 * One household: the one named, else the one that is open, else - for a person in exactly one - that one.
 * `null` once the list has loaded and it is not there; `undefined` before.
 */
export function useHousehold(id?: string) {
  const households = useHouseholds();
  const { active } = useSpaces();
  const list = households.data;
  let data: Household | null | undefined;
  if (list !== undefined) {
    const wanted = id ?? (active?.kind === 'household' ? active.householdId : undefined);
    data =
      list.find((household) => household.id === wanted) ??
      (id === undefined && wanted === undefined && list.length === 1 ? list[0] : null);
  }
  return {
    data,
    isError: households.isError,
    error: households.error,
    refetch: households.refetch,
  };
}

export interface HouseholdActions {
  /** Makes an empty household and moves the device into it. */
  readonly create: (name: string) => Promise<HouseholdResponse>;
  readonly join: (code: string) => Promise<HouseholdResponse>;
  readonly leave: (householdId: string) => Promise<void>;
  readonly removeMember: (householdId: string, memberId: string) => Promise<void>;
  readonly transfer: (householdId: string, memberId: string) => Promise<HouseholdResponse>;
  readonly deleteHousehold: (householdId: string) => Promise<void>;
  readonly invite: (householdId: string) => Promise<string>;
  readonly rename: (householdId: string, name: string) => Promise<HouseholdResponse>;
  /** Moves the device to another space: needs the network and nothing waiting to sync. */
  readonly switchTo: (spaceId: string) => Promise<void>;
  /** The same, naming the household: its book is found from the server, so the stored list need not be current. */
  readonly switchToHousehold: (householdId: string) => Promise<void>;
}

export function useHouseholdActions(): HouseholdActions {
  const api = useApiClient();
  const database = useDatabase();
  const queryClient = useQueryClient();
  const { engine } = useSync();
  const { active } = useSpaces();
  const syncStatus = useOptionalSyncStatus();
  const offline = syncStatus !== null && !syncStatus.reachable;

  /**
   * After a change of scope: line the device up with the server, then read the new books. Given the
   * space to move into, the device goes there; otherwise it stays where it is, or - if that space is
   * gone (left, deleted) - falls back to the personal space.
   */
  const moveDevice = useCallback(
    async (target?: string): Promise<ScopeResult> => {
      const result = await reconcileDataScope(
        database,
        api,
        target === undefined ? {} : { target },
      );
      await queryClient.invalidateQueries({ queryKey: queryKeys.local() });
      if (result === 'switched') void engine.sync('manual');
      return result;
    },
    [api, database, engine, queryClient],
  );

  /** The book of a household just made or joined, found from the server's list of spaces. */
  const bookOf = useCallback(
    async (householdId: string | undefined): Promise<string | undefined> => {
      if (householdId === undefined) return undefined;
      const me = await api.getMe({ spaceId: null }).catch(() => null);
      return me?.spaces?.find((s) => s.kind === 'household' && s.householdId === householdId)?.id;
    },
    [api],
  );

  const refreshHousehold = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.household() });
    await queryClient.invalidateQueries({ queryKey: queryKeys.spaces() });
  }, [queryClient]);

  /** Switching, joining or leaving the open space clears this device's rows, so it must not hold unsent changes. */
  const requireNothingPending = useCallback(async () => {
    if ((await countPendingRecords(database)) > 0) throw new PendingChangesError();
  }, [database]);

  /** Only the open space's rows are on the phone, so only leaving or deleting *it* discards anything. */
  const requireNothingPendingIfOpen = useCallback(
    async (householdId: string) => {
      if (active?.kind === 'household' && active.householdId === householdId) {
        await requireNothingPending();
      }
    },
    [active, requireNothingPending],
  );

  const create = useMutation({
    mutationFn: async (name: string) => {
      await requireNothingPending();
      return await api.createHousehold({ name });
    },
    onSuccess: async (created) => {
      await moveDevice(await bookOf(created.household?.id));
      await refreshHousehold();
    },
  });
  const join = useMutation({
    mutationFn: async (code: string) => {
      await requireNothingPending();
      return await api.joinHousehold({ code });
    },
    onSuccess: async (joined) => {
      await moveDevice(await bookOf(joined.household?.id));
      await refreshHousehold();
    },
  });
  const leave = useMutation({
    mutationFn: async (householdId: string) => {
      await requireNothingPendingIfOpen(householdId);
      await api.leaveHouseholdById(householdId);
    },
    onSuccess: async () => {
      await moveDevice();
      await refreshHousehold();
    },
  });
  const removeMember = useMutation({
    mutationFn: async (args: { householdId: string; memberId: string }) =>
      await api.removeHouseholdMemberById(args.householdId, args.memberId),
    onSuccess: refreshHousehold,
  });
  // Deleting gives the shared books to the owner's personal space, so a device that has it open moves.
  const dissolve = useMutation({
    mutationFn: async (householdId: string) => {
      await requireNothingPendingIfOpen(householdId);
      await api.deleteHouseholdById(householdId);
    },
    onSuccess: async () => {
      await moveDevice();
      await refreshHousehold();
    },
  });
  // Only a role changes hands: no rows move, so nobody's device needs to resync.
  const transferOwnership = useMutation({
    mutationFn: async (args: { householdId: string; memberId: string }) =>
      await api.transferHouseholdById(args.householdId, { memberId: args.memberId }),
    onSuccess: refreshHousehold,
  });
  const invite = useMutation({
    mutationFn: async (householdId: string) =>
      (await api.createHouseholdInviteById(householdId)).data.code,
  });
  const rename = useMutation({
    mutationFn: async (args: { householdId: string; name: string }) =>
      await api.renameHousehold(args.householdId, { name: args.name }),
    onSuccess: async () => {
      await refreshHousehold();
      // The chip shows the name, which the stored list only learns from the server.
      await reconcileDataScope(database, api);
      await queryClient.invalidateQueries({ queryKey: queryKeys.spaces() });
    },
  });
  const switchTo = useMutation({
    mutationFn: async (spaceId: string) => {
      const refusal = switchRefusal({
        offline,
        pending: (await countPendingRecords(database)) > 0,
      });
      if (refusal !== null) throw new SwitchRefusedError(refusal);
      const result = await moveDevice(spaceId);
      if (result === 'skipped') throw new SwitchRefusedError(COPY.spaces.unavailable);
    },
    onSuccess: refreshHousehold,
  });

  return {
    create: create.mutateAsync,
    join: join.mutateAsync,
    leave: leave.mutateAsync,
    removeMember: (householdId, memberId) => removeMember.mutateAsync({ householdId, memberId }),
    transfer: (householdId, memberId) => transferOwnership.mutateAsync({ householdId, memberId }),
    deleteHousehold: dissolve.mutateAsync,
    invite: invite.mutateAsync,
    rename: (householdId, name) => rename.mutateAsync({ householdId, name }),
    switchTo: switchTo.mutateAsync,
    switchToHousehold: async (householdId) => {
      const book = await bookOf(householdId);
      if (book === undefined) throw new SwitchRefusedError(COPY.spaces.unavailable);
      await switchTo.mutateAsync(book);
    },
  };
}
