import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";

type State = "idle" | "rec" | "busy" | "ai";

// Number of bars in the small level meter.
const BARS = 7;

export default function OverlayPill() {
  const [state, setState] = useState<State>("idle");
  const [level, setLevel] = useState(0);

  useEffect(() => {
    const unsubs = [
      listen("recording-started", () => {
        setLevel(0);
        setState("rec");
      }),
      listen("recording-stopped", () => setState("busy")),
      listen("ai-rewriting", () => setState("ai")),
      listen("recording-cancelled", () => setState("idle")),
      listen("dictation-done", () => setState("idle")),
      listen("dictation-error", () => setState("idle")),
      listen<number>("audio-level", (e) => setLevel(e.payload)),
    ];
    return () => {
      unsubs.forEach((p) => p.then((un) => un()));
    };
  }, []);

  if (state === "idle") return null;

  return (
    <div className="flex h-screen w-screen items-center justify-center">
      <div className="flex flex-col items-center gap-1 rounded-2xl bg-zinc-900/90 px-4 py-2 text-white shadow-lg backdrop-blur">
        {state === "rec" ? (
          <>
            <span className="text-sm font-medium">Listening…</span>
            <div className="flex items-end gap-[2px]" style={{ height: 12 }}>
              {Array.from({ length: BARS }).map((_, i) => {
                // Center bars react a little more than the edges.
                const weight = 1 - Math.abs(i - (BARS - 1) / 2) / BARS;
                const h = Math.max(2, Math.min(12, level * 45 * weight + 2));
                return (
                  <span
                    key={i}
                    className="w-[2px] rounded-full bg-zinc-400"
                    style={{ height: h }}
                  />
                );
              })}
            </div>
          </>
        ) : (
          <div className="flex items-center gap-2 text-sm font-medium">
            <span className="h-2.5 w-2.5 animate-spin rounded-full border-2 border-zinc-500 border-t-white" />
            {state === "ai" ? "Rewriting…" : "Transcribing…"}
          </div>
        )}
      </div>
    </div>
  );
}
