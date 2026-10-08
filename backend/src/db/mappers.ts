import type { Category as WireCategory, User as WireUser } from '@expense-tracker/shared';
import type { Category as CategoryRow, User as UserRow } from './generated/client.ts';

/**
 * Row → wire mappers.
 *
 * Every response body is built through one of these rather than by spreading a Prisma
 * row, because a spread is how `passwordHash` ends up on the wire. These pick fields
 * explicitly, so adding a column to the database cannot leak it, and
 * `sendJson`'s schema check catches the reverse mistake of forgetting one.
 */

export function toWireUser(row: UserRow): WireUser {
  return {
    id: row.id,
    email: row.email,
    currency: row.currency,
    createdAt: row.createdAt.toISOString(),
  };
}

export function toWireCategory(row: CategoryRow): WireCategory {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    isDefault: row.isDefault,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    deletedAt: row.deletedAt?.toISOString() ?? null,
    revision: row.revision,
  };
}
