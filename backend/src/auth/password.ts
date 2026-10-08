import { hash, verify, type Algorithm } from '@node-rs/argon2';

/**
 * Password hashing. argon2id, per `docs/PLAN.md` §3.
 *
 * The parameters are the OWASP-recommended argon2id baseline (19 MiB, 2 passes, 1 lane)
 * and are also `@node-rs/argon2`'s defaults; they are stated explicitly because a
 * library changing its default must not silently weaken stored hashes. The cost
 * parameters are encoded in the digest itself, so raising them later still verifies
 * existing hashes.
 */

/**
 * `Algorithm.Argon2id`, written as its numeric value.
 *
 * `@node-rs/argon2` declares `Algorithm` as an *ambient* `const enum`, which
 * `verbatimModuleSyntax` forbids reading at runtime — there is no emitted object to read
 * it from. The `satisfies` keeps it honest: if upstream ever drops this member, the
 * build breaks rather than quietly selecting argon2d.
 */
const ARGON2ID = 2 satisfies Algorithm;

const PARAMS = {
  algorithm: ARGON2ID,
  /** KiB. */
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

/**
 * A pre-computed digest of a value no password can be, used by {@link verifyPassword}
 * when the account does not exist.
 *
 * Hashing is deliberately slow, so "no such email" returning immediately while "wrong
 * password" takes ~50ms turns the login endpoint into an account-enumeration oracle
 * timing-wise, even though both answer `401 invalid_credentials`. Verifying against
 * this digest makes the two paths cost the same.
 *
 * Generated once at module load rather than checked in, so it cannot be mistaken for a
 * real credential.
 */
const dummyDigest: Promise<string> = hash(
  'not-a-password-this-is-the-timing-equaliser',
  PARAMS,
).catch(() => '');

export async function hashPassword(plaintext: string): Promise<string> {
  return hash(plaintext, PARAMS);
}

/**
 * Check a password against a stored digest.
 *
 * Pass `undefined` when the email matched no account: the work is still done, so the
 * response time does not reveal whether the account exists.
 *
 * `verify` is called without {@link PARAMS} on purpose. The cost parameters live in the
 * digest, and passing today's values would make a hash written under yesterday's
 * parameters unverifiable — which is a lockout, not a security improvement.
 */
export async function verifyPassword(
  plaintext: string,
  storedHash: string | undefined,
): Promise<boolean> {
  if (storedHash === undefined) {
    await verify(await dummyDigest, plaintext).catch(() => false);
    return false;
  }
  // A malformed digest in the database is a failed login, not a 500 — but it is also
  // never supposed to happen, so it must not be indistinguishable from a wrong password
  // to an operator reading logs. The caller logs the generic failure; this returns false.
  return verify(storedHash, plaintext).catch(() => false);
}
