import {
  ALERTS_MAX,
  InvestingAlert,
  type InvestingPutRequest,
  type InvestingPutResponse,
  type InvestingSettings,
  type PushTokenRequest,
  WATCHLIST_MAX,
} from '@expense-tracker/shared';
import { z } from 'zod';
import { getPrisma } from '../db/client.ts';

/**
 * The investing settings (watchlist and price alerts) as one document per account, and the push tokens.
 *
 * A write is applied only against the version it was made on (a compare-and-set in one statement, so two writers
 * cannot both win). A stale write changes nothing and gets the current document back, which the device merges.
 * What is stored is parsed again on the way out: a row written by another version of the code that no longer fits
 * is read as empty rather than served.
 */

const StoredAlerts = z.array(InvestingAlert);
const StoredWatchlist = z.array(z.string());

const EMPTY: InvestingSettings = { watchlist: [], alerts: [], version: 0 };

function fromRow(row: { watchlist: unknown; alerts: unknown; version: number }): InvestingSettings {
  const alerts = StoredAlerts.safeParse(row.alerts);
  const watchlist = StoredWatchlist.safeParse(row.watchlist);
  return {
    watchlist: watchlist.success ? watchlist.data.slice(0, WATCHLIST_MAX) : [],
    alerts: alerts.success ? alerts.data.slice(0, ALERTS_MAX) : [],
    version: row.version,
  };
}

/** The list with repeats removed, first one kept, so a client bug cannot store the same symbol or id twice. */
function unique<T>(items: readonly T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const k = key(item);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export async function getInvesting(userId: string): Promise<InvestingSettings> {
  const row = await getPrisma().investingSettings.findUnique({ where: { userId } });
  return row === null ? EMPTY : fromRow(row);
}

export async function putInvesting(
  userId: string,
  request: InvestingPutRequest,
): Promise<InvestingPutResponse> {
  const prisma = getPrisma();
  const watchlist = unique(request.watchlist, (s) => s);
  const alerts = unique(request.alerts, (a) => a.id);

  const applied = await prisma.$transaction(async (tx) => {
    if (request.baseVersion === 0) {
      // The first write: only one of two racing first writes may create the row.
      const created = await tx.investingSettings.createMany({
        data: [{ userId, watchlist, alerts, version: 1 }],
        skipDuplicates: true,
      });
      return created.count === 1;
    }
    const updated = await tx.investingSettings.updateMany({
      where: { userId, version: request.baseVersion },
      data: { watchlist, alerts, version: request.baseVersion + 1 },
    });
    return updated.count === 1;
  });

  return { data: await getInvesting(userId), applied };
}

/**
 * Mark alerts fired, against the version they were read at. False when someone wrote in between, in which case the
 * caller looks again rather than overwrite: the person's edit wins over the job's.
 */
export async function markAlertsFired(
  userId: string,
  readAt: InvestingSettings,
  fired: ReadonlyMap<string, { readonly at: string; readonly price: number }>,
): Promise<boolean> {
  const alerts = readAt.alerts.map((a) => {
    const f = fired.get(a.id);
    return f === undefined ? a : { ...a, firedAt: f.at, firedPrice: f.price };
  });
  const updated = await getPrisma().investingSettings.updateMany({
    where: { userId, version: readAt.version },
    data: { alerts, version: readAt.version + 1 },
  });
  return updated.count === 1;
}

/** Every account that has an alert still waiting, with its document. */
export async function listWaiting(): Promise<
  ReadonlyArray<{ userId: string; settings: InvestingSettings }>
> {
  const rows = await getPrisma().$queryRaw<Array<{ user_id: string }>>`
    SELECT user_id FROM investing_settings
    WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(alerts) a WHERE a->>'firedAt' IS NULL)`;
  const result: Array<{ userId: string; settings: InvestingSettings }> = [];
  for (const { user_id } of rows)
    result.push({ userId: user_id, settings: await getInvesting(user_id) });
  return result;
}

export async function registerPushToken(userId: string, request: PushTokenRequest): Promise<void> {
  await getPrisma().pushToken.upsert({
    where: { token: request.token },
    create: { token: request.token, userId, platform: request.platform },
    update: { userId, platform: request.platform },
  });
}

export async function pushTokensOf(userId: string): Promise<string[]> {
  const rows = await getPrisma().pushToken.findMany({ where: { userId }, select: { token: true } });
  return rows.map((r) => r.token);
}

export async function forgetPushTokens(tokens: readonly string[]): Promise<void> {
  if (tokens.length === 0) return;
  await getPrisma().pushToken.deleteMany({ where: { token: { in: [...tokens] } } });
}
