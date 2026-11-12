//! Openverse audio client: search and download freely licensed sound effects and music with their
//! attribution.
//!
//! Uses the public Openverse API (no key; anonymous clients get about 20 requests a minute and 200
//! a day). Openverse indexes Freesound (mostly sound effects), Jamendo (music) and Wikimedia Commons
//! audio. Only licences that allow reuse in a video are downloaded: CC0, the Public Domain Mark,
//! CC BY and CC BY-SA. NC, ND and the sampling licences are refused with the reason. Openverse does
//! not verify licences itself, so each file's licence is checked again here before it is saved.
//!
//! This file is duplicated in `apps/cli/src/openverse.rs` and `apps/desktop/src-tauri/src/openverse.rs`.

use std::io::Write;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::commons::{self, Licence};

pub const API: &str = "https://api.openverse.org/v1/audio/";

/// The licences asked for in searches; everything else is refused on download too.
const ALLOWED: &str = "cc0,pdm,by,by-sa";

/// What the agent is looking for, which picks the Openverse sources and the asset folder.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    /// Short sound effects (Freesound) into `assets/audio/sfx/`
    Sfx,
    /// Music beds and songs (Jamendo, Wikimedia Commons audio) into `assets/audio/music/`
    Music,
}

impl Kind {
    pub fn parse(s: &str) -> Result<Option<Kind>, String> {
        match s.trim().to_ascii_lowercase().as_str() {
            "" | "any" | "all" => Ok(None),
            "sfx" | "sound" | "sounds" | "sound_effect" | "effect" => Ok(Some(Kind::Sfx)),
            "music" | "song" | "track" => Ok(Some(Kind::Music)),
            other => Err(format!("unknown audio kind \"{other}\" (use sfx, music or any)")),
        }
    }

    fn sources(self) -> &'static str {
        match self {
            Kind::Sfx => "freesound",
            Kind::Music => "jamendo,wikimedia_audio",
        }
    }

    pub fn folder(self) -> &'static str {
        match self {
            Kind::Sfx => "sfx",
            Kind::Music => "music",
        }
    }

    /// The kind of a result: Freesound is sound effects, the rest is music unless it is short.
    fn of(source: &str, category: Option<&str>, duration_ms: Option<u64>) -> Kind {
        match category {
            Some("sound_effect") => return Kind::Sfx,
            Some("music") => return Kind::Music,
            _ => {}
        }
        if source == "freesound" || duration_ms.is_some_and(|d| d < 20_000) {
            Kind::Sfx
        } else {
            Kind::Music
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Hit {
    /// Openverse id: pass it to download
    pub id: String,
    pub title: String,
    pub creator: String,
    pub licence: String,
    pub licence_url: Option<String>,
    /// freesound, jamendo or wikimedia_audio
    pub source: String,
    pub kind: Kind,
    pub duration_seconds: Option<f64>,
    pub filetype: String,
    /// The original's page (Freesound / Jamendo / Commons)
    pub page_url: String,
    /// The audio file itself, to listen before downloading
    pub preview_url: String,
    pub tags: Vec<String>,
    /// false: the licence does not allow reuse; `refused` says why
    pub reusable: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub refused: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchPage {
    pub query: String,
    pub page: u32,
    pub hits: Vec<Hit>,
    pub has_more: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Downloaded {
    pub rel_path: String,
    pub filename: String,
    pub size_bytes: u64,
    pub id: String,
    pub title: String,
    pub kind: Kind,
    pub page_url: String,
    pub creator: String,
    pub licence: String,
    pub licence_url: Option<String>,
    pub attribution_required: bool,
    pub attribution_file: String,
    pub duration_seconds: Option<f64>,
    /// How to use it in a composition
    pub usage: String,
    /// For `credit(root, { asset })`, which reads the same row: "Music: Kevin MacLeod, CC BY 4.0"
    pub credit: String,
    /// For the video description, with the links CC BY needs
    pub description_credit: String,
}

// ---------------------------------------------------------------- API payloads

#[derive(Deserialize)]
struct ApiPage {
    #[serde(default)]
    page_count: u32,
    #[serde(default)]
    results: Vec<ApiAudio>,
}

#[derive(Deserialize, Clone, Default)]
#[serde(default)]
struct ApiAudio {
    id: String,
    title: Option<String>,
    url: Option<String>,
    foreign_landing_url: Option<String>,
    creator: Option<String>,
    license: String,
    license_version: Option<String>,
    license_url: Option<String>,
    source: Option<String>,
    provider: Option<String>,
    category: Option<String>,
    filetype: Option<String>,
    duration: Option<u64>,
    tags: Vec<ApiTag>,
}

#[derive(Deserialize, Clone, Default)]
#[serde(default)]
struct ApiTag {
    name: String,
}

#[derive(Deserialize, Default)]
#[serde(default)]
struct ApiError {
    detail: Option<serde_json::Value>,
}

// ---------------------------------------------------------------- licences

/// Whether an Openverse licence code allows reuse in a video. Err carries the reason.
pub fn licence_of(code: &str, version: Option<&str>, url: Option<&str>) -> Result<Licence, String> {
    let code = code.trim().to_ascii_lowercase();
    let version = version.map(str::trim).filter(|v| !v.is_empty() && *v != "N/A");
    let with_version = |name: &str| match version {
        Some(v) => format!("{name} {v}"),
        None => name.to_string(),
    };
    let url = url.map(str::to_string).filter(|u| !u.is_empty());
    match code.as_str() {
        "cc0" => Ok(Licence { short: "CC0".into(), url, attribution_required: false }),
        "pdm" => Ok(Licence { short: "Public domain".into(), url, attribution_required: false }),
        "by" => Ok(Licence { short: with_version("CC BY"), url, attribution_required: true }),
        "by-sa" => Ok(Licence { short: with_version("CC BY-SA"), url, attribution_required: true }),
        c if c.contains("nc") => Err(format!("\"{}\" allows non-commercial use only", with_version(&c.to_uppercase()))),
        c if c.contains("nd") => Err(format!(
            "\"{}\" allows no derivatives, and a video edit is one",
            with_version(&c.to_uppercase())
        )),
        "sampling+" => Err("\"Sampling+\" restricts whole-work and advertising use".to_string()),
        "" => Err("the file has no licence".to_string()),
        other => Err(format!(
            "\"{other}\" is not on the allowed list (CC0, public domain, CC BY, CC BY-SA)"
        )),
    }
}

fn source_of(audio: &ApiAudio) -> String {
    audio
        .source
        .clone()
        .or_else(|| audio.provider.clone())
        .unwrap_or_else(|| "openverse".to_string())
}

/// "freesound" -> "Freesound"
pub fn source_name(source: &str) -> &str {
    match source {
        "freesound" => "Freesound",
        "jamendo" => "Jamendo",
        "wikimedia_audio" | "wikimedia" => "Wikimedia Commons",
        "ccmixter" => "ccMixter",
        other => other,
    }
}

fn filetype_of(audio: &ApiAudio) -> String {
    let declared = audio.filetype.clone().unwrap_or_default().to_ascii_lowercase();
    let from_url = audio
        .url
        .as_deref()
        .and_then(|u| u.split(['?', '#']).next())
        .and_then(|u| u.rsplit('/').next())
        .and_then(|f| f.rsplit_once('.'))
        .map(|(_, ext)| ext.to_ascii_lowercase())
        .unwrap_or_default();
    let ext = if declared.is_empty() { from_url } else { declared };
    match ext.as_str() {
        // Jamendo's "mp32" is an mp3 at 192 kbit/s
        "mp32" | "mp31" | "mpeg" => "mp3".into(),
        "oga" | "ogx" | "vorbis" | "opus" => "ogg".into(),
        "wave" => "wav".into(),
        "" => "mp3".into(),
        other => other.to_string(),
    }
}

fn hit_of(audio: &ApiAudio) -> Hit {
    let licence = licence_of(&audio.license, audio.license_version.as_deref(), audio.license_url.as_deref());
    let source = source_of(audio);
    let (licence_name, licence_url, refused) = match &licence {
        Ok(l) => (l.short.clone(), l.url.clone(), None),
        Err(reason) => (audio.license.to_uppercase(), audio.license_url.clone(), Some(reason.clone())),
    };
    Hit {
        id: audio.id.clone(),
        title: clean(audio.title.as_deref().unwrap_or("Untitled")),
        creator: creator_of(audio),
        licence: licence_name,
        licence_url,
        kind: Kind::of(&source, audio.category.as_deref(), audio.duration),
        source,
        duration_seconds: audio.duration.map(|ms| ms as f64 / 1000.0),
        filetype: filetype_of(audio),
        page_url: audio.foreign_landing_url.clone().unwrap_or_default(),
        preview_url: audio.url.clone().unwrap_or_default(),
        tags: audio.tags.iter().take(8).map(|t| t.name.clone()).collect(),
        reusable: licence.is_ok(),
        refused,
    }
}

fn clean(text: &str) -> String {
    let plain = commons::plain_text(text);
    if plain.chars().count() > 120 {
        format!("{}…", plain.chars().take(119).collect::<String>())
    } else {
        plain
    }
}

fn creator_of(audio: &ApiAudio) -> String {
    let creator = clean(audio.creator.as_deref().unwrap_or(""));
    if creator.is_empty() {
        "Unknown creator".to_string()
    } else {
        creator
    }
}

// ---------------------------------------------------------------- HTTP

fn client() -> reqwest::Client {
    reqwest::Client::builder()
        .user_agent(format!(
            "liosvideo/{} (https://github.com/ibrahimhnif/liosvideo)",
            env!("CARGO_PKG_VERSION")
        ))
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .unwrap_or_else(|_| reqwest::Client::new())
}

async fn get_json<T: serde::de::DeserializeOwned>(url: reqwest::Url) -> Result<T, String> {
    let response = client()
        .get(url)
        .send()
        .await
        .map_err(|e| format!("Openverse request failed: {e}"))?;
    let status = response.status();
    if status.as_u16() == 429 {
        return Err(
            "Openverse rate limit reached (anonymous use allows about 20 requests a minute and 200 a day); try again later"
                .to_string(),
        );
    }
    if !status.is_success() {
        let detail = response
            .json::<ApiError>()
            .await
            .ok()
            .and_then(|e| e.detail)
            .map(|d| match d {
                serde_json::Value::String(s) => format!(": {s}"),
                other => format!(": {other}"),
            })
            .unwrap_or_default();
        return Err(format!("Openverse returned HTTP {status}{detail}"));
    }
    response
        .json()
        .await
        .map_err(|e| format!("Openverse returned invalid JSON: {e}"))
}

/// Search URL for `query`: only reusable licences, no mature content.
pub fn search_url(query: &str, kind: Option<Kind>, page: u32, limit: u32) -> reqwest::Url {
    let mut url = reqwest::Url::parse(API).expect("valid Openverse URL");
    {
        let mut pairs = url.query_pairs_mut();
        pairs.append_pair("q", query);
        pairs.append_pair("license", ALLOWED);
        pairs.append_pair("mature", "false");
        pairs.append_pair("page", &page.max(1).to_string());
        pairs.append_pair("page_size", &limit.clamp(1, 20).to_string());
        if let Some(kind) = kind {
            pairs.append_pair("source", kind.sources());
        }
    }
    url
}

/// Sound effects or music on Openverse matching `query`, with their licence checked.
pub async fn search(query: &str, kind: Option<Kind>, page: u32, limit: u32) -> Result<SearchPage, String> {
    let page = page.max(1);
    let body: ApiPage = get_json(search_url(query, kind, page, limit)).await?;
    Ok(search_page(query, page, body))
}

fn search_page(query: &str, page: u32, body: ApiPage) -> SearchPage {
    SearchPage {
        query: query.to_string(),
        page,
        hits: body.results.iter().map(hit_of).collect(),
        has_more: page < body.page_count,
    }
}

/// An Openverse id, or a URL that holds one (openverse.org/audio/<id>, api.openverse.org/v1/audio/<id>/).
pub fn audio_id(input: &str) -> Result<String, String> {
    let s = input.trim();
    let candidate = s
        .split(['?', '#'])
        .next()
        .unwrap_or("")
        .trim_end_matches('/')
        .rsplit('/')
        .next()
        .unwrap_or("");
    let is_uuid = candidate.len() == 36
        && candidate.chars().enumerate().all(|(i, c)| {
            if matches!(i, 8 | 13 | 18 | 23) {
                c == '-'
            } else {
                c.is_ascii_hexdigit()
            }
        });
    if is_uuid {
        Ok(candidate.to_ascii_lowercase())
    } else {
        Err(format!("not an Openverse audio id: \"{input}\" (expected the id from the search, e.g. eab8a6e2-0ac8-4615-9e0d-ebde30523783)"))
    }
}

/// Only https files on the hosts Openverse's audio sources serve from are fetched.
fn is_trusted_file(url: &str) -> bool {
    const HOSTS: [&str; 3] = ["freesound.org", "jamendo.com", "wikimedia.org"];
    reqwest::Url::parse(url).ok().is_some_and(|url| {
        url.scheme() == "https"
            && url
                .host_str()
                .is_some_and(|host| HOSTS.iter().any(|h| host == *h || host.ends_with(&format!(".{h}"))))
    })
}

/// `<name>.<ext>`: letters, digits, `-`, `_` and spaces only.
pub fn asset_filename(title: &str, name: Option<&str>, ext: &str) -> String {
    let raw = match name {
        Some(name) if !name.trim().is_empty() => name.trim(),
        _ => title.trim(),
    };
    let mut clean: String = raw
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | ' ') { c } else { '_' })
        .collect();
    clean = clean.split_whitespace().collect::<Vec<_>>().join(" ");
    clean = clean.trim_matches(|c| c == '_' || c == ' ').to_string();
    if clean.chars().count() > 80 {
        clean = clean.chars().take(80).collect::<String>().trim_end().to_string();
    }
    if clean.is_empty() {
        clean = "openverse-audio".to_string();
    }
    format!("{clean}.{ext}")
}

fn unique_path(dir: &Path, filename: &str) -> PathBuf {
    let path = dir.join(filename);
    if !path.exists() {
        return path;
    }
    let p = Path::new(filename);
    let stem = p.file_stem().and_then(|s| s.to_str()).unwrap_or("audio");
    let ext = p.extension().and_then(|s| s.to_str()).unwrap_or("mp3");
    (2..)
        .map(|n| dir.join(format!("{stem}-{n}.{ext}")))
        .find(|p| !p.exists())
        .expect("a free file name")
}

/// Checks the licence, saves the file into `assets/audio/sfx/` or `assets/audio/music/` and
/// records its attribution row. `kind` overrides the folder picked from the source.
pub async fn download(
    root: &Path,
    id: &str,
    kind: Option<Kind>,
    name: Option<&str>,
    force: bool,
) -> Result<Downloaded, String> {
    let id = audio_id(id)?;
    let url = reqwest::Url::parse(&format!("{API}{id}/")).map_err(|e| format!("invalid Openverse URL: {e}"))?;
    let audio: ApiAudio = get_json(url).await?;
    let hit = hit_of(&audio);
    let licence = licence_of(&audio.license, audio.license_version.as_deref(), audio.license_url.as_deref())
        .map_err(|reason| format!("refusing \"{}\": {reason}", hit.title))?;
    let file_url = audio.url.clone().unwrap_or_default();
    if !is_trusted_file(&file_url) {
        return Err(format!(
            "refusing to download a file outside Freesound, Jamendo and Wikimedia: {file_url}"
        ));
    }
    let kind = kind.unwrap_or(hit.kind);

    let folder = kind.folder();
    let dir = root.join("assets").join("audio").join(folder);
    std::fs::create_dir_all(&dir).map_err(|e| format!("couldn't create {}: {e}", dir.display()))?;
    let filename = asset_filename(&hit.title, name, &hit.filetype);
    let path = if force { dir.join(&filename) } else { unique_path(&dir, &filename) };
    let final_name = path.file_name().and_then(|n| n.to_str()).unwrap_or(&filename).to_string();

    let mut response = client()
        .get(&file_url)
        .send()
        .await
        .map_err(|e| format!("download failed: {e}"))?;
    if !response.status().is_success() {
        return Err(format!("download returned HTTP {}", response.status()));
    }
    let tmp = path.with_extension("part");
    let mut out = std::fs::File::create(&tmp).map_err(|e| format!("couldn't create {}: {e}", tmp.display()))?;
    let mut size_bytes = 0u64;
    loop {
        let chunk = match response.chunk().await {
            Ok(Some(chunk)) => chunk,
            Ok(None) => break,
            Err(e) => {
                let _ = std::fs::remove_file(&tmp);
                return Err(format!("download interrupted: {e}"));
            }
        };
        out.write_all(&chunk)
            .map_err(|e| format!("couldn't write {}: {e}", tmp.display()))?;
        size_bytes += chunk.len() as u64;
    }
    out.flush().map_err(|e| format!("couldn't flush {}: {e}", tmp.display()))?;
    drop(out);
    if size_bytes == 0 {
        let _ = std::fs::remove_file(&tmp);
        return Err(format!("the file was empty: {file_url}"));
    }
    std::fs::rename(&tmp, &path).map_err(|e| format!("couldn't save {}: {e}", path.display()))?;

    let rel_path = format!("assets/audio/{folder}/{final_name}");
    let page_url = if hit.page_url.is_empty() { file_url.clone() } else { hit.page_url.clone() };
    let notes = notes_of(&hit, &licence);
    let attribution_file = commons::record_row(root, &rel_path, &page_url, &hit.creator, &licence.short, &notes)?;
    let (credit, description_credit) = credits(kind, &hit.title, &hit.creator, &licence, &page_url, &hit.source);
    let usage = match kind {
        Kind::Sfx => {
            let stem = Path::new(&final_name).file_stem().and_then(|s| s.to_str()).unwrap_or("sound");
            format!(
                "sfx: \"{rel_path}\" on a move (or add it to composition({{ sfx: {{ library: {{ \"{stem}\": \"{rel_path}\" }} }} }}))"
            )
        }
        Kind::Music => format!(
            "composition({{ audio: [{{ id: \"music\", src: \"{rel_path}\", role: \"music\", volume: 0.3, loop: true }}] }})"
        ),
    };
    Ok(Downloaded {
        rel_path,
        filename: final_name,
        size_bytes,
        id,
        title: hit.title,
        kind,
        page_url,
        creator: hit.creator,
        licence: licence.short.clone(),
        licence_url: licence.url.clone(),
        attribution_required: licence.attribution_required,
        attribution_file,
        duration_seconds: hit.duration_seconds,
        usage,
        credit,
        description_credit,
    })
}

fn notes_of(hit: &Hit, licence: &Licence) -> String {
    let mut notes = format!("\"{}\" via Openverse ({})", hit.title, source_name(&hit.source));
    if let Some(url) = &licence.url {
        notes.push_str(&format!("; licence {url}"));
    }
    notes
}

/// The on-screen credit (what `credit(root, { asset })` renders from the row) and the
/// description credit with the links CC BY asks for.
pub fn credits(kind: Kind, title: &str, creator: &str, licence: &Licence, page_url: &str, source: &str) -> (String, String) {
    let label = match kind {
        Kind::Sfx => "Sound",
        Kind::Music => "Music",
    };
    let on_screen = format!("{label}: {creator}, {}", licence.short);
    let link = licence
        .url
        .as_deref()
        .map(|u| format!(" ({u})"))
        .unwrap_or_default();
    let description = format!(
        "{label}: \"{title}\" by {creator}, {}{link}, via {}: {page_url}",
        licence.short,
        source_name(source)
    );
    (on_screen, description)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn audio(v: serde_json::Value) -> ApiAudio {
        serde_json::from_value(v).unwrap()
    }

    #[test]
    fn allows_cc0_public_domain_cc_by_and_cc_by_sa() {
        let by = licence_of("by", Some("4.0"), Some("https://creativecommons.org/licenses/by/4.0/")).unwrap();
        assert_eq!(by.short, "CC BY 4.0");
        assert!(by.attribution_required);
        assert_eq!(licence_of("by-sa", Some("3.0"), None).unwrap().short, "CC BY-SA 3.0");
        let cc0 = licence_of("cc0", Some("1.0"), None).unwrap();
        assert_eq!(cc0.short, "CC0");
        assert!(!cc0.attribution_required);
        assert!(!licence_of("pdm", None, None).unwrap().attribution_required);
    }

    #[test]
    fn refuses_licences_that_do_not_allow_reuse_with_a_reason() {
        assert!(licence_of("by-nc", Some("4.0"), None).unwrap_err().contains("non-commercial"));
        assert!(licence_of("by-nc-sa", Some("3.0"), None).unwrap_err().contains("non-commercial"));
        assert!(licence_of("nc-sampling+", None, None).unwrap_err().contains("non-commercial"));
        assert!(licence_of("by-nd", Some("4.0"), None).unwrap_err().contains("no derivatives"));
        assert!(licence_of("sampling+", None, None).unwrap_err().contains("Sampling+"));
        assert!(licence_of("", None, None).unwrap_err().contains("no licence"));
    }

    #[test]
    fn asks_only_for_reusable_licences_and_picks_sources_by_kind() {
        let url = search_url("whoosh fast", Some(Kind::Sfx), 2, 50);
        let q: std::collections::HashMap<_, _> = url.query_pairs().into_owned().collect();
        assert_eq!(q["q"], "whoosh fast");
        assert_eq!(q["license"], "cc0,pdm,by,by-sa");
        assert_eq!(q["source"], "freesound");
        assert_eq!(q["page"], "2");
        assert_eq!(q["page_size"], "20");
        assert_eq!(q["mature"], "false");
        let music = search_url("piano", Some(Kind::Music), 1, 5);
        assert!(music.query_pairs().any(|(k, v)| k == "source" && v == "jamendo,wikimedia_audio"));
        assert!(!search_url("piano", None, 1, 5).query_pairs().any(|(k, _)| k == "source"));
    }

    #[test]
    fn parses_a_search_response() {
        let body: ApiPage = serde_json::from_value(json!({
            "result_count": 240, "page_count": 80, "page_size": 3, "page": 1,
            "results": [
                { "id": "eab8a6e2-0ac8-4615-9e0d-ebde30523783", "title": "Deep Whoosh #1",
                  "foreign_landing_url": "https://freesound.org/people/Kinoton/sounds/351256",
                  "url": "https://cdn.freesound.org/previews/351/351256_2247456-hq.mp3",
                  "creator": "Kinoton", "license": "cc0", "license_version": "1.0",
                  "license_url": "https://creativecommons.org/publicdomain/zero/1.0/",
                  "provider": "freesound", "source": "freesound", "category": null,
                  "filetype": "mp3", "duration": 3155, "tags": [{ "name": "whoosh" }, { "name": "deep" }] },
                { "id": "11111111-2222-3333-4444-555555555555", "title": "Song", "creator": "Band",
                  "url": "https://prod-1.storage.jamendo.com/?trackid=1&format=mp32",
                  "license": "by-nc-sa", "license_version": "3.0", "source": "jamendo",
                  "category": "music", "filetype": "mp32", "duration": 122000 }
            ]
        }))
        .unwrap();
        let page = search_page("whoosh", 1, body);
        assert!(page.has_more);
        let a = &page.hits[0];
        assert_eq!((a.title.as_str(), a.creator.as_str(), a.licence.as_str()), ("Deep Whoosh #1", "Kinoton", "CC0"));
        assert_eq!(a.kind, Kind::Sfx);
        assert_eq!(a.duration_seconds, Some(3.155));
        assert_eq!(a.tags, vec!["whoosh", "deep"]);
        assert!(a.reusable);
        let b = &page.hits[1];
        assert_eq!(b.kind, Kind::Music);
        assert_eq!(b.filetype, "mp3");
        assert!(!b.reusable);
        assert!(b.refused.as_deref().unwrap().contains("non-commercial"));
    }

    #[test]
    fn file_types_and_kinds() {
        let ogg = audio(json!({ "id": "x", "license": "by-sa", "filetype": "ogx",
            "url": "https://upload.wikimedia.org/a/Bach.ogx" }));
        assert_eq!(filetype_of(&ogg), "ogg");
        let untyped = audio(json!({ "id": "x", "license": "by", "url": "https://upload.wikimedia.org/a/Tango.WAV" }));
        assert_eq!(filetype_of(&untyped), "wav");
        assert_eq!(Kind::of("wikimedia_audio", None, Some(5_000)), Kind::Sfx);
        assert_eq!(Kind::of("wikimedia_audio", None, Some(200_000)), Kind::Music);
        assert_eq!(Kind::of("jamendo", Some("music"), Some(5_000)), Kind::Music);
        assert_eq!(Kind::parse("SFX").unwrap(), Some(Kind::Sfx));
        assert_eq!(Kind::parse("any").unwrap(), None);
        assert!(Kind::parse("podcast").is_err());
    }

    #[test]
    fn ids_names_and_hosts() {
        let id = "eab8a6e2-0ac8-4615-9e0d-ebde30523783";
        assert_eq!(audio_id(id).unwrap(), id);
        assert_eq!(audio_id(&format!("https://openverse.org/audio/{id}?q=whoosh")).unwrap(), id);
        assert_eq!(audio_id(&format!("https://api.openverse.org/v1/audio/{id}/")).unwrap(), id);
        assert!(audio_id("whoosh").is_err());
        assert_eq!(asset_filename("Deep Whoosh #1", None, "mp3"), "Deep Whoosh _1.mp3");
        assert_eq!(asset_filename("x", Some("../../whoosh"), "mp3"), "whoosh.mp3");
        assert_eq!(asset_filename("???", None, "wav"), "openverse-audio.wav");
        assert!(is_trusted_file("https://cdn.freesound.org/previews/351/351256_2247456-hq.mp3"));
        assert!(is_trusted_file("https://prod-1.storage.jamendo.com/?trackid=1&format=mp32"));
        assert!(is_trusted_file("https://upload.wikimedia.org/wikipedia/commons/0/02/x.ogg"));
        assert!(!is_trusted_file("http://cdn.freesound.org/x.mp3"));
        assert!(!is_trusted_file("https://freesound.org.evil.example/x.mp3"));
    }

    #[test]
    fn records_a_row_credit_reads_and_the_description_credit() {
        let dir = tempfile::tempdir().unwrap();
        let licence = licence_of("by", Some("4.0"), Some("https://creativecommons.org/licenses/by/4.0/")).unwrap();
        let hit = hit_of(&audio(json!({ "id": "x", "title": "Deep | Whoosh", "creator": "Kinoton", "license": "by",
            "license_version": "4.0", "source": "freesound" })));
        let page = "https://freesound.org/people/Kinoton/sounds/351256";
        for _ in 0..2 {
            commons::record_row(dir.path(), "assets/audio/sfx/whoosh.mp3", page, &hit.creator, &licence.short, &notes_of(&hit, &licence))
                .unwrap();
        }
        let body = std::fs::read_to_string(dir.path().join("assets/ATTRIBUTIONS.md")).unwrap();
        assert_eq!(body.matches("assets/audio/sfx/whoosh.mp3").count(), 1);
        assert!(body.contains(&format!("| `assets/audio/sfx/whoosh.mp3` | {page} | Kinoton | CC BY 4.0 | \"Deep / Whoosh\" via Openverse (Freesound); licence https://creativecommons.org/licenses/by/4.0/ |")));
        let (on_screen, description) = credits(Kind::Music, "Tango", "James Peace", &licence, page, "jamendo");
        assert_eq!(on_screen, "Music: James Peace, CC BY 4.0");
        assert!(description.starts_with("Music: \"Tango\" by James Peace, CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/), via Jamendo:"));
    }

    #[tokio::test]
    #[ignore = "hits the live Openverse API"]
    async fn live_search_and_download() {
        let page = search("whoosh", Some(Kind::Sfx), 1, 5).await.unwrap();
        let hit = page.hits.iter().find(|h| h.reusable).expect("a reusable hit");
        let dir = tempfile::tempdir().unwrap();
        let saved = download(dir.path(), &hit.id, None, Some("whoosh"), false).await.unwrap();
        assert_eq!(saved.rel_path, format!("assets/audio/sfx/whoosh.{}", hit.filetype));
        assert!(std::fs::metadata(dir.path().join(&saved.rel_path)).unwrap().len() > 1000);
        assert!(std::fs::read_to_string(dir.path().join("assets/ATTRIBUTIONS.md")).unwrap().contains(&saved.rel_path));
    }
}
