import { useQuery } from '@tanstack/react-query';
import { useDatabase } from '../db/DatabaseProvider';
import { META_KEYS, readMeta } from '../db/meta';
import { queryKeys } from '../query/keys';
import { type MemberRef, parseMembers } from './addedBy';

const NONE: readonly MemberRef[] = [];

/** The household's members as the phone last heard them from `/v1/me`; none until read, or when solo. */
export function useHouseholdMembers(): readonly MemberRef[] {
  const database = useDatabase();
  const members = useQuery({
    queryKey: queryKeys.householdMembers(),
    queryFn: async () => parseMembers(await readMeta(database, META_KEYS.householdMembers)),
  });
  return members.data ?? NONE;
}
