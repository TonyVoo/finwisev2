/**
 * Narrow Prisma's runtime errors to the few we actually branch on.
 *
 * Written as structural type guards rather than `instanceof
 * Prisma.PrismaClientKnownRequestError` so that nothing outside `src/db/` has to import
 * the generated client, and so a Prisma upgrade that moves the error classes cannot
 * break a handler's control flow silently.
 */

interface KnownRequestErrorShape {
  readonly code: string;
  readonly meta?: unknown;
}

function asKnownRequestError(error: unknown): KnownRequestErrorShape | undefined {
  if (error === null || typeof error !== 'object') return undefined;
  const code = (error as { code?: unknown }).code;
  if (typeof code !== 'string') return undefined;
  return error as KnownRequestErrorShape;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : undefined;
}

function stringsIn(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string');
  return [];
}

/**
 * The names a unique-constraint violation points at, lowercased.
 *
 * Two shapes, because Prisma reports this differently depending on how it reached the
 * database. Prisma 7's driver adapters surface the underlying Postgres error, where the
 * violated thing is an *index* (`users_email_key`) or a column list; older/engine-based
 * errors put a column list in `meta.target`. Both are read, so neither a Prisma upgrade
 * nor a change of adapter turns "that email is taken" into a 500.
 */
function violatedNames(error: KnownRequestErrorShape): string[] {
  const meta = asRecord(error.meta);
  if (!meta) return [];

  const names = stringsIn(meta.target);

  const cause = asRecord(asRecord(meta.driverAdapterError)?.cause);
  const constraint = asRecord(cause?.constraint);
  if (constraint) {
    names.push(...stringsIn(constraint.index), ...stringsIn(constraint.fields));
  }

  return names.map((name) => name.toLowerCase());
}

/**
 * Did this write violate a unique constraint?
 *
 * Pass `field` to ask about a specific column — `isUniqueViolation(e, 'email')` is the
 * difference between "that email is taken" and "some other constraint fired", which
 * must not be reported to the client as the same thing.
 *
 * The match is a substring one so that both the column (`email`) and the index name
 * Postgres actually reports (`users_email_key`) count as a hit.
 */
export function isUniqueViolation(error: unknown, field?: string): boolean {
  const known = asKnownRequestError(error);
  if (known?.code !== 'P2002') return false;
  if (field === undefined) return true;
  const needle = field.toLowerCase();
  return violatedNames(known).some((name) => name === needle || name.includes(needle));
}

/** `P2003` — a foreign key was not satisfied (e.g. an unknown `categoryId`). */
export function isForeignKeyViolation(error: unknown): boolean {
  return asKnownRequestError(error)?.code === 'P2003';
}

/** `P2025` — an update/delete matched no row. */
export function isRecordNotFound(error: unknown): boolean {
  return asKnownRequestError(error)?.code === 'P2025';
}
