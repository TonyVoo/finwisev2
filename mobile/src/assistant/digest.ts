import { ASSISTANT_CONTEXT_MAX } from '@expense-tracker/shared';
import type { CategorySpend, GoalListItem } from '../db/queries';
import { formatMoney } from '../lib/money';
import type { Position } from '../invest/portfolioModel';

/**
 * What the assistant is told about the person, as plain lines of text.
 *
 * Only figures leave the device, and only these: this month's spend by category, income, the limit,
 * the last months' totals, the goals, and the holdings with their weights. No notes, no merchants, no
 * names of people. The cap is the server's, and the lines are ordered by how much they matter so that
 * a long list is cut at its least useful end rather than in the middle of a figure.
 */

export interface DigestHolding {
  readonly symbol: string;
  readonly quantity: number;
  /** Dong paid for what is held now. */
  readonly cost: number;
  /** Dong at the last close, or null with no price. */
  readonly marketValue: number | null;
}

export interface DigestInput {
  readonly month: string;
  readonly currency: string;
  readonly locale?: string;
  readonly spend: readonly CategorySpend[];
  readonly incomeMinor: number;
  readonly limitMinor: number | null;
  /** Oldest first, ending at `month`. */
  readonly trend: ReadonlyArray<{ readonly month: string; readonly totalMinor: number }>;
  readonly goals: readonly GoalListItem[];
  readonly holdings: readonly DigestHolding[];
  readonly realized: number;
  readonly dividends: number;
}

/** What a position contributes: its symbol, size, cost and (when priced) value. */
export function holdingOf(position: Position, close: number | null): DigestHolding {
  return {
    symbol: position.symbol,
    quantity: position.quantity,
    cost: position.cost,
    marketValue: close === null ? null : position.quantity * close,
  };
}

const MAX_CATEGORIES = 12;
const MAX_GOALS = 8;
const MAX_HOLDINGS = 15;

export function buildDigest(input: DigestInput): string {
  const money = (minor: number) => formatMoney(minor, input.currency, input.locale);
  const formatDong = (value: number) => formatMoney(Math.round(value), 'VND', input.locale);
  const spent = input.spend.reduce((sum, row) => sum + row.totalMinor, 0);
  const lines: string[] = [];

  lines.push(`Tháng ${input.month}.`);
  lines.push(`Tổng chi: ${money(spent)}. Thu nhập: ${money(input.incomeMinor)}.`);
  if (input.limitMinor !== null) {
    lines.push(`Hạn mức chi cả tháng: ${money(input.limitMinor)}.`);
  }

  if (input.spend.length > 0) {
    lines.push('Chi theo danh mục (lớn nhất trước):');
    for (const row of input.spend.slice(0, MAX_CATEGORIES)) {
      const share = spent > 0 ? Math.round((row.totalMinor * 100) / spent) : 0;
      const budget =
        row.monthlyBudgetMinor === null ? '' : `, ngân sách ${money(row.monthlyBudgetMinor)}`;
      lines.push(
        `- ${row.name ?? 'Chưa phân loại'}: ${money(row.totalMinor)} (${share}%${budget})`,
      );
    }
    const rest = input.spend.length - MAX_CATEGORIES;
    if (rest > 0) lines.push(`- và ${rest} danh mục nhỏ khác`);
  }

  if (input.trend.length > 1) {
    lines.push(
      `Chi các tháng gần đây: ${input.trend.map((m) => `${m.month} ${money(m.totalMinor)}`).join('; ')}.`,
    );
  }

  if (input.goals.length > 0) {
    lines.push('Mục tiêu tiết kiệm:');
    for (const goal of input.goals.slice(0, MAX_GOALS)) {
      const percent =
        goal.targetMinor > 0 ? Math.floor((goal.savedMinor * 100) / goal.targetMinor) : 0;
      const due = goal.deadline === null ? '' : `, hạn ${goal.deadline}`;
      lines.push(
        `- ${goal.name}: ${money(goal.savedMinor)} / ${money(goal.targetMinor)} (${percent}%${due})`,
      );
    }
  }

  if (input.holdings.length > 0) {
    const worth = input.holdings.reduce((sum, h) => sum + (h.marketValue ?? h.cost), 0);
    lines.push(`Danh mục chứng khoán (đồng), tổng giá trị ước tính ${formatDong(worth)}:`);
    for (const h of [...input.holdings]
      .sort((a, b) => (b.marketValue ?? b.cost) - (a.marketValue ?? a.cost))
      .slice(0, MAX_HOLDINGS)) {
      const value = h.marketValue ?? h.cost;
      const weight = worth > 0 ? Math.round((value * 100) / worth) : 0;
      const result =
        h.marketValue === null
          ? 'chưa có giá'
          : `lãi/lỗ chưa chốt ${formatDong(h.marketValue - h.cost)}`;
      lines.push(
        `- ${h.symbol}: ${h.quantity} cổ phiếu, vốn ${formatDong(h.cost)}, tỷ trọng ${weight}%, ${result}`,
      );
    }
  }
  if (input.holdings.length > 0 || input.realized !== 0 || input.dividends !== 0) {
    lines.push(
      `Đã chốt lãi/lỗ: ${formatDong(input.realized)}. Cổ tức đã nhận: ${formatDong(input.dividends)}.`,
    );
  }

  // Cut at a line, never in the middle of one, and say so.
  let text = '';
  for (const line of lines) {
    const next = text === '' ? line : `${text}\n${line}`;
    if (next.length > ASSISTANT_CONTEXT_MAX - 40) return `${text}\n(đã lược bớt)`;
    text = next;
  }
  return text;
}
