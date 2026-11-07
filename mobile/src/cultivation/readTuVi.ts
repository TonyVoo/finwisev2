import { META_KEYS, readMeta, writeMeta } from '../db/meta';
import { listLiveGoals, monthlyIncomeTotals, monthlyTotals } from '../db/queries';
import type { SqliteDatabase } from '../db/sqlite';
import { stepMonth } from '../lib/calendar';
import { type Facts, type TuVi, pointsOf, streakDays, tuViOf } from './tuVi';

/** How far back months are looked at for "ended with income above spending". */
const MONTHS_BACK = 36;

export interface Cultivation extends TuVi {
  readonly facts: Facts;
  readonly streak: number;
}

export async function readCultivation(
  database: SqliteDatabase,
  today: string,
): Promise<Cultivation> {
  const rows = await database.getAllAsync<{ date: string }>(
    `SELECT DISTINCT date FROM expenses WHERE deletedAt IS NULL AND kind = 'expense' ORDER BY date DESC`,
    [],
  );
  const dates = rows.map((r) => r.date);

  // Complete months only: the one going on has not ended.
  const thisMonth = today.slice(0, 7);
  const last = stepMonth(thisMonth, -1);
  const first = stepMonth(thisMonth, -MONTHS_BACK);
  const [spent, earned] = await Promise.all([
    monthlyTotals(database, first, last),
    monthlyIncomeTotals(database, first, last),
  ]);
  const spentBy = new Map(spent.map((m) => [m.month, m.totalMinor]));
  const monthsSaved = earned.filter(
    (m) => m.totalMinor > 0 && m.totalMinor > (spentBy.get(m.month) ?? 0),
  ).length;

  const goals = await listLiveGoals(database);
  const goalsReached = goals.filter(
    (g) => g.targetMinor > 0 && g.savedMinor >= g.targetMinor,
  ).length;

  const facts: Facts = { daysLogged: dates.length, monthsSaved, goalsReached };
  return { ...tuViOf(pointsOf(facts)), facts, streak: streakDays(dates, today) };
}

/** The realm last shown to the person, or null before the first time. */
export async function readShownRealm(database: SqliteDatabase): Promise<number | null> {
  const raw = await readMeta(database, META_KEYS.cultivationRealm);
  const n = raw === null ? NaN : Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

export async function writeShownRealm(database: SqliteDatabase, realm: number): Promise<void> {
  await writeMeta(database, META_KEYS.cultivationRealm, String(realm));
}
