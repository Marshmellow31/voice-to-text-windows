import type { Stats } from "../lib/types";
import { avgWpm, computeStreaks } from "../lib/stats";
import Heatmap from "./Heatmap";
import StatCard from "./StatCard";

export default function InsightsPage({ stats }: { stats: Stats }) {
  const streaks = computeStreaks(stats.days);
  const minutes = Math.round(stats.total_speaking_secs / 60);

  return (
    <div className="mx-auto max-w-4xl px-8 py-10">
      <h1 className="mb-6 font-display text-3xl text-ink">Insights</h1>

      <div className="grid grid-cols-3 gap-5">
        <StatCard
          value={String(avgWpm(stats))}
          label="Words per minute"
          sub="Average speaking rate across all dictations"
        />
        <StatCard
          value={stats.total_words.toLocaleString()}
          label="Total words dictated"
          sub={`${minutes.toLocaleString()} minute${minutes === 1 ? "" : "s"} of speaking`}
        />
        <StatCard
          value={stats.total_dictations.toLocaleString()}
          label="Dictations"
          sub="Every hold-speak-release counts as one"
        />
      </div>

      <div className="mt-5 rounded-2xl border border-cream-dark bg-white p-6 shadow-sm">
        <div className="mb-5 flex items-baseline justify-between">
          <h2 className="font-display text-2xl text-ink">
            {streaks.current} day streak
          </h2>
          <span className="text-xs font-semibold uppercase tracking-wider text-ink-soft">
            Longest streak | {streaks.longest} day{streaks.longest === 1 ? "" : "s"}
          </span>
        </div>
        <Heatmap days={stats.days} />
      </div>
    </div>
  );
}
