import type { Budget, Overview as OverviewData } from './api.ts';
import { bytes, duration, number } from './format.ts';

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="card stat">
      <div className="value">{value}</div>
      <div className="label">{label}</div>
      {note === undefined ? null : <div className="note">{note}</div>}
    </div>
  );
}

const use = (budget: Budget): string => `${number(budget.used)} of ${number(budget.limit)} today`;

/** Counts and health only: never anyone's spending. */
export function Overview({ data }: { data: OverviewData }) {
  const { users, households, gemini } = data;
  return (
    <div className="grid">
      <Stat
        label="Accounts"
        value={number(users.total)}
        note={`${number(users.verified)} verified, ${number(users.disabled)} disabled`}
      />
      <Stat
        label="New in 7 days"
        value={number(users.newLast7Days)}
        note={`${number(users.newLast30Days)} in 30 days`}
      />
      <Stat
        label="Active in 7 days"
        value={number(users.activeLast7Days)}
        note={`${number(users.activeLast30Days)} in 30 days`}
      />
      <Stat
        label="Households"
        value={number(households.total)}
        note={`${number(households.memberships)} memberships`}
      />
      <Stat
        label="Expenses"
        value={number(data.data.expenses)}
        note={`${number(data.data.categories)} categories, ${number(data.data.goals)} goals`}
      />
      <Stat
        label="Receipt photos"
        value={number(data.data.receipts)}
        note={`${number(data.data.recurringRules)} recurring rules`}
      />
      <Stat label="Database" value={bytes(data.database.sizeBytes)} />
      <Stat
        label="Server"
        value={data.server.version}
        note={`up ${duration(data.server.uptimeSeconds)}`}
      />
      <Stat
        label="Gemini"
        value={gemini.configured ? 'On' : 'Off'}
        note={gemini.configured ? gemini.model : 'no key set'}
      />
      <Stat label="Receipt reading" value={use(gemini.receipts)} />
      <Stat label="Quick add" value={use(gemini.quickAdd)} />
      <Stat label="Monthly recap" value={use(gemini.recap)} />
    </div>
  );
}
