import { useQuery } from '@tanstack/react-query';
import { useCallback } from 'react';
import { useDatabase } from '../db/DatabaseProvider';
import { useUserEmail } from '../db/hooks';
import { META_KEYS, readMeta } from '../db/meta';
import { queryKeys } from '../query/keys';
import { addedByText, parseMembers } from './addedBy';

/**
 * A function from an expense's `createdBy` to the line to show ("Added by Bao"), or `null`.
 * Reads the members stored from `/v1/me`, so it works offline.
 */
export function useAddedBy(): (createdBy: string | null) => string | null {
  const database = useDatabase();
  const members = useQuery({
    queryKey: queryKeys.householdMembers(),
    queryFn: async () => parseMembers(await readMeta(database, META_KEYS.householdMembers)),
  });
  const myEmail = useUserEmail().data;
  const list = members.data;

  return useCallback(
    (createdBy: string | null) =>
      list === undefined ? null : addedByText(createdBy, list, myEmail),
    [list, myEmail],
  );
}
