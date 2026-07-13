//! Transcription history + lifetime usage stats, persisted as two JSON files
//! in the app data dir. History is capped at the last 500 entries; stats are
//! lifetime aggregates that survive both the cap and "clear history".

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

/// Maximum entries kept in history.json (oldest trimmed first).
const MAX_ENTRIES: usize = 500;
/// Days of per-day word counts kept for the heatmap/streaks.
const MAX_DAYS: i64 = 366;

#[derive(Clone, Serialize, Deserialize)]
pub struct HistoryEntry {
    /// Unix time in ms — also serves as the entry's id for deletion.
    pub ts: u64,
    pub text: String,
    pub words: u32,
    pub dur_secs: f32,
}

#[derive(Clone, Serialize, Deserialize, Default)]
pub struct Stats {
    pub total_words: u64,
    pub total_dictations: u64,
    pub total_speaking_secs: f64,
    /// "YYYY-MM-DD" (local time) -> words dictated that day.
    pub days: BTreeMap<String, u32>,
}

#[derive(Default)]
pub struct Store {
    /// Oldest-first, matching on-disk order.
    pub entries: Vec<HistoryEntry>,
    pub stats: Stats,
}

fn data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir: {e}"))?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn read_json<T: for<'de> Deserialize<'de> + Default>(path: &PathBuf) -> T {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

/// Write via tmp file + rename so a crash mid-write can't corrupt the file.
fn write_json_atomic<T: Serialize>(path: &PathBuf, value: &T) -> Result<(), String> {
    let json = serde_json::to_string(value).map_err(|e| e.to_string())?;
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, json).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, path).map_err(|e| e.to_string())
}

impl Store {
    pub fn load(app: &AppHandle) -> Self {
        match data_dir(app) {
            Ok(dir) => Self {
                entries: read_json(&dir.join("history.json")),
                stats: read_json(&dir.join("stats.json")),
            },
            Err(_) => Self::default(),
        }
    }

    fn persist_entries(&self, app: &AppHandle) -> Result<(), String> {
        write_json_atomic(&data_dir(app)?.join("history.json"), &self.entries)
    }

    fn persist_stats(&self, app: &AppHandle) -> Result<(), String> {
        write_json_atomic(&data_dir(app)?.join("stats.json"), &self.stats)
    }

    /// Append a dictation, update lifetime stats, trim caps, persist.
    /// Errors are returned for logging only — a failed write must never be
    /// surfaced as a dictation error (the paste already happened).
    pub fn record(&mut self, app: &AppHandle, entry: HistoryEntry) -> Result<(), String> {
        self.stats.total_words += entry.words as u64;
        self.stats.total_dictations += 1;
        self.stats.total_speaking_secs += entry.dur_secs as f64;

        let today = chrono::Local::now().format("%Y-%m-%d").to_string();
        *self.stats.days.entry(today).or_insert(0) += entry.words;

        // Prune day buckets older than a year (keys sort chronologically).
        if self.stats.days.len() > MAX_DAYS as usize {
            let cutoff = (chrono::Local::now() - chrono::Duration::days(MAX_DAYS))
                .format("%Y-%m-%d")
                .to_string();
            self.stats.days = self.stats.days.split_off(&cutoff);
        }

        self.entries.push(entry);
        if self.entries.len() > MAX_ENTRIES {
            let excess = self.entries.len() - MAX_ENTRIES;
            self.entries.drain(..excess);
        }

        self.persist_entries(app)?;
        self.persist_stats(app)
    }

    pub fn delete(&mut self, app: &AppHandle, ts: u64) -> Result<(), String> {
        self.entries.retain(|e| e.ts != ts);
        self.persist_entries(app)
    }

    /// Wipe history entries only — lifetime stats are intentionally kept.
    pub fn clear_entries(&mut self, app: &AppHandle) -> Result<(), String> {
        self.entries.clear();
        self.persist_entries(app)
    }
}
