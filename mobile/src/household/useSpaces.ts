import type { Space } from '@expense-tracker/shared';
import { useQuery } from '@tanstack/react-query';
import { useDatabase } from '../db/DatabaseProvider';
import { META_KEYS, readMeta } from '../db/meta';
import { queryKeys } from '../query/keys';
import { activeSpaceOf, needsSwitcher } from './spaceModel';
import { parseSpaces } from './spaces';

export interface SpacesState {
  readonly spaces: readonly Space[];
  /** The space the store holds; `null` until there is a list to say which. */
  readonly active: Space | null;
  /** Whether there is more than one space to choose between. */
  readonly switchable: boolean;
}

const NONE: SpacesState = { spaces: [], active: null, switchable: false };

/**
 * The books the account can work in and the one open now, as `reconcileDataScope` last stored them. A
 * SQLite read, so it works offline and is refreshed whenever the local reads are.
 */
export function useSpaces(): SpacesState {
  const database = useDatabase();
  const query = useQuery({
    queryKey: queryKeys.spaces(),
    queryFn: async (): Promise<SpacesState> => {
      const spaces = parseSpaces(await readMeta(database, META_KEYS.spaces));
      const active = activeSpaceOf(spaces, await readMeta(database, META_KEYS.dataScope));
      return { spaces, active, switchable: needsSwitcher(spaces) };
    },
  });
  return query.data ?? NONE;
}
