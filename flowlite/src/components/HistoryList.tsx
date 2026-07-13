import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Check, Copy, Mic, Trash2 } from "lucide-react";
import type { HistoryEntry } from "../lib/types";
import { groupByDate } from "../lib/stats";

interface Props {
  entries: HistoryEntry[];
  onDeleted: () => void;
}

function timeLabel(ts: number): string {
  return new Date(ts)
    .toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
    .toLowerCase();
}

function Row({ entry, onDeleted }: { entry: HistoryEntry; onDeleted: () => void }) {
  const [copied, setCopied] = useState(false);

  function copy() {
    invoke("copy_text", { text: entry.text }).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  function remove() {
    invoke("delete_history_entry", { ts: entry.ts }).then(onDeleted);
  }

  return (
    <div className="group flex items-start gap-4 border-b border-cream-dark px-5 py-4 last:border-b-0">
      <span className="w-16 shrink-0 pt-0.5 text-xs text-ink-soft">
        {timeLabel(entry.ts)}
      </span>
      <p className="min-w-0 flex-1 whitespace-pre-wrap break-words text-sm leading-relaxed text-ink">
        {entry.text}
      </p>
      <div className="flex shrink-0 gap-1 opacity-0 transition-opacity group-hover:opacity-100">
        <button
          title="Copy"
          onClick={copy}
          className="rounded-lg p-1.5 text-ink-soft hover:bg-cream-dark hover:text-ink"
        >
          {copied ? <Check size={15} className="text-teal" /> : <Copy size={15} />}
        </button>
        <button
          title="Delete"
          onClick={remove}
          className="rounded-lg p-1.5 text-ink-soft hover:bg-cream-dark hover:text-red-700"
        >
          <Trash2 size={15} />
        </button>
      </div>
    </div>
  );
}

export default function HistoryList({ entries, onDeleted }: Props) {
  if (entries.length === 0) {
    return (
      <div className="mt-10 flex flex-col items-center rounded-2xl border border-dashed border-cream-dark py-14 text-center">
        <Mic size={28} className="mb-3 text-ink-soft" />
        <p className="font-display text-lg text-ink">No dictations yet</p>
        <p className="mt-1 text-sm text-ink-soft">
          Click into any text field, hold your hotkey and speak — your
          transcripts will show up here.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-2">
      {groupByDate(entries).map((group) => (
        <section key={group.label} className="mt-6">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-[0.15em] text-ink-soft">
            {group.label}
          </h3>
          <div className="rounded-2xl border border-cream-dark bg-white shadow-sm">
            {group.entries.map((e) => (
              <Row key={e.ts} entry={e} onDeleted={onDeleted} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
