import { META_KEYS, readMeta, writeMeta } from '../db/meta';
import type { SqliteDatabase } from '../db/sqlite';

/**
 * What the home-screen widget shows: today's spending (the default) or the portfolio's value. A device preference,
 * kept with the other settings and not wiped when the account's data is.
 */

export type WidgetMode = 'spending' | 'portfolio';

export const WIDGET_LINKS: Readonly<Record<WidgetMode, string>> = {
  spending: 'expensetracker://expense/new',
  portfolio: 'expensetracker://portfolio',
};

/** What is stored means a mode; anything unrecognised is the default, never an error. */
export function parseWidgetMode(raw: string | null | undefined): WidgetMode {
  return raw === 'portfolio' ? 'portfolio' : 'spending';
}

export async function readWidgetMode(database: SqliteDatabase): Promise<WidgetMode> {
  return parseWidgetMode(await readMeta(database, META_KEYS.widgetMode));
}

export async function writeWidgetMode(database: SqliteDatabase, mode: WidgetMode): Promise<void> {
  await writeMeta(database, META_KEYS.widgetMode, mode);
}

export interface WidgetText {
  readonly title: string;
  readonly amount: string;
  /** The words on the widget's button. */
  readonly button: string;
  readonly link: string;
}

/** The four things the widget shows for the portfolio: its name, its value, how it is doing, and where a tap goes. */
export function portfolioWidgetText(
  title: string,
  worth: string,
  changeText: string,
  open: string,
): WidgetText {
  return {
    title,
    amount: worth,
    button: changeText === '' ? open : changeText,
    link: WIDGET_LINKS.portfolio,
  };
}
