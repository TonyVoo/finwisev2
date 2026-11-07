import { COPY } from '../copy/strings';
import type { GoalListItem } from '../db/queries';
import { monthName } from '../lib/calendar';
import { formatMoney } from '../lib/money';
import type { SpendEntry } from './summaryModel';

/**
 * The month as a page the system can print to PDF, like the year report: plain HTML and inline CSS, no scripts and no
 * remote resources, because the device's own print service renders it. Everything a person typed (category and goal
 * names) is escaped. The figures are handed in already worked out; nothing here adds anything up.
 */

export interface MonthReportStocks {
  readonly worthDong: number;
  readonly unrealizedDong: number;
  readonly holdings: ReadonlyArray<{ readonly symbol: string; readonly valueDong: number | null }>;
}

export interface MonthReport {
  readonly month: string;
  readonly currency: string;
  readonly spentMinor: number;
  readonly incomeMinor: number;
  readonly entries: readonly SpendEntry[];
  readonly goals: readonly GoalListItem[];
  /** Only for an account in dong with trades, and only when prices could be had. */
  readonly stocks: MonthReportStocks | null;
  readonly insights: readonly string[];
  /** The day the report was made, `YYYY-MM-DD`. */
  readonly madeOn: string;
}

const ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};
const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (c) => ESCAPES[c] ?? c);

export function monthReportHtml(report: MonthReport, locale?: string): string {
  const copy = COPY.summary.report;
  const money = (minor: number) => formatMoney(minor, report.currency, locale);
  const dong = (value: number) => formatMoney(Math.round(value), 'VND', locale);
  const title = `${copy.title} · ${monthName(report.month, locale)} ${report.month.slice(0, 4)}`;
  const left = report.incomeMinor - report.spentMinor;

  const categoryRows = report.entries
    .map((e) => {
      const budget =
        e.budget === null
          ? ''
          : `<span class="${e.budget.over ? 'over' : 'muted'}">${escapeHtml(copy.budget)} ${escapeHtml(money(e.budget.budgetMinor))}</span>`;
      return `<tr><td><span class="dot" style="background:${escapeHtml(e.color)}"></span>${escapeHtml(e.name)}</td>
<td>${budget}</td><td class="num">${escapeHtml(money(e.totalMinor))}</td><td class="num">${escapeHtml(e.percentLabel ?? '')}</td></tr>`;
    })
    .join('\n');

  const goalRows = report.goals
    .map((g) => {
      const percent =
        g.targetMinor > 0 ? Math.min(100, Math.floor((g.savedMinor * 100) / g.targetMinor)) : 0;
      return `<tr><td>${escapeHtml(g.name)}</td>
<td class="bar"><span style="width:${percent}%"></span></td>
<td class="num">${escapeHtml(formatMoney(g.savedMinor, g.currency, locale))} / ${escapeHtml(formatMoney(g.targetMinor, g.currency, locale))}</td></tr>`;
    })
    .join('\n');

  const stocks = report.stocks;
  const stockRows =
    stocks === null
      ? ''
      : stocks.holdings
          .map(
            (h) =>
              `<tr><td>${escapeHtml(h.symbol)}</td><td class="num">${h.valueDong === null ? '—' : escapeHtml(dong(h.valueDong))}</td></tr>`,
          )
          .join('\n');

  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>
body{font-family:-apple-system,Roboto,sans-serif;color:#111827;margin:32px}
h1{font-size:26px;margin:0 0 4px}h2{font-size:16px;margin:24px 0 8px}
.facts{display:flex;flex-wrap:wrap;gap:16px}.fact{min-width:140px}.fact b{display:block;font-size:20px}
table{width:100%;border-collapse:collapse}td{padding:4px 6px;border-bottom:1px solid #eee;font-size:13px}
.num{text-align:right;white-space:nowrap}.bar{width:35%}.bar span{display:block;height:8px;background:#0F7B63;border-radius:4px}
.dot{display:inline-block;width:10px;height:10px;border-radius:5px;margin-right:6px}
.muted{color:#6B7280}.over{color:#B42318;font-weight:600}.foot{margin-top:28px;font-size:11px;color:#6B7280}
</style></head><body>
<h1>${escapeHtml(title)}</h1>
<div class="facts">
<div class="fact">${escapeHtml(copy.spent)}<b>${escapeHtml(money(report.spentMinor))}</b></div>
<div class="fact">${escapeHtml(copy.income)}<b>${escapeHtml(money(report.incomeMinor))}</b></div>
<div class="fact">${escapeHtml(copy.left)}<b>${escapeHtml(money(left))}</b></div>
</div>
${
  report.insights.length === 0
    ? ''
    : `<h2>${escapeHtml(copy.insights)}</h2>${report.insights.map((s) => `<p>${escapeHtml(s)}</p>`).join('')}`
}
${
  report.entries.length === 0
    ? `<p class="muted">${escapeHtml(copy.empty)}</p>`
    : `<h2>${escapeHtml(copy.categories)}</h2><table>${categoryRows}</table>`
}
${report.goals.length === 0 ? '' : `<h2>${escapeHtml(copy.goals)}</h2><table>${goalRows}</table>`}
${
  stocks === null
    ? ''
    : `<h2>${escapeHtml(copy.stocks)}</h2>
<div class="facts"><div class="fact">${escapeHtml(copy.worth)}<b>${escapeHtml(dong(stocks.worthDong))}</b></div>
<div class="fact">${escapeHtml(copy.result)}<b>${escapeHtml(dong(stocks.unrealizedDong))}</b></div></div>
<table>${stockRows}</table>`
}
<p class="foot">${escapeHtml(copy.generated.replace('{date}', report.madeOn))}</p>
</body></html>`;
}
