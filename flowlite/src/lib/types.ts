// Shapes shared with the Rust backend. Field names are snake_case because
// Tauri serializes serde struct fields as-is (only command *arguments* get
// camelCase mapping).

export interface Settings {
  hotkey: string;
  model_id: string;
  mic: string | null;
  autostart: boolean;
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
