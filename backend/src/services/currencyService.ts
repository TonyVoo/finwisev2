import { LIMITS, type ChangeCurrencyRequest } from '@expense-tracker/shared';
import type { Db } from '../db/client.ts';
import { toWireUser } from '../db/mappers.ts';
import { nextRevisionBlock } from '../db/revision.ts';
import { problems } from '../errors.ts';
import { logger } from '../logger.ts';
import { confirmPassword } from './authService.ts';

/**
 * Change the account currency, converting every amount of the account's own books at a rate
 * the person gives (`docs/design/19-change-currency.md`).
 *
 * Everything an amount touches moves in one transaction - expenses, goals, recurring rules and
 * category budgets - and a number too large for the contract anywhere refuses the whole thing,
 * so the books are never half in one currency. Every changed row takes a fresh revision (in
 * its old order) so a device that syncs afterwards receives them; the device clears its copy
 * and syncs again rather than merging a mix of old and new.
 *
 * Households are not touched: a household's book is a separate account with a currency of its
 * own, and other members' amounts are theirs to keep.
 */

/** Minor-unit digits of a currency: 2 for USD, 0 for VND / JPY / KRW. */
export function minorUnitDigits(currency: string): number {
  return new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions()
    .maximumFractionDigits as number;
}

const TABLES = ['categories', 'expenses', 'recurring_rules', 'goals'] as const;

export async function changeCurrency(db: Db, userId: string, input: ChangeCurrencyRequest) {
  const account = await confirmPassword(db, userId, input.password);
  const from = account.currency;
  const to = input.currency;

  if (to === from) {
    throw problems.validation('That is already the currency of this account.', {
      issues: [{ path: 'currency', message: 'That is already the currency of this account.' }],
    });
  }

  // 10^(digits difference), so the rate multiplies whole minor units directly.
  const exponent = minorUnitDigits(to) - minorUnitDigits(from);
  const factor = `(${input.rate}::numeric * power(10::numeric, ${exponent}))`;
  const max = LIMITS.AMOUNT_MINOR_MAX;

  const updated = await db.$transaction(async (tx) => {
    // Refuse before writing anything when a converted amount would not fit the contract.
    const tooBig = await tx.$queryRawUnsafe<{ n: bigint }[]>(
      `SELECT count(*)::bigint AS n FROM (
         SELECT amount_minor AS v FROM expenses WHERE user_id = $1::uuid
         UNION ALL SELECT amount_minor FROM recurring_rules WHERE user_id = $1::uuid
         UNION ALL SELECT target_minor FROM goals WHERE user_id = $1::uuid
         UNION ALL SELECT saved_minor FROM goals WHERE user_id = $1::uuid
         UNION ALL SELECT monthly_budget_minor FROM categories
                    WHERE user_id = $1::uuid AND monthly_budget_minor IS NOT NULL
       ) t WHERE round(v::numeric * ${factor}) > ${max}`,
      userId,
    );
    if (Number(tooBig[0]?.n ?? 0) > 0) {
      throw problems.validation(
        'Some amounts would be too large in that currency. Nothing was changed.',
        { issues: [{ path: 'rate', message: 'A converted amount exceeds the maximum.' }] },
      );
    }

    // An expense paid in the new currency gets that exact amount back; one with no original
    // records the old amount as it; one paid in a third currency keeps its original.
    await tx.$executeRawUnsafe(
      `UPDATE expenses SET
         amount_minor = CASE WHEN original_currency = $2 THEN original_amount_minor
                             ELSE round(amount_minor::numeric * ${factor}) END,
         original_amount_minor = CASE WHEN original_currency = $2 THEN NULL
                                      WHEN original_currency IS NULL THEN amount_minor
                                      ELSE original_amount_minor END,
         original_currency = CASE WHEN original_currency = $2 THEN NULL
                                  WHEN original_currency IS NULL THEN currency
                                  ELSE original_currency END,
         currency = $2, updated_at = now()
       WHERE user_id = $1::uuid`,
      userId,
      to,
    );
    await tx.$executeRawUnsafe(
      `UPDATE recurring_rules SET amount_minor = round(amount_minor::numeric * ${factor}),
         currency = $2, updated_at = now() WHERE user_id = $1::uuid`,
      userId,
      to,
    );
    await tx.$executeRawUnsafe(
      `UPDATE goals SET target_minor = greatest(1, round(target_minor::numeric * ${factor})),
         saved_minor = round(saved_minor::numeric * ${factor}),
         currency = $2, updated_at = now() WHERE user_id = $1::uuid`,
      userId,
      to,
    );
    await tx.$executeRawUnsafe(
      `UPDATE categories SET
         monthly_budget_minor = greatest(1, round(monthly_budget_minor::numeric * ${factor})),
         updated_at = now()
       WHERE user_id = $1::uuid AND monthly_budget_minor IS NOT NULL`,
      userId,
    );

    // Fresh revisions, in each table's old order, from the account's own counter.
    const counts = {
      categories: await tx.category.count({ where: { userId, monthlyBudgetMinor: { not: null } } }),
      expenses: await tx.expense.count({ where: { userId } }),
      recurring_rules: await tx.recurringRule.count({ where: { userId } }),
      goals: await tx.goal.count({ where: { userId } }),
    };
    const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
    if (total > 0) {
      const revisions = await nextRevisionBlock(tx, userId, total);
      let cursor = 0;
      for (const table of TABLES) {
        const count = counts[table];
        if (count === 0) continue;
        const base = (revisions[cursor] ?? 1) - 1;
        cursor += count;
        await tx.$executeRawUnsafe(
          `UPDATE "${table}" t SET "revision" = $2::int + r.rn
             FROM (SELECT "id", row_number() OVER (ORDER BY "revision") AS rn
                     FROM "${table}" WHERE "user_id" = $1::uuid
                      ${table === 'categories' ? 'AND "monthly_budget_minor" IS NOT NULL' : ''}) r
            WHERE t."id" = r."id"`,
          userId,
          base,
        );
      }
    }

    return tx.user.update({ where: { id: userId }, data: { currency: to } });
  });

  logger.info('currency changed', { userId, from, to });
  return toWireUser(updated);
}
