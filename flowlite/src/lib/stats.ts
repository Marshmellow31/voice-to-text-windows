import type { HistoryEntry, Stats } from "./types";

/** Local-time YYYY-MM-DD — must match the Rust side's chrono::Local format. */
export function dayKey(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

export function avgWpm(stats: Stats): number {
  if (stats.total_speaking_secs <= 0) return 0;
  return Math.round(stats.total_words / (stats.total_speaking_secs / 60));
}

export interface HistoryGroup {
  label: string; // "TODAY" | "YESTERDAY" | "JULY 11, 2026"
  entries: HistoryEntry[];
}

/** Group newest-first entries into date sections like Wispr's home feed. */
export function groupByDate(entries: HistoryEntry[]): HistoryGroup[] {
  const today = dayKey(new Date());
  const yesterday = dayKey(new Date(Date.now() - 86_400_000));
  const groups: HistoryGroup[] = [];

  for (const e of entries) {
    const d = new Date(e.ts);
    const key = dayKey(d);
    const label =
      key === today
        ? "TODAY"
        : key === yesterday
          ? "YESTERDAY"
          : d
              .toLocaleDateString("en-US", {
                month: "long",
                day: "numeric",
                year: "numeric",
              })
              .toUpperCase();
    const last = groups[groups.length - 1];
    if (last && last.label === label) {
      last.entries.push(e);
    } else {
      groups.push({ label, entries: [e] });
    }
  }
  return groups;
}

export interface HeatmapCell {
  key: string; // day key, "" for cells after today (rendered invisible)
  level: 0 | 1 | 2 | 3 | 4;
  words: number;
}

export interface HeatmapData {
  /** columns[week][dayOfWeek 0=Sun..6=Sat] */
  columns: HeatmapCell[][];
  /** month label per column ("" = no label at this column) */
  monthLabels: string[];
}

/** GitHub-style activity grid for the last `weeks` weeks, ending today. */
export function buildHeatmap(days: Record<string, number>, weeks = 22): HeatmapData {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  // Anchor the grid on the Sunday of the earliest week shown.
  const start = new Date(today.getTime() - (weeks * 7 - 1) * 86_400_000);
  start.setDate(start.getDate() - start.getDay());

  const max = Math.max(1, ...Object.values(days));
  const level = (w: number): HeatmapCell["level"] =>
    w === 0
      ? 0
      : (Math.min(4, Math.max(1, Math.ceil((w / max) * 4))) as HeatmapCell["level"]);

  const columns: HeatmapCell[][] = [];
  const monthLabels: string[] = [];
  let prevMonth = -1;

  for (let w = 0; ; w++) {
    const colStart = new Date(start.getTime() + w * 7 * 86_400_000);
    if (colStart > today) break;
    const col: HeatmapCell[] = [];
    for (let dow = 0; dow < 7; dow++) {
      const d = new Date(colStart.getTime() + dow * 86_400_000);
      if (d > today) {
        col.push({ key: "", level: 0, words: 0 });
      } else {
        const key = dayKey(d);
        const words = days[key] ?? 0;
        col.push({ key, level: level(words), words });
      }
    }
    columns.push(col);
    const m = colStart.getMonth();
    monthLabels.push(
      m !== prevMonth
        ? colStart.toLocaleDateString("en-US", { month: "short" })
        : "",
    );
    prevMonth = m;
  }
  return { columns, monthLabels };
}

export interface Streaks {
  current: number;
  longest: number;
}

export function computeStreaks(days: Record<string, number>): Streaks {
  const active = new Set(
    Object.keys(days).filter((k) => (days[k] ?? 0) > 0),
  );

  // Current streak: walk back from today; if today is inactive the streak
  // isn't broken yet, so start counting from yesterday.
  let current = 0;
  const cursor = new Date();
  cursor.setHours(0, 0, 0, 0);
  if (!active.has(dayKey(cursor))) cursor.setDate(cursor.getDate() - 1);
  while (active.has(dayKey(cursor))) {
    current++;
    cursor.setDate(cursor.getDate() - 1);
  }

  // Longest streak: max run of consecutive days over sorted active keys.
  const sorted = [...active].sort();
  let longest = 0;
  let run = 0;
  let prev: Date | null = null;
  for (const k of sorted) {
    const d = new Date(k + "T00:00:00");
    run = prev !== null && d.getTime() - prev.getTime() === 86_400_000 ? run + 1 : 1;
    longest = Math.max(longest, run);
    prev = d;
  }
  return { current, longest };
}
