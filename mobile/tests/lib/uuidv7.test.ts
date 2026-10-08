import { createUuidv7, uuidv7, uuidv7Timestamp } from '@/lib/uuidv7';
import { Uuid } from '@expense-tracker/shared';

/** Deterministic byte source, so the only varying part of an id is what we are testing. */
function fixedRandomBytes(fill: number) {
  return (byteCount: number) => new Uint8Array(byteCount).fill(fill);
}

describe('createUuidv7', () => {
  it('mints ids the wire contract accepts', () => {
    // The server stores this verbatim as a primary key, so it has to be valid there.
    for (let i = 0; i < 20; i += 1) {
      expect(() => Uuid.parse(uuidv7())).not.toThrow();
    }
  });

  it('sets the version and variant bits of a v7', () => {
    const id = createUuidv7({ now: () => 0, randomBytes: fixedRandomBytes(0) })();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('encodes the millisecond clock in the first 48 bits', () => {
    const now = Date.parse('2026-10-08T10:30:00.000Z');
    const id = createUuidv7({ now: () => now, randomBytes: fixedRandomBytes(0) })();
    // Epoch milliseconds already exceed 2^32, so this is also the regression test for
    // encoding them with a 32-bit shift and silently wrapping.
    expect(uuidv7Timestamp(id)).toBe(now);
    expect(now).toBeGreaterThan(2 ** 32);
  });

  /**
   * The property the outbox and the expense list rely on. `ORDER BY date, id` is only
   * deterministic if ids minted in the same millisecond still order by creation.
   */
  it('is strictly increasing within one millisecond', () => {
    const next = createUuidv7({ now: () => 1_760_000_000_000, randomBytes: fixedRandomBytes(0) });
    const ids = Array.from({ length: 500 }, next);

    expect(new Set(ids).size).toBe(500);
    expect([...ids].sort()).toEqual(ids);
  });

  it('is increasing across milliseconds', () => {
    let clock = 1_760_000_000_000;
    const next = createUuidv7({ now: () => clock, randomBytes: fixedRandomBytes(0) });
    const ids = Array.from({ length: 50 }, () => {
      clock += 1;
      return next();
    });

    expect([...ids].sort()).toEqual(ids);
  });

  it('keeps increasing when the clock steps backwards', () => {
    let clock = 1_760_000_000_000;
    const next = createUuidv7({ now: () => clock, randomBytes: fixedRandomBytes(0) });

    const before = next();
    // An NTP correction, or the user setting the device date back. Ids must not go
    // backwards whatever the clock does, or a later write can sort before an earlier one.
    clock -= 60_000;
    const after = next();

    expect(after > before).toBe(true);
  });

  it('borrows the next millisecond rather than repeating when the counter fills', () => {
    // `rand_a` is 12 bits and seeded from 11, so the counter has at least 2048 and at
    // most 4096 increments inside one millisecond. Minting past that must not duplicate.
    const next = createUuidv7({ now: () => 1_760_000_000_000, randomBytes: fixedRandomBytes(255) });
    const ids = Array.from({ length: 5000 }, next);

    expect(new Set(ids).size).toBe(5000);
    expect([...ids].sort()).toEqual(ids);
    expect(uuidv7Timestamp(ids.at(-1)!)).toBeGreaterThan(uuidv7Timestamp(ids[0]!));
  });

  it('seeds the counter in the bottom half of its range', () => {
    // Seeding from the full 12 bits would leave an id minted at 0x0fff with no head-room
    // at all, and every subsequent id in that millisecond would borrow a millisecond.
    const next = createUuidv7({ now: () => 0, randomBytes: fixedRandomBytes(255) });
    const counter = Number.parseInt(next().replace(/-/g, '').slice(12, 16), 16) & 0x0fff;
    expect(counter).toBeLessThanOrEqual(0x07ff);
  });

  it('gives independent generators independent state', () => {
    const options = { now: () => 1_760_000_000_000, randomBytes: fixedRandomBytes(7) };
    // Same clock, same bytes, same counter seed: two generators would collide if the app
    // ever used more than one. It uses the shared instance; this pins why.
    expect(createUuidv7(options)()).toBe(createUuidv7(options)());
  });

  it('exposes a shared generator that uses real randomness', () => {
    const ids = Array.from({ length: 100 }, uuidv7);
    expect(new Set(ids).size).toBe(100);
    // A guessable id is a guessable primary key the server accepts verbatim, so the
    // random half must actually vary.
    const randomHalves = new Set(ids.map((id) => id.slice(19)));
    expect(randomHalves.size).toBe(100);
  });
});
