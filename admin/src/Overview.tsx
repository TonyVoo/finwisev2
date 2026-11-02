import type { Budget, Overview as OverviewData } from './api.ts';
import { Ring, Spark } from './charts.tsx';
import { bytes, duration, number } from './format.ts';
import { Icon, type IconName } from './icons.tsx';

const sum = (values: number[]): number => values.reduce((total, value) => total + value, 0);

/** The two big numbers: calm, large, with the last two weeks behind them. */
function Hero({
  label,
  value,
  caption,
  delta,
  values,
}: {
  label: string;
  value: string;
  caption: string;
  delta?: string;
  values: number[];
}) {
  return (
    <section className="card hero rise">
      <div className="hero-top">
        <span className="label">{label}</span>
        {delta === undefined ? null : <span className="pill on">{delta}</span>}
      </div>
      <div className="hero-value">{value}</div>
      <div className="note">{caption}</div>
      <Spark values={values} />
    </section>
  );
}

function Tile({
  icon,
  label,
  value,
  note,
}: {
  icon: IconName;
  label: string;
  value: string;
  note?: string;
}) {
  return (
    <div className="card tile rise">
      <Icon name={icon} />
      <div>
        <div className="label">{label}</div>
        <div className="tile-value">{value}</div>
        {note === undefined ? null : <div className="note">{note}</div>}
      </div>
    </div>
  );
}

/** Today's use of a Gemini feature against its daily budget. */
function Usage({ label, budget }: { label: string; budget: Budget }) {
  const share = budget.limit === 0 ? 0 : Math.round((budget.used / budget.limit) * 100);
  return (
    <div className="card usage-card rise">
      <div className="ring-wrap">
        <Ring share={share} />
        <span className="ring-text">{`${Math.min(100, share)}%`}</span>
      </div>
      <div>
        <div className="label">{label}</div>
        <div className="tile-value">{number(budget.used)}</div>
        <div className="note">{`${number(budget.used)} of ${number(budget.limit)} today`}</div>
      </div>
    </div>
  );
}

/** Counts and health only: never anyone's spending. */
export function Overview({ data }: { data: OverviewData }) {
  const { users, households, gemini, trend } = data;
  const week = users.newLast7Days;
  return (
    <>
      <div className="hero-grid">
        <Hero
          label="Accounts"
          value={number(users.total)}
          caption={`${number(users.verified)} verified · ${number(users.disabled)} disabled`}
          delta={week > 0 ? `+${number(week)} this week` : undefined}
          values={trend.signups}
        />
        <Hero
          label="Active in 7 days"
          value={number(users.activeLast7Days)}
          caption={`${number(users.activeLast30Days)} in 30 days · ${number(sum(trend.signups))} new in 14 days`}
          values={trend.active}
        />
      </div>

      <div className="grid">
        <Tile
          icon="home"
          label="Households"
          value={number(households.total)}
          note={`${number(households.memberships)} memberships`}
        />
        <Tile
          icon="list"
          label="Expenses"
          value={number(data.data.expenses)}
          note={`${number(data.data.categories)} categories · ${number(data.data.goals)} goals`}
        />
        <Tile
          icon="camera"
          label="Receipt photos"
          value={number(data.data.receipts)}
          note={`${number(data.data.recurringRules)} recurring rules`}
        />
        <Tile
          icon="database"
          label="Database"
          value={bytes(data.database.sizeBytes)}
          note={`server ${data.server.version} · up ${duration(data.server.uptimeSeconds)}`}
        />
      </div>

      <div className="section-head" style={{ marginTop: 28 }}>
        <h3 className="section-title">Gemini today</h3>
        <span className={gemini.configured ? 'pill on' : 'pill'}>
          {gemini.configured ? `On · ${gemini.model}` : 'Off · no key set'}
        </span>
      </div>
      <div className="grid three">
        <Usage label="Receipt reading" budget={gemini.receipts} />
        <Usage label="Quick add" budget={gemini.quickAdd} />
        <Usage label="Monthly recap" budget={gemini.recap} />
      </div>
    </>
  );
}
