//! Post-processing of raw Whisper output: spoken voice commands, filler-word
//! cleanup, and the user's custom word replacements. All local, all regex —
//! no network, no AI. Runs on the transcription thread before the text is
//! injected and recorded to history.

use once_cell::sync::Lazy;
use regex::Regex;
use serde::{Deserialize, Serialize};

/// A single find/replace rule from the user's dictionary (e.g. "jason" -> "JSON").
#[derive(Clone, Serialize, Deserialize)]
pub struct Replacement {
    pub from: String,
    pub to: String,
}

/// How aggressively to strip filler words. `None` leaves text untouched.
#[derive(Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum FillerLevel {
    None,
    Light,
    Medium,
}

impl Default for FillerLevel {
    fn default() -> Self {
        FillerLevel::None
    }
}

/// Run the full post-processing pipeline in a deterministic order:
/// 1. spoken structural commands ("new line", "scratch that")
/// 2. filler-word cleanup
/// 3. user word replacements
/// 4. whitespace tidy
pub fn process(
    raw: &str,
    voice_commands: bool,
    filler: FillerLevel,
    replacements: &[Replacement],
) -> String {
    let mut s = raw.to_string();
    if voice_commands {
        s = apply_voice_commands(&s);
    }
    if filler != FillerLevel::None {
        s = apply_filler_cleanup(&s, filler);
    }
    s = apply_replacements(&s, replacements);
    tidy(&s)
}

// ---------------------------------------------------------------------------
// Voice commands
// ---------------------------------------------------------------------------

static RE_NEW_PARAGRAPH: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\bnew\s+paragraph\b").unwrap());
static RE_NEW_LINE: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)\bnew\s+line\b").unwrap());
// "scratch/delete/ignore that" removes the clause spoken just before it.
static RE_SCRATCH: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\b(?:scratch|delete|ignore)\s+that\b\.?").unwrap());

fn apply_voice_commands(input: &str) -> String {
    // Structural line breaks first.
    let mut s = RE_NEW_PARAGRAPH.replace_all(input, "\n\n").to_string();
    s = RE_NEW_LINE.replace_all(&s, "\n").to_string();

    // "scratch that": delete the clause spoken just before it, so
    // "meet at 2. scratch that meet at 3" -> "meet at 3". We trim the clause's
    // own trailing terminator first, then cut back to the boundary before it.
    while let Some(m) = RE_SCRATCH.find(&s) {
        let (start, end) = (m.start(), m.end());
        let pre = s[..start].trim_end_matches([' ', '\t', ',', '.', ';', ':', '!', '?', '\n']);
        let boundary = pre.rfind(['.', '!', '?', '\n']).map(|i| i + 1).unwrap_or(0);
        s.replace_range(boundary..end, "");
    }
    s
}

// ---------------------------------------------------------------------------
// Filler-word cleanup
// ---------------------------------------------------------------------------

// Pure hesitation sounds — safe to remove even on Light.
static RE_FILLER_LIGHT: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)\b(?:u+m+|u+h+|e+r+|e+rm|a+h+|hm+|mm+)\b[,.]?").unwrap()
});
// Discourse fillers — only on Medium (riskier; can change meaning).
static RE_FILLER_MEDIUM: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)\b(?:you know|i mean|sort of|kind of|you see|basically|literally)\b[,]?")
        .unwrap()
});

fn apply_filler_cleanup(input: &str, level: FillerLevel) -> String {
    let mut s = RE_FILLER_LIGHT.replace_all(input, "").to_string();
    if level == FillerLevel::Medium {
        s = RE_FILLER_MEDIUM.replace_all(&s, "").to_string();
        s = dedup_consecutive(&s);
    }
    s
}

/// Collapse immediate word repetition ("the the cat" -> "the cat"). Done in
/// code because the `regex` crate has no backreferences. Line-by-line so any
/// newlines inserted by voice commands survive.
fn dedup_consecutive(input: &str) -> String {
    input
        .split('\n')
        .map(|line| {
            let mut out: Vec<&str> = Vec::new();
            for w in line.split_whitespace() {
                if out.last().map(|p| p.eq_ignore_ascii_case(w)) != Some(true) {
                    out.push(w);
                }
            }
            out.join(" ")
        })
        .collect::<Vec<_>>()
        .join("\n")
}

// ---------------------------------------------------------------------------
// User replacements
// ---------------------------------------------------------------------------

fn apply_replacements(input: &str, rules: &[Replacement]) -> String {
    let mut s = input.to_string();
    for r in rules {
        let from = r.from.trim();
        if from.is_empty() {
            continue;
        }
        // Whole-word, case-insensitive. Escape the pattern so punctuation is literal.
        let pat = format!(r"(?i)\b{}\b", regex::escape(from));
        if let Ok(re) = Regex::new(&pat) {
            // `$` is special in replacement strings; use a closure to insert literally.
            s = re.replace_all(&s, |_: &regex::Captures| r.to.clone()).to_string();
        }
    }
    s
}

// ---------------------------------------------------------------------------
// Whitespace tidy
// ---------------------------------------------------------------------------

static RE_SPACE_BEFORE_PUNCT: Lazy<Regex> = Lazy::new(|| Regex::new(r"\s+([,.!?;:])").unwrap());
static RE_MULTISPACE: Lazy<Regex> = Lazy::new(|| Regex::new(r"[ \t]{2,}").unwrap());
static RE_MULTINEWLINE: Lazy<Regex> = Lazy::new(|| Regex::new(r"\n{3,}").unwrap());
static RE_SPACE_AROUND_NL: Lazy<Regex> = Lazy::new(|| Regex::new(r"[ \t]*\n[ \t]*").unwrap());

fn tidy(input: &str) -> String {
    let mut s = RE_SPACE_BEFORE_PUNCT.replace_all(input, "$1").to_string();
    s = RE_MULTISPACE.replace_all(&s, " ").to_string();
    s = RE_SPACE_AROUND_NL.replace_all(&s, "\n").to_string();
    s = RE_MULTINEWLINE.replace_all(&s, "\n\n").to_string();
    s.trim().to_string()
}

/// Build the Whisper initial-prompt string from the user's dictionary terms so
/// the model is biased toward spelling them correctly. Empty -> None.
pub fn dictionary_prompt(terms: &[String]) -> Option<String> {
    let joined: Vec<&str> = terms
        .iter()
        .map(|t| t.trim())
        .filter(|t| !t.is_empty())
        .collect();
    if joined.is_empty() {
        None
    } else {
        // A short glossary sentence is enough to prime Whisper's vocabulary.
        Some(format!("Glossary: {}.", joined.join(", ")))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scratch_that_removes_prior_clause() {
        let out = apply_voice_commands("Let's meet at 2. scratch that Let's meet at 3");
        assert_eq!(out.trim(), "Let's meet at 3");
    }

    #[test]
    fn new_line_command() {
        assert_eq!(tidy(&apply_voice_commands("line one new line line two")), "line one\nline two");
    }

    #[test]
    fn light_filler() {
        let out = apply_filler_cleanup("um so uh this is er a test", FillerLevel::Light);
        assert_eq!(tidy(&out), "so this is a test");
    }

    #[test]
    fn dedup_medium() {
        let out = apply_filler_cleanup("the the cat", FillerLevel::Medium);
        assert_eq!(out.trim(), "the cat");
    }

    #[test]
    fn replacement_whole_word_ci() {
        let rules = vec![Replacement { from: "jason".into(), to: "JSON".into() }];
        assert_eq!(apply_replacements("parse the Jason file", &rules), "parse the JSON file");
    }
}
