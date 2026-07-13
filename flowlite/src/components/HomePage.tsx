import type { HistoryEntry, Stats } from "../lib/types";
import { avgWpm, computeStreaks } from "../lib/stats";
import HistoryList from "./HistoryList";

interface Props {
  entries: HistoryEntry[];
  stats: Stats;
  hotkey: string;
  modelReady: boolean;
  aiReady: boolean;
  onDeleted: () => void;
  onOpenSettings: () => void;
}

export default function HomePage({
  entries,
  stats,
  hotkey,
  modelReady,
  aiReady,
  onDeleted,
  onOpenSettings,
}: Props) {
  const streaks = computeStreaks(stats.days);

  return (
    <div className="mx-auto max-w-4xl px-8 py-10">
      <h1 className="mb-6 font-display text-3xl text-ink">Welcome back</h1>

      <div className="flex gap-5">
        {/* Hero banner */}
        <div className="relative min-w-0 flex-1 overflow-hidden rounded-2xl bg-teal-deep p-7 text-white">
          <div className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-teal/40 blur-2xl" />
          <h2 className="font-display text-2xl">
            Hold <span className="font-bold">Ctrl+Win</span> or tap{" "}
            <span className="font-bold">{hotkey}</span> to dictate
          </h2>
          <p className="mt-2 max-w-md text-sm text-white/80">
            FlowLite works in all your apps. Try it in email, messages, docs or
            anywhere else — 100% offline and private.
          </p>
          {!modelReady && (
            <button
              onClick={onOpenSettings}
              className="mt-4 rounded-lg bg-white px-4 py-2 text-sm font-medium text-teal-deep hover:bg-cream"
            >
              Download a speech model to get started
            </button>
          )}
        </div>

        {/* Stats summary */}
        <div className="w-56 shrink-0 rounded-2xl border border-cream-dark bg-white p-6 shadow-sm">
          <div>
            <span className="font-display text-3xl text-ink">
              {stats.total_words.toLocaleString()}
            </span>
            <span className="ml-2 text-sm text-ink-soft">total words</span>
          </div>
          <div className="mt-3">
            <span className="font-display text-3xl text-ink">{avgWpm(stats)}</span>
            <span className="ml-2 text-sm text-ink-soft">wpm</span>
          </div>
          <div className="mt-3">
            <span className="font-display text-3xl text-ink">{streaks.current}</span>
            <span className="ml-2 text-sm text-ink-soft">day streak</span>
          </div>
        </div>
      </div>

      <HistoryList entries={entries} onDeleted={onDeleted} aiReady={aiReady} />
    </div>
  );
}
