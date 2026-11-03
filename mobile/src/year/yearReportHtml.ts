import { COPY } from '../copy/strings';
import { monthName } from '../lib/calendar';
import { formatMoney } from '../lib/money';
import type { YearReport } from './yearReport';

/**
 * The year report as a page the system can print to PDF. Plain HTML and inline CSS - no scripts, no remote
 * resources - because it is rendered by the device's own print service. Everything a person typed (category
 * names) is escaped.
 */

const ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};
const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (c) => ESCAPES[c] ?? c);

export function yearReportHtml(report: YearReport, currency: string, locale?: string): string {
  const copy = COPY.yearReport;
  const money = (minor: number) => formatMoney(minor, currency, locale);
  const biggest = Math.max(1, ...report.months.map((m) => m.totalMinor));
  const month = (key: string) => monthName(key, locale);

  const monthRows = report.months
    .map(
      (m) => `<tr class="month"><td>${escapeHtml(month(m.month))}</td>
<td class="bar"><span style="width:${Math.round((m.totalMinor / biggest) * 100)}%"></span></td>
<td class="num">${escapeHtml(money(m.totalMinor))}</td></tr>`,
    )
    .join('\n');

  const categoryRows = report.categories
    .map(
      (
        c,
      ) => `<tr><td><span class="dot" style="background:${escapeHtml(c.color)}"></span>${escapeHtml(c.name)}</td>
<td class="num">${escapeHtml(money(c.totalMinor))}</td><td class="num">${Math.round(c.share * 100)}%</td></tr>`,
    )
    .join('\n');

  const compare = (name: string, amount: number, template: string) =>
    `<p>${escapeHtml(
      template
        .replace('{name}', name)
        .replace('{amount}', money(Math.abs(amount)))
        .replace('{year}', String(report.year - 1)),
    )}</p>`;

  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${escapeHtml(copy.title)} ${report.year}</title>
<style>
body{font-family:-apple-system,Roboto,sans-serif;color:#111827;margin:32px}
h1{font-size:26px;margin:0 0 4px}h2{font-size:16px;margin:24px 0 8px}
.facts{display:flex;flex-wrap:wrap;gap:16px}.fact{min-width:140px}.fact b{display:block;font-size:20px}
table{width:100%;border-collapse:collapse}td{padding:4px 6px;border-bottom:1px solid #eee;font-size:13px}
.num{text-align:right;white-space:nowrap}.bar{width:45%}.bar span{display:block;height:8px;background:#4F46E5;border-radius:4px}
.dot{display:inline-block;width:10px;height:10px;border-radius:5px;margin-right:6px}
</style></head><body>
<h1>${escapeHtml(copy.title)} ${report.year}</h1>
<div class="facts">
<div class="fact">${escapeHtml(copy.spent)}<b>${escapeHtml(money(report.totalMinor))}</b></div>
<div class="fact">${escapeHtml(copy.income)}<b>${escapeHtml(money(report.incomeMinor))}</b></div>
<div class="fact">${escapeHtml(copy.saved)}<b>${escapeHtml(money(report.savedMinor))}</b></div>
<div class="fact">${escapeHtml(copy.average)}<b>${escapeHtml(money(report.averageMinor))}</b></div>
</div>
${report.biggestRise === null ? '' : compare(report.biggestRise.name, report.biggestRise.deltaMinor, copy.rise)}
${report.biggestFall === null ? '' : compare(report.biggestFall.name, report.biggestFall.deltaMinor, copy.fall)}
<h2>${escapeHtml(copy.months)}</h2>
<table>${monthRows}</table>
<h2>${escapeHtml(copy.categories)}</h2>
<table>${categoryRows}</table>
</body></html>`;
}
