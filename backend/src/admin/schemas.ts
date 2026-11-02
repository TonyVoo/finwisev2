import { z } from 'zod';

/**
 * The admin page's wire shapes (`docs/design/17-admin.md`). Not in `shared/`: this is an operator console,
 * not part of the contract the mobile app is built against. They carry counts and who someone is, and
 * deliberately nothing about what anyone spent.
 */

const Budget = z.strictObject({ used: z.number().int().min(0), limit: z.number().int().min(0) });

export const AdminOverview = z.strictObject({
  server: z.strictObject({
    version: z.string(),
    uptimeSeconds: z.number().int().min(0),
    time: z.string(),
  }),
  database: z.strictObject({ sizeBytes: z.number().int().min(0) }),
  users: z.strictObject({
    total: z.number().int().min(0),
    verified: z.number().int().min(0),
    disabled: z.number().int().min(0),
    newLast7Days: z.number().int().min(0),
    newLast30Days: z.number().int().min(0),
    activeLast7Days: z.number().int().min(0),
    activeLast30Days: z.number().int().min(0),
  }),
  households: z.strictObject({
    total: z.number().int().min(0),
    memberships: z.number().int().min(0),
  }),
  data: z.strictObject({
    expenses: z.number().int().min(0),
    categories: z.number().int().min(0),
    goals: z.number().int().min(0),
    recurringRules: z.number().int().min(0),
    receipts: z.number().int().min(0),
  }),
  gemini: z.strictObject({
    configured: z.boolean(),
    model: z.string(),
    receipts: Budget,
    quickAdd: Budget,
    recap: Budget,
  }),
});

export const AdminUser = z.strictObject({
  id: z.uuid(),
  email: z.string(),
  displayName: z.string().nullable(),
  currency: z.string(),
  createdAt: z.string(),
  emailVerified: z.boolean(),
  disabledAt: z.string().nullable(),
  lastActiveAt: z.string().nullable(),
  expenseCount: z.number().int().min(0),
  householdCount: z.number().int().min(0),
  isAdmin: z.boolean(),
});

export const AdminUserList = z.strictObject({
  users: z.array(AdminUser),
  nextCursor: z.string().nullable(),
});

export const AdminUserResponse = z.strictObject({ user: AdminUser });
export const AdminMeResponse = z.strictObject({ email: z.string() });

export const AdminUsersQuery = z.strictObject({
  search: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.uuid().optional(),
});

export const AdminDeleteRequest = z.strictObject({ email: z.string().trim().min(1) });

export type AdminDeleteRequest = z.infer<typeof AdminDeleteRequest>;
export type AdminOverview = z.infer<typeof AdminOverview>;
export type AdminUser = z.infer<typeof AdminUser>;
export type AdminUserList = z.infer<typeof AdminUserList>;
