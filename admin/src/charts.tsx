/** A small trend line with a soft fill, in the page's teal. Decorative: the numbers beside it say the same. */
export function Spark({ values }: { values: number[] }) {
  const width = 240;
  const height = 56;
  const pad = 10;
  const max = Math.max(1, ...values);
  const step = (width - pad * 2) / Math.max(1, values.length - 1);
  const points = values.map(
    (value, index) =>
      [pad + index * step, height - pad - (value / max) * (height - pad * 2 - 4)] as const,
  );
  const line = points
    .map(([x, y], index) => `${index === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`)
    .join(' ');
  const last = points[points.length - 1];
  const area = `${line} L${(last?.[0] ?? pad).toFixed(1)} ${height} L${pad} ${height} Z`;
  return (
    <svg
      className="spark"
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="spark-fill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="var(--primary)" stopOpacity="0.28" />
          <stop offset="100%" stopColor="var(--primary)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#spark-fill)" />
      <path
        d={line}
        fill="none"
        stroke="var(--primary)"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
      {last === undefined ? null : (
        <circle
          cx={last[0]}
          cy={last[1]}
          r="3.4"
          fill="var(--primary)"
          stroke="var(--surface)"
          strokeWidth="2"
          vectorEffect="non-scaling-stroke"
        />
      )}
    </svg>
  );
}

/** A progress ring that turns amber near the limit, like the budget rings in the app. */
export function Ring({ share }: { share: number }) {
  const radius = 26;
  const circumference = 2 * Math.PI * radius;
  const high = share >= 80;
  return (
    <svg className="ring" viewBox="0 0 64 64" aria-hidden="true">
      <circle cx="32" cy="32" r={radius} fill="none" stroke="var(--sunken)" strokeWidth="7" />
      <circle
        cx="32"
        cy="32"
        r={radius}
        fill="none"
        stroke={high ? 'var(--warning)' : 'var(--primary)'}
        strokeWidth="7"
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={circumference * (1 - Math.min(100, share) / 100)}
        transform="rotate(-90 32 32)"
        className="ring-arc"
      />
    </svg>
  );
}
