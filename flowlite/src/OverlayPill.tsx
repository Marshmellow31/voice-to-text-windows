import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";

type State = "idle" | "rec" | "busy";

export default function OverlayPill() {
  const [state, setState] = useState<State>("idle");

  useEffect(() => {
    const unsubs = [
      listen("recording-started", () => setState("rec")),
      listen("recording-stopped", () => setState("busy")),
      listen("dictation-done", () => setState("idle")),
      listen("dictation-error", () => setState("idle")),
    ];
    return () => {
      unsubs.forEach((p) => p.then((un) => un()));
    };
  }, []);

  if (state === "idle") return null;

  return (
    <div className="flex h-screen w-screen items-center justify-center">
      <div className="flex items-center gap-2 rounded-full bg-zinc-900/90 px-4 py-2 text-sm font-medium text-white shadow-lg backdrop-blur">
        {state === "rec" ? (
          <>
            <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-red-500" />
            Listening…
          </>
        ) : (
          <>
            <span className="h-2.5 w-2.5 animate-spin rounded-full border-2 border-zinc-500 border-t-white" />
            Transcribing…
          </>
        )}
      </div>
    </div>
  );
}
