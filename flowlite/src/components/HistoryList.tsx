import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Check, Copy, Mic, Sparkles, Trash2, X } from "lucide-react";
import type { AiPreset, HistoryEntry } from "../lib/types";
import { groupByDate } from "../lib/stats";

interface Props {
  entries: HistoryEntry[];
  onDeleted: () => void;
  aiReady: boolean;
}

const PRESETS: { id: AiPreset; label: string }[] = [
  { id: "formal", label: "Make formal" },
  { id: "concise", label: "Make concise" },
  { id: "bullets", label: "Bullet points" },
  { id: "grammar", label: "Fix grammar" },
];

function timeLabel(ts: number): string {
  return new Date(ts)
    .toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
    .toLowerCase();
}

function Row({
  entry,
  onDeleted,
  aiReady,
  onRewrite,
}: {
  entry: HistoryEntry;
  onDeleted: () => void;
  aiReady: boolean;
  onRewrite: (text: string, preset: AiPreset) => void;
}) {
  const [copied, setCopied] = useState(false);
  const [menu, setMenu] = useState(false);

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
        {aiReady && (
          <div className="relative">
            <button
              title="AI rewrite"
              onClick={() => setMenu((m) => !m)}
              className="rounded-lg p-1.5 text-ink-soft hover:bg-cream-dark hover:text-teal-deep"
            >
              <Sparkles size={15} />
            </button>
            {menu && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setMenu(false)} />
                <div className="absolute right-0 z-20 mt-1 w-40 overflow-hidden rounded-lg border border-cream-dark bg-white py-1 shadow-lg">
                  {PRESETS.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => {
                        setMenu(false);
                        onRewrite(entry.text, p.id);
                      }}
                      className="block w-full px-3 py-1.5 text-left text-sm text-ink hover:bg-cream"
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
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

interface Preview {
  preset: AiPreset;
  original: string;
  result: string;
  loading: boolean;
  error?: string;
}

function RewriteModal({
  preview,
  onClose,
}: {
  preview: Preview;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const label = PRESETS.find((p) => p.id === preview.preset)?.label ?? "Rewrite";

  function copy() {
    invoke("copy_text", { text: preview.result }).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40" onClick={onClose}>
      <div
        className="w-[560px] max-w-[90vw] rounded-2xl bg-white p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="flex items-center gap-2 font-display text-xl text-ink">
            <Sparkles size={18} className="text-teal-deep" /> {label}
          </h3>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-ink-soft hover:bg-cream-dark hover:text-ink"
          >
            <X size={18} />
          </button>
        </div>

        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-soft">Original</p>
        <p className="mb-4 max-h-24 overflow-y-auto whitespace-pre-wrap rounded-lg bg-cream px-3 py-2 text-sm text-ink-soft">
          {preview.original}
        </p>

        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-soft">Result</p>
        <div className="min-h-[80px] max-h-52 overflow-y-auto whitespace-pre-wrap rounded-lg border border-cream-dark px-3 py-2 text-sm text-ink">
          {preview.loading ? (
            <span className="flex items-center gap-2 text-ink-soft">
              <span className="h-3 w-3 animate-spin rounded-full border-2 border-cream-dark border-t-teal" />
              Rewriting locally on your GPU…
            </span>
          ) : preview.error ? (
            <span className="text-red-700">{preview.error}</span>
          ) : (
            preview.result
          )}
        </div>

        {!preview.loading && !preview.error && (
          <div className="mt-4 flex justify-end">
            <button
              onClick={copy}
              className="flex items-center gap-2 rounded-lg bg-teal px-4 py-2 text-sm text-white hover:bg-teal-deep"
            >
              {copied ? <Check size={15} /> : <Copy size={15} />}
              {copied ? "Copied" : "Copy result"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default function HistoryList({ entries, onDeleted, aiReady }: Props) {
  const [preview, setPreview] = useState<Preview | null>(null);

  function rewrite(text: string, preset: AiPreset) {
    setPreview({ preset, original: text, result: "", loading: true });
    invoke<string>("ai_rewrite", { text, preset })
      .then((result) => setPreview({ preset, original: text, result, loading: false }))
      .catch((err) =>
        setPreview({ preset, original: text, result: "", loading: false, error: String(err) }),
      );
  }

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
              <Row
                key={e.ts}
                entry={e}
                onDeleted={onDeleted}
                aiReady={aiReady}
                onRewrite={rewrite}
              />
            ))}
          </div>
        </section>
      ))}
      {preview && <RewriteModal preview={preview} onClose={() => setPreview(null)} />}
    </div>
  );
}
