import { Space } from '@expense-tracker/shared';
import type { SpaceSource } from '../api/authorize';
import { META_KEYS, readMeta } from '../db/meta';
import type { SqliteExecutor } from '../db/sqlite';

/**
 * The books the account can work in (`docs/design/13-multiple-households.md`), as the phone keeps them: the
 * list `GET /v1/me` last gave, for the switcher to show offline, and the one the store holds.
 */

/** What `reconcileDataScope` stored. Junk, or nothing, is no spaces. */
export function parseSpaces(json: string | null): readonly Space[] {
  if (json === null) return [];
  try {
    const parsed = Space.array().safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

export async function readSpaces(executor: SqliteExecutor): Promise<readonly Space[]> {
  return parseSpaces(await readMeta(executor, META_KEYS.spaces));
}

/**
 * The space every request names: the one the store holds, read each time so a switch takes effect on the
 * very next request. Absent until the first answer from the server, which then picks its own default.
 */
export function createActiveSpaceSource(executor: SqliteExecutor): SpaceSource {
  return { getSpaceId: () => readMeta(executor, META_KEYS.dataScope) };
}
