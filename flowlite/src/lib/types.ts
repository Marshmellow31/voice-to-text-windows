// Shapes shared with the Rust backend. Field names are snake_case because
// Tauri serializes serde struct fields as-is (only command *arguments* get
// camelCase mapping).

export type FillerLevel = "none" | "light" | "medium";

export interface Replacement {
  from: string;
  to: string;
}

export interface Settings {
  hotkey: string;
  model_id: string;
  mic: string | null;
  autostart: boolean;
  ptt_enabled: boolean; // hold Ctrl+Win to dictate
  dictionary: string[]; // custom vocabulary (biases Whisper)
  replacements: Replacement[]; // post-transcription find/replace
  voice_commands: boolean; // "new line", "scratch that", etc.
  filler_cleanup: FillerLevel; // strip um/uh
  use_gpu: boolean; // use downloaded CUDA whisper engine
  ai_voice_commands: boolean; // "make this formal" → AI rewrite
}

export interface AccelStatus {
  gpu: boolean; // CUDA whisper engine installed
  llm: boolean; // local AI runtime + model installed
}

export type AiPreset = "formal" | "bullets" | "concise" | "grammar";

export interface DownloadStage {
  stage: string; // human label, e.g. "AI model"
  received: number;
  total: number;
}

export interface ModelInfo {
  id: string;
  downloaded: boolean;
}

export interface HistoryEntry {
  ts: number; // unix ms — also the delete id
  text: string;
  words: number;
  dur_secs: number;
}

export interface Stats {
  total_words: number;
  total_dictations: number;
  total_speaking_secs: number;
  days: Record<string, number>; // "YYYY-MM-DD" -> words that day
}

export interface DictationDone {
  text: string;
  words: number;
  dur_secs: number;
}
