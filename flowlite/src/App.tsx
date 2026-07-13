import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import "./App.css";

interface Settings {
  hotkey: string;
  model_id: string;
  mic: string | null;
  autostart: boolean;
}

interface ModelInfo {
  id: string;
  downloaded: boolean;
}

const MODEL_LABELS: Record<string, string> = {
  "tiny.en": "Tiny (31 MB) — fastest, basic accuracy",
  "base.en": "Base (57 MB) — good balance",
  "small.en": "Small (182 MB) — recommended, very accurate",
};

export default function App() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [mics, setMics] = useState<string[]>([]);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [modelReady, setModelReady] = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [capturing, setCapturing] = useState(false);
  const [status, setStatus] = useState<{ msg: string; ok: boolean } | null>(null);
  const testRef = useRef<HTMLTextAreaElement>(null);

  // Initial load.
  useEffect(() => {
    invoke<Settings>("get_settings").then(setSettings);
    invoke<string[]>("list_mics").then(setMics);
    refreshModels();
    invoke<boolean>("model_ready").then(setModelReady);

    const unsubs = [
      listen<{ id: string; received: number; total: number }>(
        "model-download-progress",
        (e) => {
          const { received, total } = e.payload;
          setProgress(total > 0 ? Math.round((received / total) * 100) : 0);
        },
      ),
      listen("model-ready", () => {
        setModelReady(true);
        setDownloading(null);
        setProgress(0);
        refreshModels();
        flash("Model ready ✓", true);
      }),
      listen<string>("model-error", (e) => {
        setDownloading(null);
        flash("Model error: " + e.payload, false);
      }),
      listen<string>("dictation-error", (e) => {
        flash("Dictation error: " + e.payload, false);
      }),
    ];
    return () => unsubs.forEach((p) => p.then((un) => un()));
  }, []);

  function refreshModels() {
    invoke<ModelInfo[]>("list_models").then(setModels);
  }

  function flash(msg: string, ok = true) {
    setStatus({ msg, ok });
    setTimeout(() => setStatus(null), 3000);
  }

  function update<K extends keyof Settings>(key: K, value: Settings[K]) {
    if (!settings) return;
    const next = { ...settings, [key]: value };
    setSettings(next);
    invoke("save_settings", { newSettings: next })
      .then(() => flash("Saved ✓"))
      .catch((err) => flash("Error: " + err, false));
  }

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
    const accel = [...mods, named].join("+");
    setCapturing(false);
    update("hotkey", accel);
  }

  function onDownload(id: string) {
    setDownloading(id);
    setProgress(0);
    invoke("download_model", { id });
  }

  if (!settings) {
    return <div className="p-8 text-zinc-500">Loading…</div>;
  }

  return (
    <div className="min-h-screen bg-zinc-50 p-8 text-zinc-800 dark:bg-zinc-900 dark:text-zinc-100">
      <div className="mx-auto max-w-2xl">
        <header className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">FlowLite</h1>
            <p className="text-sm text-zinc-500">
              Hold your hotkey anywhere, speak, release — text appears.
            </p>
          </div>
          <span
            className={`rounded-full px-3 py-1 text-xs font-medium ${
              modelReady
                ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300"
                : "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
            }`}
          >
            {modelReady ? "● Ready" : "○ No model loaded"}
          </span>
        </header>

        {/* Hotkey */}
        <Card title="Dictation hotkey">
          <p className="mb-2 text-sm text-zinc-500">
            Hold this key to record. F-keys are safest (avoid conflicts).
          </p>
          <button
            onKeyDown={captureHotkey}
            onClick={() => setCapturing(true)}
            className="rounded-lg border border-zinc-300 bg-white px-4 py-2 font-mono text-sm dark:border-zinc-700 dark:bg-zinc-800"
          >
            {capturing ? "Press a key combo…" : settings.hotkey}
          </button>
        </Card>

        {/* Model */}
        <Card title="Speech model">
          <div className="space-y-2">
            {models.map((m) => (
              <div
                key={m.id}
                className="flex items-center justify-between rounded-lg border border-zinc-200 p-3 dark:border-zinc-700"
              >
                <label className="flex items-center gap-2 text-sm font-medium">
                  <input
                    type="radio"
                    name="model"
                    checked={settings.model_id === m.id}
                    onChange={() => update("model_id", m.id)}
                  />
                  {MODEL_LABELS[m.id] ?? m.id}
                </label>
                {m.downloaded ? (
                  <span className="text-xs text-green-600">Downloaded</span>
                ) : downloading === m.id ? (
                  <span className="text-xs text-zinc-500">{progress}%</span>
                ) : (
                  <button
                    onClick={() => onDownload(m.id)}
                    className="rounded-md bg-zinc-900 px-3 py-1 text-xs text-white dark:bg-white dark:text-zinc-900"
                  >
                    Download
                  </button>
                )}
              </div>
            ))}
          </div>
        </Card>

        {/* Microphone */}
        <Card title="Microphone">
          <select
            value={settings.mic ?? ""}
            onChange={(e) => update("mic", e.target.value || null)}
            className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800"
          >
            <option value="">System default</option>
            {mics.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-zinc-400">
            (Currently uses the system default device.)
          </p>
        </Card>

        {/* Startup */}
        <Card title="Startup">
          <label className="flex items-center gap-3 text-sm">
            <input
              type="checkbox"
              checked={settings.autostart}
              onChange={(e) => update("autostart", e.target.checked)}
            />
            Start FlowLite when Windows starts (runs in the tray)
          </label>
        </Card>

        {/* Test */}
        <Card title="Try it">
          <p className="mb-2 text-sm text-zinc-500">
            Click in the box, then hold{" "}
            <span className="font-mono">{settings.hotkey}</span> and speak.
          </p>
          <textarea
            ref={testRef}
            rows={3}
            placeholder="Your dictated text will appear wherever the cursor is…"
            className="w-full rounded-lg border border-zinc-300 bg-white p-3 text-sm dark:border-zinc-700 dark:bg-zinc-800"
          />
        </Card>

        {status && (
          <div
            className={`fixed bottom-4 right-4 rounded-lg px-4 py-2 text-sm text-white shadow-lg ${
              status.ok ? "bg-zinc-900" : "bg-red-700"
            }`}
          >
            {status.msg}
          </div>
        )}
      </div>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-4 rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-800/50">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-400">
        {title}
      </h2>
      {children}
    </section>
  );
}
