import {
  REALM_FLOORS,
  pointsOf,
  realmName,
  stageName,
  streakDays,
  tuViOf,
} from '@/cultivation/tuVi';

describe('points', () => {
  it('count days logged, saved months and goals reached', () => {
    expect(pointsOf({ daysLogged: 20, monthsSaved: 2, goalsReached: 1 })).toBe(20 + 30 + 50);
    expect(pointsOf({ daysLogged: 0, monthsSaved: 0, goalsReached: 0 })).toBe(0);
  });
});

describe('tuViOf', () => {
  it('starts in the first realm, early stage', () => {
    expect(tuViOf(0)).toMatchObject({ realm: 0, stage: 0, progress: 0, nextIsRealm: false });
  });

  it('changes realm exactly at each floor', () => {
    REALM_FLOORS.forEach((floor, realm) => {
      expect(tuViOf(floor).realm).toBe(realm);
      if (floor > 0) expect(tuViOf(floor - 1).realm).toBe(realm - 1);
    });
  });

  it('splits a realm into four stages, the last leading into the next realm', () => {
    // Qi Refining is 0..29: stages begin at 0, 8, 15, 23 (a quarter each, rounded up).
    expect([0, 7, 8, 14, 15, 22, 23, 29].map((p) => tuViOf(p).stage)).toEqual([
      0, 0, 1, 1, 2, 2, 3, 3,
    ]);
    expect(tuViOf(23).nextIsRealm).toBe(true);
    expect(tuViOf(22).nextIsRealm).toBe(false);
  });

  it('measures progress within the stage and the points still needed', () => {
    const t = tuViOf(4);
    expect(t.toNext).toBe(4); // stage 0 runs to 8
    expect(t.progress).toBeCloseTo(0.5);
    expect(tuViOf(29).toNext).toBe(1);
  });

  it('never goes down as points grow, and Ascension is the end', () => {
    let previous = -1;
    for (let p = 0; p <= 1100; p += 1) {
      const t = tuViOf(p);
      const rank = t.realm * 10 + t.stage;
      expect(rank).toBeGreaterThanOrEqual(previous);
      previous = rank;
    }
    expect(tuViOf(1000)).toMatchObject({ realm: 5, toNext: null, progress: 1 });
    expect(tuViOf(5000).realm).toBe(5);
  });

  it('treats a negative or fractional input as the nearest whole point at or above zero', () => {
    expect(tuViOf(-4).points).toBe(0);
    expect(tuViOf(12.9).points).toBe(12);
  });
});

describe('streakDays', () => {
  const days = ['2026-11-09', '2026-11-08', '2026-11-07', '2026-11-05'];
  it('counts the unbroken run ending today', () => {
    expect(streakDays(days, '2026-11-09')).toBe(3);
  });
  it('does not break on a today with no entry yet', () => {
    expect(streakDays(days, '2026-11-10')).toBe(3);
  });
  it('is zero once a whole day has been missed', () => {
    expect(streakDays(days, '2026-11-11')).toBe(0);
    expect(streakDays([], '2026-11-09')).toBe(0);
  });
  it('is not confused by repeats, order or a gap', () => {
    expect(streakDays(['2026-11-05', '2026-11-09', '2026-11-09', '2026-11-08'], '2026-11-09')).toBe(
      2,
    );
  });
  it('crosses month and year ends', () => {
    expect(streakDays(['2027-01-01', '2026-12-31', '2026-12-30'], '2027-01-01')).toBe(3);
  });
});

describe('names', () => {
  it('has a name for every realm and stage in both languages', () => {
    for (let r = 0; r < REALM_FLOORS.length; r += 1) {
      expect(realmName(r, 'vi')).not.toBe('');
      expect(realmName(r, 'en')).not.toBe('');
    }
    for (let s = 0; s < 4; s += 1) {
      expect(stageName(s, 'vi')).not.toBe('');
      expect(stageName(s, 'en')).not.toBe('');
    }
  });
});
