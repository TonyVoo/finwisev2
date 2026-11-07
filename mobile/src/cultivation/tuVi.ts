import { REALMS_EN, REALMS_VI } from '../copy/tutien';

/**
 * Tu vi: the person's own discipline, as a cultivation realm (`docs/design/30-tu-tien.md` §3). Pure and integer-only;
 * the facts come from what they already record, and nothing here is stored or sent.
 *
 * Đạo hạnh (points) = days an expense was recorded + 15 per month that ended with income above spending + 50 per
 * savings goal reached. A realm does not go down: points only ever grow.
 */

/** Where each large realm begins, in points. */
export const REALM_FLOORS = [0, 30, 100, 250, 500, 1000] as const;
export const STAGES = 4;

export interface Facts {
  readonly daysLogged: number;
  readonly monthsSaved: number;
  readonly goalsReached: number;
}

export function pointsOf(facts: Facts): number {
  return facts.daysLogged + facts.monthsSaved * 15 + facts.goalsReached * 50;
}

export interface TuVi {
  readonly points: number;
  /** Index into the realm names, 0 (Qi Refining) .. 5 (Ascension). */
  readonly realm: number;
  /** 0 .. 3: early, middle, late, peak. The last realm has no stages. */
  readonly stage: number;
  /** 0..1 through the current stage, for the gauge. 1 at Ascension. */
  readonly progress: number;
  /** Points to the next stage (or realm at the last stage), or null at Ascension. */
  readonly toNext: number | null;
  /** True when the next step is into a new large realm. */
  readonly nextIsRealm: boolean;
}

export function tuViOf(points: number): TuVi {
  const p = Math.max(0, Math.floor(points));
  let realm = 0;
  for (let i = 0; i < REALM_FLOORS.length; i += 1) if (p >= (REALM_FLOORS[i] as number)) realm = i;
  const last = REALM_FLOORS.length - 1;
  if (realm === last)
    return { points: p, realm, stage: 0, progress: 1, toNext: null, nextIsRealm: false };

  const floor = REALM_FLOORS[realm] as number;
  const ceiling = REALM_FLOORS[realm + 1] as number;
  const span = ceiling - floor;
  // A quarter of the realm per stage, the last stage taking any remainder.
  const stage = Math.min(STAGES - 1, Math.floor(((p - floor) * STAGES) / span));
  const stageFloor = floor + Math.ceil((stage * span) / STAGES);
  const stageCeiling =
    stage === STAGES - 1 ? ceiling : floor + Math.ceil(((stage + 1) * span) / STAGES);
  return {
    points: p,
    realm,
    stage,
    progress: (p - stageFloor) / Math.max(1, stageCeiling - stageFloor),
    toNext: stageCeiling - p,
    nextIsRealm: stage === STAGES - 1,
  };
}

/**
 * The unbroken run of days with an entry, ending today or, if today has none yet, yesterday (the day is not over, so
 * it does not break the run). `dates` are `YYYY-MM-DD`, any order, repeats allowed.
 */
export function streakDays(dates: readonly string[], today: string): number {
  const have = new Set(dates);
  const day = (iso: string, back: number): string => {
    const d = new Date(`${iso}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - back);
    return d.toISOString().slice(0, 10);
  };
  let start = have.has(today) ? 0 : 1;
  if (!have.has(day(today, start))) return 0;
  let run = 0;
  while (have.has(day(today, start + run))) run += 1;
  return run;
}

export const STAGE_NAMES_VI = ['Sơ kỳ', 'Trung kỳ', 'Hậu kỳ', 'Đỉnh phong'] as const;
export const STAGE_NAMES_EN = ['Early', 'Middle', 'Late', 'Peak'] as const;

export function realmName(realm: number, language: 'vi' | 'en'): string {
  return (language === 'vi' ? REALMS_VI : REALMS_EN)[realm] ?? '';
}
export function stageName(stage: number, language: 'vi' | 'en'): string {
  return (language === 'vi' ? STAGE_NAMES_VI : STAGE_NAMES_EN)[stage] ?? '';
}
