//! Reuse narration that has already been generated: a line is keyed by a hash of its text,
//! voice, provider and model, kept in `.liosvideo/tts-cache.json`. Asking for a line whose key
//! matches and whose audio + timing files still exist returns them without calling (or billing)
//! the provider. Shared verbatim by the CLI (`src/tts/cache.rs`) and the desktop
//! (`src-tauri/src/audio/cache.rs`).

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use super::{LineTiming, TtsProvider, TtsResult};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CacheEntry {
    pub hash: String,
    pub provider: String,
    pub voice: String,
    pub characters: usize,
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct CacheFile {
    lines: BTreeMap<String, CacheEntry>,
}

/// What the cache did for one line.
#[derive(Debug, Clone)]
pub struct CachedOutcome {
    pub result: TtsResult,
    /// True when the existing files were reused and the provider was not called.
    pub cached: bool,
    /// Estimated provider cost (USD) of this line: spent when generated, saved when cached.
    pub cost_usd: f64,
}

/// The model each provider is called with; part of the key so a model change regenerates.
pub fn model_for(provider: &str) -> &'static str {
    match provider {
        p if p.contains("eleven") => "eleven_multilingual_v2",
        p if p.contains("google") => "google-cloud-tts",
        _ => "mock",
    }
}

/// Same rates as the project usage stats.
pub fn estimated_cost(provider: &str, voice: &str, characters: usize) -> f64 {
    let rate = if provider.contains("eleven") {
        0.0003
    } else if provider.contains("google") {
        if voice.contains("Standard") { 0.000004 } else { 0.000016 }
    } else {
        0.0
    };
    (characters as f64 * rate * 100000.0).round() / 100000.0
}

/// Stable 128-bit key (two FNV-1a passes) over everything that changes the audio.
pub fn line_hash(text: &str, voice: &str, provider: &str) -> String {
    let fields = [text.trim(), voice, provider, model_for(provider)];
    let mut out = String::with_capacity(32);
    for seed in [0xcbf2_9ce4_8422_2325_u64, 0x8422_2325_cbf2_9ce4_u64] {
        let mut h = seed;
        for field in fields {
            for b in field.bytes().chain(std::iter::once(0x1f)) {
                h ^= b as u64;
                h = h.wrapping_mul(0x0000_0100_0000_01b3);
            }
        }
        out.push_str(&format!("{h:016x}"));
    }
    out
}

fn cache_path(root: &Path) -> PathBuf {
    root.join(".liosvideo").join("tts-cache.json")
}

fn load(root: &Path) -> CacheFile {
    std::fs::read_to_string(cache_path(root))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn save(root: &Path, cache: &CacheFile) -> Result<(), String> {
    let path = cache_path(root);
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| format!("Failed to create {}: {e}", dir.display()))?;
    }
    let json = serde_json::to_string_pretty(cache).map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| format!("Failed to write {}: {e}", path.display()))
}

/// The files of a line generated earlier with the same key, if they are all still there.
pub fn lookup(root: &Path, line_id: &str, hash: &str) -> Option<TtsResult> {
    let cache = load(root);
    if cache.lines.get(line_id)?.hash != hash {
        return None;
    }
    let audio_rel = format!("assets/audio/vo/{line_id}.mp3");
    let timing_rel = format!("assets/audio/vo/{line_id}.timing.json");
    if !root.join(&audio_rel).is_file() {
        return None;
    }
    let timing: LineTiming = serde_json::from_str(&std::fs::read_to_string(root.join(&timing_rel)).ok()?).ok()?;
    Some(TtsResult {
        line_id: line_id.to_string(),
        audio_rel_path: audio_rel,
        timing_rel_path: timing_rel,
        duration: timing.duration,
        words: timing.words,
    })
}

pub fn remember(root: &Path, line_id: &str, entry: CacheEntry) -> Result<(), String> {
    let mut cache = load(root);
    cache.lines.insert(line_id.to_string(), entry);
    save(root, &cache)
}

/// Generates a line, or returns the existing files when nothing that affects the audio changed.
/// `voice` is the voice actually used (requested or the configured default) and `provider` the
/// provider it routes to; `force` always regenerates.
#[allow(clippy::too_many_arguments)]
pub async fn generate_cached(
    provider: &dyn TtsProvider,
    root: &Path,
    line_id: &str,
    text: &str,
    requested_voice: Option<&str>,
    voice: &str,
    provider_label: &str,
    force: bool,
) -> Result<CachedOutcome, String> {
    let hash = line_hash(text, voice, provider_label);
    let characters = text.chars().count();
    let cost_usd = estimated_cost(provider_label, voice, characters);
    if !force {
        if let Some(result) = lookup(root, line_id, &hash) {
            return Ok(CachedOutcome { result, cached: true, cost_usd });
        }
    }
    let result = provider.generate(line_id, text, requested_voice, root).await?;
    remember(
        root,
        line_id,
        CacheEntry { hash, provider: provider_label.to_string(), voice: voice.to_string(), characters },
    )?;
    Ok(CachedOutcome { result, cached: false, cost_usd })
}

/// `(line id, text)` for each `<!-- vo:<id> -->` block of a script.md, in order. A block's text
/// runs until the next marker or heading; blank lines and other comments are dropped.
pub fn script_lines(markdown: &str) -> Vec<(String, String)> {
    let mut out: Vec<(String, String)> = Vec::new();
    let mut current: Option<(String, Vec<String>)> = None;
    let flush = |current: &mut Option<(String, Vec<String>)>, out: &mut Vec<(String, String)>| {
        if let Some((id, parts)) = current.take() {
            let text = parts.join(" ").split_whitespace().collect::<Vec<_>>().join(" ");
            if !text.is_empty() {
                out.push((id, text));
            }
        }
    };
    for line in markdown.lines() {
        let t = line.trim();
        if let Some(id) = t
            .strip_prefix("<!--")
            .and_then(|r| r.strip_suffix("-->"))
            .map(str::trim)
            .and_then(|r| r.strip_prefix("vo:"))
        {
            flush(&mut current, &mut out);
            current = Some((id.trim().to_string(), Vec::new()));
        } else if t.starts_with('#') {
            flush(&mut current, &mut out);
        } else if let Some((_, parts)) = current.as_mut() {
            if !t.is_empty() && !t.starts_with("<!--") {
                parts.push(t.to_string());
            }
        }
    }
    flush(&mut current, &mut out);
    out
}

#[cfg(test)]
mod tests {
    use super::super::{MockTtsProvider, VoiceInfo};
    use super::*;
    use std::future::Future;
    use std::pin::Pin;
    use std::sync::atomic::{AtomicUsize, Ordering};

    /// The mock provider, counting how often it is asked to synthesise.
    #[derive(Default)]
    struct Counting {
        inner: MockTtsProvider,
        calls: AtomicUsize,
    }

    impl TtsProvider for Counting {
        fn generate(
            &self,
            line_id: &str,
            text: &str,
            voice: Option<&str>,
            project_root: &Path,
        ) -> Pin<Box<dyn Future<Output = Result<TtsResult, String>> + Send>> {
            self.calls.fetch_add(1, Ordering::SeqCst);
            self.inner.generate(line_id, text, voice, project_root)
        }
        fn list_voices(&self) -> Vec<VoiceInfo> {
            vec![]
        }
    }

    async fn run(p: &Counting, root: &Path, id: &str, text: &str, voice: &str, force: bool) -> CachedOutcome {
        generate_cached(p, root, id, text, Some(voice), voice, "elevenlabs", force).await.unwrap()
    }

    #[tokio::test]
    async fn second_run_makes_no_provider_calls() {
        let dir = tempfile::tempdir().unwrap();
        let p = Counting::default();
        let first = run(&p, dir.path(), "h1", "Halo semua", "v1", false).await;
        let second = run(&p, dir.path(), "h1", "Halo semua", "v1", false).await;
        assert_eq!(p.calls.load(Ordering::SeqCst), 1);
        assert!(!first.cached && second.cached);
        assert_eq!(second.result.words, first.result.words);
        assert!((second.cost_usd - 10.0 * 0.0003).abs() < 1e-9);
    }

    #[tokio::test]
    async fn regenerates_when_text_or_voice_changes_or_when_forced() {
        let dir = tempfile::tempdir().unwrap();
        let p = Counting::default();
        run(&p, dir.path(), "h1", "Halo semua", "v1", false).await;
        assert!(!run(&p, dir.path(), "h1", "Halo semuanya", "v1", false).await.cached);
        assert!(!run(&p, dir.path(), "h1", "Halo semuanya", "v2", false).await.cached);
        assert!(!run(&p, dir.path(), "h1", "Halo semuanya", "v2", true).await.cached);
        assert_eq!(p.calls.load(Ordering::SeqCst), 4);
    }

    #[tokio::test]
    async fn regenerates_when_the_audio_file_is_gone() {
        let dir = tempfile::tempdir().unwrap();
        let p = Counting::default();
        run(&p, dir.path(), "h1", "Halo", "v1", false).await;
        std::fs::remove_file(dir.path().join("assets/audio/vo/h1.mp3")).unwrap();
        assert!(!run(&p, dir.path(), "h1", "Halo", "v1", false).await.cached);
    }

    #[test]
    fn hash_covers_text_voice_and_provider() {
        let base = line_hash("a", "v", "elevenlabs");
        assert_eq!(base, line_hash(" a ", "v", "elevenlabs"));
        assert_ne!(base, line_hash("b", "v", "elevenlabs"));
        assert_ne!(base, line_hash("a", "w", "elevenlabs"));
        assert_ne!(base, line_hash("a", "v", "google_cloud"));
        assert_eq!(base.len(), 32);
    }

    #[test]
    fn reads_vo_blocks_from_a_script() {
        let md = "# Hook\n\n<!-- vo:h1 -->\nHalo semua,\nini baris pertama.\n\n<!-- vo:h2 -->\nBaris kedua.\n<!-- note: skip -->\n\n## Next\nNot narration.\n";
        assert_eq!(
            script_lines(md),
            vec![
                ("h1".to_string(), "Halo semua, ini baris pertama.".to_string()),
                ("h2".to_string(), "Baris kedua.".to_string()),
            ]
        );
    }
}
