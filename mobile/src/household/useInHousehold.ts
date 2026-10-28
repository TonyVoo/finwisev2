import { useQuery } from '@tanstack/react-query';
import { useDatabase } from '../db/DatabaseProvider';
import { META_KEYS, readMeta } from '../db/meta';
import { queryKeys } from '../query/keys';
import { parseMembers } from './addedBy';

/**
 * Whether this account is in a household, as the phone last heard from `/v1/me`. Only a household
 * has anyone to hide an expense from, so this is what decides whether the "Keep private" switch
 * is offered. `false` until the read has returned: the switch appears a frame late rather than
 * flashing in for an account that should never see it.
 */
export function useInHousehold(): boolean {
  const database = useDatabase();
  const members = useQuery({
    queryKey: queryKeys.householdMembers(),
    queryFn: async () => parseMembers(await readMeta(database, META_KEYS.householdMembers)),
  });
  return (members.data?.length ?? 0) > 0;
}
