import { type HouseholdResponse } from '@expense-tracker/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect } from 'react';
import { AppState } from 'react-native';
import { ApiRequestError, NetworkUnavailableError } from '../api/errors';
import { useApiClient } from '../bootstrap/AppProviders';
import { COPY } from '../copy/strings';
import { useDatabase } from '../db/DatabaseProvider';
import { countPendingRecords } from '../db/queries';
import { queryKeys } from '../query/keys';
import { useSync } from '../sync/SyncProvider';
import { reconcileDataScope } from './dataScope';

/**
 * Household membership is **server state**: who is in the household, and who owns it. Unlike
 * expenses it is never read from SQLite and has no offline mode, which is why this module talks
 * to the API directly - the one deliberate exception to "feature code reads local data", in the
 * same spirit as the auth screens. The *effect* of membership on the books is local, and
 * `reconcileDataScope` is what brings the device into line with it.
 */

/** Why an action did not happen, as the words to show. */
export function householdErrorMessage(error: unknown): string {
  if (error instanceof PendingChangesError) return error.message;
  if (error instanceof NetworkUnavailableError) return COPY.household.offline;
  if (error instanceof ApiRequestError) {
    const known = COPY.household.error as Readonly<Record<string, string>>;
    return known[error.code] ?? COPY.error.generic;
  }
  return COPY.error.generic;
}

/** Thrown, rather than sent, when a switch would discard changes that have not synced. */
export class PendingChangesError extends Error {
  constructor() {
    super(COPY.household.syncFirst);
    this.name = 'PendingChangesError';
  }
}

export function useHousehold() {
  const api = useApiClient();
  const query = useQuery({
    queryKey: queryKeys.household(),
    queryFn: async () => (await api.getHousehold()).household,
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

export interface HouseholdActions {
  readonly create: () => Promise<HouseholdResponse>;
  readonly join: (code: string) => Promise<HouseholdResponse>;
  readonly leave: () => Promise<void>;
  readonly removeMember: (memberId: string) => Promise<void>;
  readonly transfer: (memberId: string) => Promise<HouseholdResponse>;
  readonly deleteHousehold: () => Promise<void>;
  readonly invite: () => Promise<string>;
}

export function useHouseholdActions(): HouseholdActions {
  const api = useApiClient();
  const database = useDatabase();
  const queryClient = useQueryClient();
  const { engine } = useSync();

  /** After a change of scope: line the device up with the server, then read the new books. */
  const moveDeviceToServerScope = useCallback(async () => {
    const result = await reconcileDataScope(database, api);
    await queryClient.invalidateQueries({ queryKey: queryKeys.local() });
    if (result === 'switched') void engine.sync('manual');
  }, [api, database, engine, queryClient]);

  const refreshHousehold = useCallback(
    () => queryClient.invalidateQueries({ queryKey: queryKeys.household() }),
    [queryClient],
  );

  /** Joining or leaving clears this device's rows, so it must not hold unsent changes. */
  const requireNothingPending = useCallback(async () => {
    if ((await countPendingRecords(database)) > 0) throw new PendingChangesError();
  }, [database]);

  // Creating moves the person's own books into the household's, so whose books this device
  // holds changes, exactly as when joining: nothing unsent, then line the device up.
  const create = useMutation({
    mutationFn: async () => {
      await requireNothingPending();
      return await api.createHousehold();
    },
    onSuccess: async () => {
      await moveDeviceToServerScope();
      await refreshHousehold();
    },
  });
  const join = useMutation({
    mutationFn: async (code: string) => {
      await requireNothingPending();
      return await api.joinHousehold({ code });
    },
    onSuccess: async () => {
      await moveDeviceToServerScope();
      await refreshHousehold();
    },
  });
  const leave = useMutation({
    mutationFn: async () => {
      await requireNothingPending();
      await api.leaveHousehold();
    },
    onSuccess: async () => {
      await moveDeviceToServerScope();
      await refreshHousehold();
    },
  });
  const removeMember = useMutation({
    mutationFn: async (memberId: string) => await api.removeHouseholdMember(memberId),
    onSuccess: refreshHousehold,
  });
  // Deleting gives the shared books to the owner, so the owner's device changes books too.
  const dissolve = useMutation({
    mutationFn: async () => {
      await requireNothingPending();
      await api.deleteHousehold();
    },
    onSuccess: async () => {
      await moveDeviceToServerScope();
      await refreshHousehold();
    },
  });
  // Only a role changes hands: no rows move, so nobody's device needs to resync.
  const transferOwnership = useMutation({
    mutationFn: async (memberId: string) => await api.transferHousehold({ memberId }),
    onSuccess: refreshHousehold,
  });
  const invite = useMutation({
    mutationFn: async () => (await api.createHouseholdInvite()).data.code,
  });

  return {
    create: create.mutateAsync,
    join: join.mutateAsync,
    leave: leave.mutateAsync,
    removeMember: removeMember.mutateAsync,
    transfer: transferOwnership.mutateAsync,
    deleteHousehold: dissolve.mutateAsync,
    invite: invite.mutateAsync,
  };
}
