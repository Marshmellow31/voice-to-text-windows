import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { BookText, Monitor, Plus, SlidersHorizontal, Trash2, X, Zap } from "lucide-react";
import type {
  AccelStatus,
  FillerLevel,
  ModelInfo,
  Replacement,
  Settings,
} from "../lib/types";

const MODEL_LABELS: Record<string, string> = {
  "tiny.en": "Tiny (31 MB) — fastest, basic accuracy",
  "base.en": "Base (57 MB) — good balance",
  "small.en": "Small (182 MB) — recommended, very accurate",
  "medium.en": "Medium (539 MB) — high accuracy, ~2–3× slower than Small",
  "large-v3-turbo": "Large v3 Turbo (574 MB) — best accuracy/speed, 99 languages",
  "large-v3": "Large v3 (1.1 GB) — maximum accuracy, slowest, 99 languages",
};

interface Props {
  open: boolean;
  onClose: () => void;
  settings: Settings;
  mics: string[];
  models: ModelInfo[];
  downloading: string | null;
  progress: number;
  accel: AccelStatus;
  gpuDl: { stage: string; pct: number } | null;
  llmDl: { stage: string; pct: number } | null;
  onDownloadGpu: () => void;
  onDownloadLlm: () => void;
  onUpdate: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
  onDownload: (id: string) => void;
  onHistoryCleared: () => void;
}

type Tab = "general" | "vocabulary" | "power" | "system";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-cream-dark py-5 first:pt-0 last:border-b-0">
      <h3 className="mb-3 text-sm font-semibold text-ink">{title}</h3>
      {children}
    </div>
  );
}

const FILLER_LABELS: Record<FillerLevel, string> = {
  none: "Off — keep every word",
  light: "Light — remove um, uh, er",
  medium: "Medium — also cut fillers & repeated words",
};

/// Editor for the custom-vocabulary dictionary and word-replacement rules.
function VocabularyPanel({
  settings,
  onUpdate,
}: {
  settings: Settings;
  onUpdate: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
}) {
  const [term, setTerm] = useState("");
  // Local draft of replacement rows so typing doesn't save on every keystroke.
  const [rules, setRules] = useState<Replacement[]>(settings.replacements);
  useEffect(() => setRules(settings.replacements), [settings.replacements]);

  function addTerm() {
    const t = term.trim();
    if (!t || settings.dictionary.includes(t)) {
      setTerm("");
      return;
    }
    onUpdate("dictionary", [...settings.dictionary, t]);
    setTerm("");
  }

  function removeTerm(t: string) {
    onUpdate("dictionary", settings.dictionary.filter((x) => x !== t));
  }

  function commitRules(next: Replacement[]) {
    setRules(next);
    onUpdate("replacements", next);
  }

  return (
    <>
      <h2 className="mb-4 font-display text-2xl text-ink">Vocabulary</h2>

      <Section title="Dictionary">
        <p className="mb-3 text-sm text-ink-soft">
          Add names, jargon, or product terms Whisper tends to mishear. FlowLite
          nudges the model toward spelling them correctly.
        </p>
        <div className="mb-3 flex gap-2">
          <input
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addTerm()}
            placeholder="e.g. FlowLite, Harshil, Kubernetes"
            className="flex-1 rounded-lg border border-cream-dark bg-white px-3 py-2 text-sm text-ink"
          />
          <button
            onClick={addTerm}
            className="flex items-center gap-1 rounded-lg bg-teal px-3 py-2 text-sm text-white hover:bg-teal-deep"
          >
            <Plus size={15} /> Add
          </button>
        </div>
        <div className="flex flex-wrap gap-2">
          {settings.dictionary.length === 0 && (
            <span className="text-xs text-ink-soft">No terms yet.</span>
          )}
          {settings.dictionary.map((t) => (
            <span
              key={t}
              className="flex items-center gap-1 rounded-full bg-cream-dark px-3 py-1 text-sm text-ink"
            >
              {t}
              <button
                onClick={() => removeTerm(t)}
                className="text-ink-soft hover:text-red-700"
                title="Remove"
              >
                <X size={13} />
              </button>
            </span>
          ))}
        </div>
      </Section>

      <Section title="Word replacements">
        <p className="mb-3 text-sm text-ink-soft">
          Automatically fix words after transcribing. Case-insensitive, whole
          words only (e.g. “jason” → “JSON”).
        </p>
        <div className="space-y-2">
          {rules.map((r, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                value={r.from}
                placeholder="heard…"
                onChange={(e) =>
                  setRules(rules.map((x, j) => (j === i ? { ...x, from: e.target.value } : x)))
                }
                onBlur={() => commitRules(rules)}
                className="flex-1 rounded-lg border border-cream-dark bg-white px-3 py-2 text-sm text-ink"
              />
              <span className="text-ink-soft">→</span>
              <input
                value={r.to}
                placeholder="replace with…"
                onChange={(e) =>
                  setRules(rules.map((x, j) => (j === i ? { ...x, to: e.target.value } : x)))
                }
                onBlur={() => commitRules(rules)}
                className="flex-1 rounded-lg border border-cream-dark bg-white px-3 py-2 text-sm text-ink"
              />
              <button
                onClick={() => commitRules(rules.filter((_, j) => j !== i))}
                className="rounded-lg p-2 text-ink-soft hover:bg-cream hover:text-red-700"
                title="Delete rule"
              >
                <Trash2 size={15} />
              </button>
            </div>
          ))}
        </div>
        <button
          onClick={() => commitRules([...rules, { from: "", to: "" }])}
          className="mt-3 flex items-center gap-1 rounded-lg border border-cream-dark px-3 py-2 text-sm text-ink hover:bg-cream"
        >
          <Plus size={15} /> Add rule
        </button>
      </Section>
    </>
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
            onClick={() => setTab("vocabulary")}
            className={`mb-1 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm ${
              tab === "vocabulary" ? "bg-cream-dark font-medium text-ink" : "text-ink-soft hover:text-ink"
            }`}
          >
            <BookText size={15} /> Vocabulary
          </button>
          <button
            onClick={() => setTab("power")}
            className={`mb-1 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm ${
              tab === "power" ? "bg-cream-dark font-medium text-ink" : "text-ink-soft hover:text-ink"
            }`}
          >
            <Zap size={15} /> Speed &amp; AI
          </button>
          <button
            onClick={() => setTab("system")}
            className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm ${
              tab === "system" ? "bg-cream-dark font-medium text-ink" : "text-ink-soft hover:text-ink"
            }`}
          >
            <Monitor size={15} /> System
          </button>
          <p className="absolute bottom-4 px-2 text-xs text-ink-soft">FlowLite v0.3.0</p>
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

          {tab === "general" && (
            <>
              <h2 className="mb-4 font-display text-2xl text-ink">General</h2>

              <Section title="Dictation hotkeys">
                <label className="mb-3 flex items-center gap-3 text-sm text-ink">
                  <input
                    type="checkbox"
                    checked={settings.ptt_enabled}
                    onChange={(e) => props.onUpdate("ptt_enabled", e.target.checked)}
                  />
                  <span>
                    Hold <kbd className="rounded border border-cream-dark bg-cream px-1.5 py-0.5 font-mono text-xs">Ctrl</kbd>
                    {" + "}
                    <kbd className="rounded border border-cream-dark bg-cream px-1.5 py-0.5 font-mono text-xs">Win</kbd>{" "}
                    to dictate — release to transcribe
                  </span>
                </label>
                <p className="mb-2 text-sm text-ink-soft">
                  Toggle key: tap once to start listening, tap again to stop and
                  transcribe. Good for long dictations.
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
                  {settings.mic && !props.mics.includes(settings.mic) && (
                    <option value={settings.mic}>
                      {settings.mic} (disconnected)
                    </option>
                  )}
                </select>
                <p className="mt-1 text-xs text-ink-soft">
                  Updates automatically when devices are plugged in or removed.
                  If your chosen mic is disconnected, the system default is used.
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

              <Section title="Voice commands">
                <label className="flex items-center gap-3 text-sm text-ink">
                  <input
                    type="checkbox"
                    checked={settings.voice_commands}
                    onChange={(e) => props.onUpdate("voice_commands", e.target.checked)}
                  />
                  Obey spoken commands — “new line”, “new paragraph”, “scratch that”
                </label>
              </Section>

              <Section title="Filler-word cleanup">
                <p className="mb-2 text-sm text-ink-soft">
                  Automatically tidy hesitations out of your transcripts.
                </p>
                <select
                  value={settings.filler_cleanup}
                  onChange={(e) =>
                    props.onUpdate("filler_cleanup", e.target.value as FillerLevel)
                  }
                  className="w-full rounded-lg border border-cream-dark bg-white px-3 py-2 text-sm text-ink"
                >
                  {(Object.keys(FILLER_LABELS) as FillerLevel[]).map((lvl) => (
                    <option key={lvl} value={lvl}>
                      {FILLER_LABELS[lvl]}
                    </option>
                  ))}
                </select>
              </Section>
            </>
          )}

          {tab === "vocabulary" && (
            <VocabularyPanel settings={settings} onUpdate={props.onUpdate} />
          )}

          {tab === "power" && (
            <>
              <h2 className="mb-4 font-display text-2xl text-ink">Speed &amp; AI</h2>

              <Section title="GPU acceleration (NVIDIA CUDA)">
                <p className="mb-3 text-sm text-ink-soft">
                  Run Whisper on your GPU instead of the CPU — much faster,
                  especially for the larger models. One-time ~680 MB download of
                  the CUDA engine (includes everything needed).
                </p>
                {props.accel.gpu ? (
                  <label className="flex items-center gap-3 text-sm text-ink">
                    <input
                      type="checkbox"
                      checked={settings.use_gpu}
                      onChange={(e) => props.onUpdate("use_gpu", e.target.checked)}
                    />
                    Use GPU acceleration <span className="text-teal">· installed ✓</span>
                  </label>
                ) : props.gpuDl ? (
                  <div className="text-sm text-ink-soft">
                    {props.gpuDl.stage}… {props.gpuDl.pct}%
                    <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-cream-dark">
                      <div className="h-full bg-teal" style={{ width: `${props.gpuDl.pct}%` }} />
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={props.onDownloadGpu}
                    className="rounded-lg bg-teal px-4 py-2 text-sm text-white hover:bg-teal-deep"
                  >
                    Download GPU engine (~680 MB)
                  </button>
                )}
              </Section>

              <Section title="Local AI rewrite (Qwen 3B)">
                <p className="mb-3 text-sm text-ink-soft">
                  Runs a small language model 100% on your PC to polish
                  transcripts — make them formal, concise, bulleted, or
                  grammar-fixed. One-time ~2.5 GB download (runtime + model).
                </p>
                {props.accel.llm ? (
                  <>
                    <p className="mb-3 text-sm font-medium text-teal">Installed ✓</p>
                    <label className="flex items-center gap-3 text-sm text-ink">
                      <input
                        type="checkbox"
                        checked={settings.ai_voice_commands}
                        onChange={(e) => props.onUpdate("ai_voice_commands", e.target.checked)}
                      />
                      Enable spoken AI commands while dictating
                    </label>
                    <div className="mt-3 rounded-lg bg-cream p-3 text-xs text-ink-soft">
                      <p className="mb-1 font-semibold text-ink">Try saying:</p>
                      “make this formal …”, “make this concise …”, “bullet points
                      …”, “fix grammar …” — the rest of what you say gets rewritten
                      before it’s typed. You can also click the ✨ icon on any
                      history entry.
                    </div>
                  </>
                ) : props.llmDl ? (
                  <div className="text-sm text-ink-soft">
                    {props.llmDl.stage}… {props.llmDl.pct}%
                    <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-cream-dark">
                      <div className="h-full bg-teal" style={{ width: `${props.llmDl.pct}%` }} />
                    </div>
                    <p className="mt-1 text-xs">
                      Downloads the runtime, CUDA libraries, then the model — keep
                      this open; it continues in the background.
                    </p>
                  </div>
                ) : (
                  <button
                    onClick={props.onDownloadLlm}
                    className="rounded-lg bg-teal px-4 py-2 text-sm text-white hover:bg-teal-deep"
                  >
                    Download AI model (~2.5 GB)
                  </button>
                )}
              </Section>
            </>
          )}

          {tab === "system" && (
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
                  FlowLite v0.3.0 — local voice-to-text for Windows. Speech
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
