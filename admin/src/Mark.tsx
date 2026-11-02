/** The app's receipt mark (`mobile/assets`): a teal receipt with a check and a torn edge. */
export function Mark({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 64 64"
      role="img"
      aria-label="Expenses"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect width="64" height="64" rx="15" fill="var(--primary-subtle)" />
      <path
        d="M19 14h26a3 3 0 0 1 3 3v31l-4.3-3-4.3 3-4.3-3-4.3 3-4.3-3-4.3 3-4.3-3-.1 3V17a3 3 0 0 1 3-3z"
        fill="var(--primary)"
        transform="translate(-1.5 -0.5)"
      />
      <path
        d="m24 31.5 5 5 10-11.5"
        fill="none"
        stroke="var(--on-primary)"
        strokeWidth="3.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M24 21h15M24 25h9"
        stroke="var(--on-primary)"
        strokeOpacity="0.55"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
    </svg>
  );
}
