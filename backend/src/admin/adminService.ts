import { getConfig } from '../config.ts';
import type { Db } from '../db/client.ts';
import { ApiProblem, problems } from '../errors.ts';
import { logger } from '../logger.ts';
import { removeAccount } from '../services/authService.ts';
import { getQuickAddBudget } from '../services/quickAddReader.ts';
import { getRecapBudget } from '../services/recapReader.ts';
import { getReceiptBudget } from '../services/receiptStrategies.ts';
import { isAdminEmail } from './requireAdmin.ts';
import type { AdminOverview, AdminUser, AdminUserList } from './schemas.ts';

/**
 * What the admin page reads and does (`docs/design/17-admin.md`). Counts and who someone is; never what they
 * spent, wrote or photographed.
 */

/** Households keep their rows under hidden "book" users (`householdBooks.ts`); they are not accounts. */
const BOOK_EMAIL_SUFFIX = '@households.invalid';
const isAccount = { email: { not: { endsWith: BOOK_EMAIL_SUFFIX } } } as const;

const DAY_MS = 86_400_000;

const TREND_DAYS = 14;

/** The last {@link TREND_DAYS} UTC days, oldest first, with a count for each (zero where there was none). */
async function trend(db: Db, now: Date): Promise<AdminOverview['trend']> {
  const days = Array.from({ length: TREND_DAYS }, (_, index) =>
    new Date(now.getTime() - (TREND_DAYS - 1 - index) * DAY_MS).toISOString().slice(0, 10),
  );
  const start = new Date(`${days[0]}T00:00:00.000Z`);
  const [signups, active] = await Promise.all([
    db.$queryRaw<Array<{ day: string; n: number }>>`
      SELECT to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day, count(*)::int AS n
        FROM users
       WHERE created_at >= ${start} AND email NOT LIKE ${`%${BOOK_EMAIL_SUFFIX}`}
       GROUP BY 1`,
    db.$queryRaw<Array<{ day: string; n: number }>>`
      SELECT to_char(r.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day, count(DISTINCT r.user_id)::int AS n
        FROM refresh_tokens r JOIN users u ON u.id = r.user_id
       WHERE r.created_at >= ${start} AND u.email NOT LIKE ${`%${BOOK_EMAIL_SUFFIX}`}
       GROUP BY 1`,
  ]);
  const by = (rows: Array<{ day: string; n: number }>) => {
    const counts = new Map(rows.map((row) => [row.day, row.n]));
    return days.map((day) => counts.get(day) ?? 0);
  };
  return { days, signups: by(signups), active: by(active) };
}

export async function overview(db: Db, now: Date = new Date()): Promise<AdminOverview> {
  const since = (days: number) => new Date(now.getTime() - days * DAY_MS);
  const activeSince = async (days: number) =>
    (
      await db.refreshToken.groupBy({
        by: ['userId'],
        where: { createdAt: { gte: since(days) }, user: isAccount },
      })
    ).length;

  const [
    total,
    verified,
    disabled,
    new7,
    new30,
    active7,
    active30,
    households,
    memberships,
    expenses,
    categories,
    goals,
    recurringRules,
    receipts,
    size,
    series,
  ] = await Promise.all([
    db.user.count({ where: isAccount }),
    db.user.count({ where: { ...isAccount, emailVerifiedAt: { not: null } } }),
    db.user.count({ where: { ...isAccount, disabledAt: { not: null } } }),
    db.user.count({ where: { ...isAccount, createdAt: { gte: since(7) } } }),
    db.user.count({ where: { ...isAccount, createdAt: { gte: since(30) } } }),
    activeSince(7),
    activeSince(30),
    db.household.count(),
    db.householdMember.count(),
    db.expense.count({ where: { deletedAt: null } }),
    db.category.count({ where: { deletedAt: null } }),
    db.goal.count({ where: { deletedAt: null } }),
    db.recurringRule.count({ where: { deletedAt: null } }),
    db.expenseReceipt.count(),
    db.$queryRaw<Array<{ size: bigint }>>`SELECT pg_database_size(current_database()) AS size`,
    trend(db, now),
  ]);

  const config = getConfig();
  return {
    server: {
      version: config.version,
      uptimeSeconds: Math.floor(process.uptime()),
      time: now.toISOString(),
    },
    database: { sizeBytes: Number(size[0]?.size ?? 0n) },
    users: {
      total,
      verified,
      disabled,
      newLast7Days: new7,
      newLast30Days: new30,
      activeLast7Days: active7,
      activeLast30Days: active30,
    },
    households: { total: households, memberships },
    trend: series,
    data: { expenses, categories, goals, recurringRules, receipts },
    gemini: {
      configured: config.vision.geminiApiKey !== undefined,
      model: config.vision.geminiModel,
      receipts: getReceiptBudget().usage(now),
      quickAdd: getQuickAddBudget().usage(now),
      recap: getRecapBudget().usage(now),
    },
  };
}

interface UserRow {
  readonly id: string;
  readonly email: string;
  readonly displayName: string | null;
  readonly currency: string;
  readonly createdAt: Date;
  readonly emailVerifiedAt: Date | null;
  readonly disabledAt: Date | null;
}

async function toAdminUsers(db: Db, rows: readonly UserRow[]): Promise<AdminUser[]> {
  const ids = rows.map((row) => row.id);
  const [active, expenses, households] = await Promise.all([
    db.refreshToken.groupBy({
      by: ['userId'],
      where: { userId: { in: ids } },
      _max: { createdAt: true },
    }),
    db.expense.groupBy({
      by: ['userId'],
      where: { userId: { in: ids }, deletedAt: null },
      _count: { _all: true },
    }),
    db.householdMember.groupBy({
      by: ['userId'],
      where: { userId: { in: ids } },
      _count: { _all: true },
    }),
  ]);
  const lastActive = new Map(active.map((g) => [g.userId, g._max.createdAt]));
  const expenseCount = new Map(expenses.map((g) => [g.userId, g._count._all]));
  const householdCount = new Map(households.map((g) => [g.userId, g._count._all]));

  return rows.map((row) => ({
    id: row.id,
    email: row.email,
    displayName: row.displayName,
    currency: row.currency,
    createdAt: row.createdAt.toISOString(),
    emailVerified: row.emailVerifiedAt !== null,
    disabledAt: row.disabledAt?.toISOString() ?? null,
    lastActiveAt: lastActive.get(row.id)?.toISOString() ?? null,
    expenseCount: expenseCount.get(row.id) ?? 0,
    householdCount: householdCount.get(row.id) ?? 0,
    isAdmin: isAdminEmail(row.email),
  }));
}

const USER_SELECT = {
  id: true,
  email: true,
  displayName: true,
  currency: true,
  createdAt: true,
  emailVerifiedAt: true,
  disabledAt: true,
} as const;

/** Accounts, newest first: ids are time-ordered, so the id is the cursor. */
export async function listUsers(
  db: Db,
  query: { search?: string | undefined; limit: number; cursor?: string | undefined },
): Promise<AdminUserList> {
  const search = query.search?.toLowerCase();
  const rows = await db.user.findMany({
    where: {
      ...isAccount,
      ...(search === undefined || search === '' ? {} : { email: { contains: search } }),
      ...(query.cursor === undefined ? {} : { id: { lt: query.cursor } }),
    },
    orderBy: { id: 'desc' },
    take: query.limit + 1,
    select: USER_SELECT,
  });
  const page = rows.slice(0, query.limit);
  return {
    users: await toAdminUsers(db, page),
    nextCursor: rows.length > query.limit ? (page[page.length - 1]?.id ?? null) : null,
  };
}

/** The account named, which must be a real one (not a household's book) - the same `404` otherwise. */
async function accountOf(db: Db, id: string) {
  const user = await db.user.findFirst({ where: { id, ...isAccount }, select: USER_SELECT });
  if (user === null) throw problems.notFound('No such account.');
  return user;
}

/** An admin never acts on themselves or another admin, so a slip cannot lock the operator out. */
function refuseAdmins(adminId: string, target: { id: string; email: string }): void {
  if (target.id === adminId || isAdminEmail(target.email)) {
    throw new ApiProblem(
      'forbidden',
      'An admin account cannot be changed here. Remove it from ADMIN_EMAILS first.',
    );
  }
}

export async function setDisabled(
  db: Db,
  adminId: string,
  targetId: string,
  disabled: boolean,
): Promise<AdminUser> {
  const target = await accountOf(db, targetId);
  refuseAdmins(adminId, target);

  const row = await db.$transaction(async (tx) => {
    const updated = await tx.user.update({
      where: { id: targetId },
      data: { disabledAt: disabled ? new Date() : null },
      select: USER_SELECT,
    });
    // Disabling ends every session; enabling does not bring them back (the person signs in again).
    if (disabled) {
      await tx.refreshToken.updateMany({
        where: { userId: targetId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
    return updated;
  });

  logger.info(disabled ? 'admin disabled an account' : 'admin enabled an account', {
    adminId,
    userId: targetId,
  });
  const [user] = await toAdminUsers(db, [row]);
  return user!;
}

export async function deleteUser(
  db: Db,
  adminId: string,
  targetId: string,
  confirmEmail: string,
): Promise<void> {
  const target = await accountOf(db, targetId);
  refuseAdmins(adminId, target);
  if (confirmEmail.toLowerCase() !== target.email) {
    throw problems.validation('The email does not match the account.', {
      issues: [{ path: 'email', message: 'must be the email of the account to delete' }],
    });
  }

  await removeAccount(db, targetId);
  logger.info('admin deleted an account', { adminId, userId: targetId });
}
