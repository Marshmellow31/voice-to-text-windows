import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import "./App.css";
import type {
  AccelStatus,
  DownloadStage,
  HistoryEntry,
  ModelInfo,
  Settings,
  Stats,
} from "./lib/types";
import Sidebar, { type View } from "./components/Sidebar";
import HomePage from "./components/HomePage";
import InsightsPage from "./components/InsightsPage";
import SettingsModal from "./components/SettingsModal";

const EMPTY_STATS: Stats = {
  total_words: 0,
  total_dictations: 0,
  total_speaking_secs: 0,
  days: {},
};

export default function App() {
  const [view, setView] = useState<View>("home");
  const [settingsOpen, setSettingsOpen] = useState(false);

  const [settings, setSettings] = useState<Settings | null>(null);
  const [mics, setMics] = useState<string[]>([]);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [modelReady, setModelReady] = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState<{ msg: string; ok: boolean } | null>(null);

  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [stats, setStats] = useState<Stats>(EMPTY_STATS);

  const [accel, setAccel] = useState<AccelStatus>({ gpu: false, llm: false });
  const [gpuDl, setGpuDl] = useState<{ stage: string; pct: number } | null>(null);
  const [llmDl, setLlmDl] = useState<{ stage: string; pct: number } | null>(null);

  const refreshData = useCallback(() => {
    invoke<HistoryEntry[]>("get_history").then(setHistory);
    invoke<Stats>("get_stats").then(setStats);
  }, []);

  function refreshModels() {
    invoke<ModelInfo[]>("list_models").then(setModels);
  }

  function flash(msg: string, ok = true) {
    setStatus({ msg, ok });
    setTimeout(() => setStatus(null), 3000);
  }

  // Keep the mic list live: refresh when Settings opens, then poll while it's
  // open so plugging/unplugging a USB headset shows up without reopening.
  useEffect(() => {
    if (!settingsOpen) return;
    invoke<string[]>("list_mics").then(setMics);
    const timer = setInterval(
      () => invoke<string[]>("list_mics").then(setMics),
      2000,
    );
    return () => clearInterval(timer);
  }, [settingsOpen]);

  // Initial load + backend event listeners.
  useEffect(() => {
    invoke<Settings>("get_settings").then(setSettings);
    invoke<string[]>("list_mics").then(setMics);
    refreshModels();
    invoke<boolean>("model_ready").then(setModelReady);
    invoke<AccelStatus>("accel_status").then(setAccel);
    refreshData();

    const pct = (r: number, t: number) => (t > 0 ? Math.round((r / t) * 100) : 0);

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
      // Fired after every dictation — keeps history/stats live while open.
      listen("dictation-done", refreshData),

      // CUDA Whisper engine download.
      listen<DownloadStage>("gpu-download-progress", (e) =>
        setGpuDl({ stage: e.payload.stage, pct: pct(e.payload.received, e.payload.total) }),
      ),
      listen("gpu-ready", () => {
        setGpuDl(null);
        setAccel((a) => ({ ...a, gpu: true }));
        flash("GPU engine ready ✓");
      }),
      listen<string>("gpu-error", (e) => {
        setGpuDl(null);
        flash("GPU error: " + e.payload, false);
      }),

      // Local AI runtime + model download.
      listen<DownloadStage>("llm-download-progress", (e) =>
        setLlmDl({ stage: e.payload.stage, pct: pct(e.payload.received, e.payload.total) }),
      ),
      listen("llm-ready", () => {
        setLlmDl(null);
        setAccel((a) => ({ ...a, llm: true }));
        flash("AI model ready ✓");
      }),
      listen<string>("llm-error", (e) => {
        setLlmDl(null);
        flash("AI error: " + e.payload, false);
      }),
    ];

    // Catch dictations that happened while the window was hidden to tray.
    window.addEventListener("focus", refreshData);
    return () => {
      unsubs.forEach((p) => p.then((un) => un()));
      window.removeEventListener("focus", refreshData);
    };
  }, [refreshData]);

  function update<K extends keyof Settings>(key: K, value: Settings[K]) {
    if (!settings) return;
    const next = { ...settings, [key]: value };
    setSettings(next);
    invoke("save_settings", { newSettings: next })
      .then(() => {
        flash("Saved ✓");
        if (key === "model_id") invoke<boolean>("model_ready").then(setModelReady);
      })
      .catch((err) => flash("Error: " + err, false));
  }

  function onDownload(id: string) {
    setDownloading(id);
    setProgress(0);
    invoke("download_model", { id });
  }

  function onDownloadGpu() {
    setGpuDl({ stage: "Starting…", pct: 0 });
    invoke("download_gpu");
  }

  function onDownloadLlm() {
    setLlmDl({ stage: "Starting…", pct: 0 });
    invoke("download_llm");
  }

  if (!settings) {
    return <div className="p-8 text-ink-soft">Loading…</div>;
  }

  return (
    <div className="flex h-screen bg-cream text-ink">
      <Sidebar
        view={view}
        onNavigate={setView}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      <main className="min-w-0 flex-1 overflow-y-auto">
        {view === "home" ? (
          <HomePage
            entries={history}
            stats={stats}
            hotkey={settings.hotkey}
            modelReady={modelReady}
            aiReady={accel.llm}
            onDeleted={refreshData}
            onOpenSettings={() => setSettingsOpen(true)}
          />
        ) : (
          <InsightsPage stats={stats} />
        )}
      </main>

      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        settings={settings}
        mics={mics}
        models={models}
        downloading={downloading}
        progress={progress}
        accel={accel}
        gpuDl={gpuDl}
        llmDl={llmDl}
        onDownloadGpu={onDownloadGpu}
        onDownloadLlm={onDownloadLlm}
        onUpdate={update}
        onDownload={onDownload}
        onHistoryCleared={() => {
          refreshData();
          flash("History cleared");
        }}
      />

      {status && (
        <div
          className={`fixed bottom-4 right-4 z-50 rounded-lg px-4 py-2 text-sm text-white shadow-lg ${
            status.ok ? "bg-ink" : "bg-red-700"
          }`}
        >
          {status.msg}
        </div>
      )}
    </div>
  );
}
