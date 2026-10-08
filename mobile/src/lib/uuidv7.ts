import * as Crypto from 'expo-crypto';

/**
 * UUIDv7 (RFC 9562 §5.7) minted on the client.
 *
 * The sync protocol has no temp-id remapping: the client mints the primary key
 * offline and the server stores it as-is (`docs/PLAN.md` §4). So a row's identity
 * never changes, and a foreign key written offline — an expense pointing at a
 * category created in the same session — stays valid when both sync.
 *
 * v7 rather than v4 because the first 48 bits are a millisecond timestamp, so ids
 * sort in creation order. That gives the outbox and the expense list a stable
 * tie-breaker for free, and keeps SQLite's B-tree inserts append-mostly.
 *
 * Ids minted in the same millisecond are kept **strictly increasing** using the
 * dedicated-counter method of RFC 9562 §6.2: `rand_a` (12 bits) is seeded randomly
 * at the start of each millisecond and incremented for every subsequent id in it.
 * Without that, two expenses saved in the same millisecond would order arbitrarily
 * and `ORDER BY date, id` would not be deterministic.
 */

const VERSION_NIBBLE = 0x70;
const VARIANT_BITS = 0x80;

const COUNTER_MAX = 0x0fff; // 12 bits of rand_a
/**
 * Seed the counter from 11 random bits, so it always starts in the bottom half of
 * its range and has at least 2048 increments of head-room within the millisecond.
 */
const COUNTER_SEED_MASK = 0x07ff;

/** Source of cryptographic randomness, injectable so tests are deterministic. */
export type RandomBytes = (byteCount: number) => Uint8Array;

export interface Uuidv7Options {
  /** Millisecond clock. Defaults to `Date.now`. */
  readonly now?: () => number;
  readonly randomBytes?: RandomBytes;
}

/**
 * Expo's runtime exposes a `crypto.getRandomValues` backed by the platform CSPRNG;
 * `expo-crypto` is the explicit fallback for runtimes that do not. Both are
 * cryptographically secure — `Math.random` is never acceptable here, because a
 * guessable id is a guessable primary key the server accepts verbatim.
 */
const defaultRandomBytes: RandomBytes = (byteCount) => {
  const webCrypto = globalThis.crypto;
  if (typeof webCrypto?.getRandomValues === 'function') {
    return webCrypto.getRandomValues(new Uint8Array(byteCount));
  }
  return Crypto.getRandomBytes(byteCount);
};

const HEX = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, '0'));

function format(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < 16; i += 1) {
    if (i === 4 || i === 6 || i === 8 || i === 10) out += '-';
    out += HEX[bytes[i]!]!;
  }
  return out;
}

/**
 * Build an independent generator with its own monotonic state. The app uses the
 * shared {@link uuidv7} instance; tests build their own so the counter and clock
 * start from a known point.
 */
export function createUuidv7(options: Uuidv7Options = {}): () => string {
  const now = options.now ?? Date.now;
  const randomBytes = options.randomBytes ?? defaultRandomBytes;

  let lastMs = -1;
  let counter = 0;

  const seedCounter = (): void => {
    const seed = randomBytes(2);
    counter = (((seed[0]! << 8) | seed[1]!) & COUNTER_SEED_MASK) >>> 0;
  };

  return function uuidv7(): string {
    const clockMs = now();
    if (clockMs > lastMs) {
      lastMs = clockMs;
      seedCounter();
    } else {
      // Same millisecond, or a clock that stepped backwards (NTP correction, user
      // changing the device date). Either way we hold the previous timestamp and
      // advance the counter: ids must never go backwards, whatever the clock does.
      counter += 1;
      if (counter > COUNTER_MAX) {
        // 4096 ids inside one millisecond. Borrow the next millisecond rather than
        // blocking the caller or emitting a duplicate.
        lastMs += 1;
        seedCounter();
      }
    }

    const bytes = new Uint8Array(16);

    // unix_ts_ms: 48 bits, big-endian. Division rather than `>>>`, which would
    // truncate to 32 bits and wrap — epoch milliseconds already exceed 2^32.
    let remaining = lastMs;
    for (let i = 5; i >= 0; i -= 1) {
      bytes[i] = remaining % 256;
      remaining = Math.floor(remaining / 256);
    }

    bytes[6] = VERSION_NIBBLE | (counter >>> 8);
    bytes[7] = counter & 0xff;

    const rand = randomBytes(8);
    bytes[8] = VARIANT_BITS | (rand[0]! & 0x3f);
    for (let i = 1; i < 8; i += 1) bytes[8 + i] = rand[i]!;

    return format(bytes);
  };
}

/** The app-wide generator. */
export const uuidv7 = createUuidv7();

/** Milliseconds encoded in the first 48 bits of a UUIDv7. Used by tests and debug tooling. */
export function uuidv7Timestamp(id: string): number {
  const hex = id.replace(/-/g, '').slice(0, 12);
  return Number.parseInt(hex, 16);
}
