import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Monitor, SlidersHorizontal, X } from "lucide-react";
import type { ModelInfo, Settings } from "../lib/types";

const MODEL_LABELS: Record<string, string> = {
  "tiny.en": "Tiny (31 MB) — fastest, basic accuracy",
  "base.en": "Base (57 MB) — good balance",
  "small.en": "Small (182 MB) — recommended, very accurate",
};

interface Props {
  open: boolean;
  onClose: () => void;
  settings: Settings;
  mics: string[];
  models: ModelInfo[];
  downloading: string | null;
  progress: number;
  onUpdate: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
  onDownload: (id: string) => void;
  onHistoryCleared: () => void;
}

type Tab = "general" | "system";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-cream-dark py-5 first:pt-0 last:border-b-0">
      <h3 className="mb-3 text-sm font-semibold text-ink">{title}</h3>
      {children}
    </div>
  );
}

export default function SettingsModal(props: Props) {
  const [tab, setTab] = useState<Tab>("general");
  const [capturing, setCapturing] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);

  if (!props.open) return null;

  const { settings } = props;

  // Capture the next key combo for the hotkey field.
  function captureHotkey(e: React.KeyboardEvent) {
    e.preventDefault();
    const mods: string[] = [];
    if (e.ctrlKey) mods.push("ctrl");
    if (e.altKey) mods.push("alt");
    if (e.shiftKey) mods.push("shift");
    if (e.metaKey) mods.push("super");
    const key = e.key;
    if (["Control", "Alt", "Shift", "Meta"].includes(key)) return; // lone modifier
    const named = key.length === 1 ? key.toUpperCase() : key;
    setCapturing(false);
    props.onUpdate("hotkey", [...mods, named].join("+"));
  }

  function clearHistory() {
    if (!confirmClear) {
      setConfirmClear(true);
      setTimeout(() => setConfirmClear(false), 4000);
      return;
    }
    setConfirmClear(false);
    invoke("clear_history").then(props.onHistoryCleared);
  }

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-ink/40"
      onClick={props.onClose}
    >
      <div
        className="flex h-[540px] w-[760px] overflow-hidden rounded-2xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Left nav */}
        <aside className="relative w-52 shrink-0 border-r border-cream-dark bg-cream p-4">
          <h2 className="mb-4 px-2 text-xs font-semibold uppercase tracking-[0.15em] text-ink-soft">
            Settings
          </h2>
          <button
            onClick={() => setTab("general")}
            className={`mb-1 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm ${
              tab === "general" ? "bg-cream-dark font-medium text-ink" : "text-ink-soft hover:text-ink"
            }`}
          >
            <SlidersHorizontal size={15} /> General
          </button>
          <button
            onClick={() => setTab("system")}
            className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm ${
              tab === "system" ? "bg-cream-dark font-medium text-ink" : "text-ink-soft hover:text-ink"
            }`}
          >
            <Monitor size={15} /> System
          </button>
          <p className="absolute bottom-4 px-2 text-xs text-ink-soft">FlowLite v0.2.0</p>
        </aside>

        {/* Panel */}
        <div className="relative flex-1 overflow-y-auto p-7">
          <button
            onClick={props.onClose}
            className="absolute right-5 top-5 rounded-lg p-1.5 text-ink-soft hover:bg-cream-dark hover:text-ink"
            title="Close"
          >
            <X size={18} />
          </button>

          {tab === "general" ? (
            <>
              <h2 className="mb-4 font-display text-2xl text-ink">General</h2>

              <Section title="Dictation hotkey">
                <p className="mb-2 text-sm text-ink-soft">
                  Hold this key to record. F-keys are safest (avoid conflicts).
                </p>
                <button
                  onKeyDown={captureHotkey}
                  onClick={() => setCapturing(true)}
                  className="rounded-lg border border-cream-dark bg-cream px-4 py-2 font-mono text-sm text-ink"
                >
                  {capturing ? "Press a key combo…" : settings.hotkey}
                </button>
              </Section>

              <Section title="Microphone">
                <select
                  value={settings.mic ?? ""}
                  onChange={(e) => props.onUpdate("mic", e.target.value || null)}
                  className="w-full rounded-lg border border-cream-dark bg-white px-3 py-2 text-sm text-ink"
                >
                  <option value="">System default</option>
                  {props.mics.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-ink-soft">
                  (Currently uses the system default device.)
                </p>
              </Section>

              <Section title="Speech model">
                <div className="space-y-2">
                  {props.models.map((m) => (
                    <div
                      key={m.id}
                      className="flex items-center justify-between rounded-lg border border-cream-dark p-3"
                    >
                      <label className="flex items-center gap-2 text-sm font-medium text-ink">
                        <input
                          type="radio"
                          name="model"
                          checked={settings.model_id === m.id}
                          onChange={() => props.onUpdate("model_id", m.id)}
                        />
                        {MODEL_LABELS[m.id] ?? m.id}
                      </label>
                      {m.downloaded ? (
                        <span className="text-xs font-medium text-teal">Downloaded</span>
                      ) : props.downloading === m.id ? (
                        <span className="text-xs text-ink-soft">{props.progress}%</span>
                      ) : (
                        <button
                          onClick={() => props.onDownload(m.id)}
                          className="rounded-md bg-teal px-3 py-1 text-xs text-white hover:bg-teal-deep"
                        >
                          Download
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </Section>
            </>
          ) : (
            <>
              <h2 className="mb-4 font-display text-2xl text-ink">System</h2>

              <Section title="Startup">
                <label className="flex items-center gap-3 text-sm text-ink">
                  <input
                    type="checkbox"
                    checked={settings.autostart}
                    onChange={(e) => props.onUpdate("autostart", e.target.checked)}
                  />
                  Start FlowLite when Windows starts (runs in the tray)
                </label>
              </Section>

              <Section title="History">
                <p className="mb-2 text-sm text-ink-soft">
                  Transcripts are stored only on this PC (last 500 kept). Clearing
                  removes them permanently; lifetime stats are kept.
                </p>
                <button
                  onClick={clearHistory}
                  className={`rounded-lg px-4 py-2 text-sm font-medium ${
                    confirmClear
                      ? "bg-red-700 text-white"
                      : "border border-cream-dark text-ink hover:bg-cream"
                  }`}
                >
                  {confirmClear ? "Click again to confirm" : "Clear all history"}
                </button>
              </Section>

              <Section title="About">
                <p className="text-sm text-ink-soft">
                  FlowLite v0.2.0 — local voice-to-text for Windows. Speech
                  recognition runs 100% on this machine via whisper.cpp; nothing
                  you say ever leaves your PC.
                </p>
              </Section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
