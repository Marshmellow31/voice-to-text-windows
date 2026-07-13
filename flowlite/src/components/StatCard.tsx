interface Props {
  value: string;
  label: string;
  sub?: string;
}

export default function StatCard({ value, label, sub }: Props) {
  return (
    <div className="rounded-2xl border border-cream-dark bg-white p-6 shadow-sm">
      <div className="font-display text-4xl text-ink">{value}</div>
      <div className="mt-1 text-xs font-semibold uppercase tracking-wider text-ink-soft">
        {label}
      </div>
      {sub && <div className="mt-3 border-t border-cream-dark pt-3 text-sm text-ink-soft">{sub}</div>}
    </div>
  );
}
