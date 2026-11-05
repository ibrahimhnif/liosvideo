//! Destockd client: free archival footage from the FedFlix archive.
//!
//! Public JSON API (no auth): <https://www.destockd.com/api>
//! - `GET /search?q=&page=[&include_homepage_excluded=true]`
//! - `GET /random?count=[&include_homepage_excluded=true]`
//! - `GET /shot/:film/:shot`
//!
//! Downloads are plain MP4 GETs from `clips.destockd.com`. Destockd does not certify per-clip
//! rights, so every download writes a row to `assets/ATTRIBUTIONS.md` and returns a rights notice.
//!
//! This file is duplicated in `apps/cli/src/destockd.rs` and `apps/desktop/src-tauri/src/destockd.rs`.

use std::io::Write;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

pub const API_BASE: &str = "https://www.destockd.com/api";
pub const SITE_BASE: &str = "https://www.destockd.com";

pub const RIGHTS_NOTICE: &str = "Destockd hosts FedFlix/government footage believed to be public domain or \
otherwise unrestricted in the US. Per-clip rights are not certified: check the source record before \
commercial use and keep the attribution row.";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Hit {
    pub film: String,
    pub shot: String,
    #[serde(default)]
    pub keyframe: String,
    #[serde(default)]
    pub preview: String,
    #[serde(default)]
    pub clip: String,
    #[serde(default)]
    pub color_type: String,
    #[serde(default)]
    pub score: Option<f64>,
}

#[derive(Debug, Clone, Serialize)]
pub struct SearchPage {
    pub query: String,
    pub page: u32,
    pub hits: Vec<Hit>,
    pub has_more: bool,
    pub include_disturbing: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShotDetail {
    pub clip: String,
    pub preview: String,
    pub archive_url: Option<String>,
    pub national_archives_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Downloaded {
    pub rel_path: String,
    pub filename: String,
    pub size_bytes: u64,
    pub film: String,
    pub shot: String,
    pub clip: String,
    pub page_url: String,
    pub archive_url: Option<String>,
    pub national_archives_url: Option<String>,
    pub attribution_file: String,
    pub rights: String,
}

#[derive(Deserialize)]
struct SearchResponse {
    #[serde(default)]
    results: Vec<Hit>,
    #[serde(default)]
    has_more: bool,
}

fn client() -> reqwest::Client {
    reqwest::Client::builder()
        .user_agent(format!("liosvideo/{}", env!("CARGO_PKG_VERSION")))
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .unwrap_or_else(|_| reqwest::Client::new())
}

/// RFC 3986 percent-encoding for a single path segment (film titles contain `%`, `#`, `'`, `[`).
pub fn encode_segment(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for byte in value.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => out.push(byte as char),
            other => out.push_str(&format!("%{other:02X}")),
        }
    }
    out
}

async fn get_json<T: for<'de> Deserialize<'de>>(url: &str) -> Result<T, String> {
    let response = client()
        .get(url)
        .send()
        .await
        .map_err(|e| format!("Destockd request failed: {e}"))?;
    let status = response.status();
    if !status.is_success() {
        return Err(format!("Destockd returned HTTP {status} for {url}"));
    }
    response
        .json::<T>()
        .await
        .map_err(|e| format!("Destockd returned invalid JSON: {e}"))
}

/// Visual (CLIP) search. Free-text description of what should be on screen.
pub async fn search(query: &str, page: u32, include_disturbing: bool) -> Result<SearchPage, String> {
    let mut url = reqwest::Url::parse(&format!("{API_BASE}/search"))
        .map_err(|e| format!("invalid Destockd URL: {e}"))?;
    {
        let mut pairs = url.query_pairs_mut();
        pairs.append_pair("q", query);
        pairs.append_pair("page", &page.max(1).to_string());
        if include_disturbing {
            pairs.append_pair("include_homepage_excluded", "true");
        }
    }
    let body: SearchResponse = get_json(url.as_str()).await?;
    Ok(SearchPage {
        query: query.to_string(),
        page: page.max(1),
        hits: body.results,
        has_more: body.has_more,
        include_disturbing,
    })
}

/// Random shots, handy for browsing a look (used by the desktop stock panel later).
#[allow(dead_code)]
pub async fn random(count: u32, include_disturbing: bool) -> Result<Vec<Hit>, String> {
    let mut url = reqwest::Url::parse(&format!("{API_BASE}/random"))
        .map_err(|e| format!("invalid Destockd URL: {e}"))?;
    {
        let mut pairs = url.query_pairs_mut();
        pairs.append_pair("count", &count.clamp(1, 48).to_string());
        if include_disturbing {
            pairs.append_pair("include_homepage_excluded", "true");
        }
    }
    let body: SearchResponse = get_json(url.as_str()).await?;
    Ok(body.results)
}

/// One shot's detail: clip URL plus the archive.org / NARA source records.
pub async fn shot(film: &str, shot: &str) -> Result<ShotDetail, String> {
    let url = format!(
        "{API_BASE}/shot/{}/{}",
        encode_segment(film),
        encode_segment(shot)
    );
    get_json(&url).await
}

/// `assets/video/<film> - <shot>.mp4`, sanitised; collisions get a unix suffix unless `force`.
pub fn asset_filename(film: &str, shot: &str, name: Option<&str>) -> String {
    let raw = match name {
        Some(name) if !name.trim().is_empty() => name.trim().to_string(),
        _ => format!("{film} - {shot}"),
    };
    let mut clean: String = raw
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_' | ' ') {
                c
            } else {
                '_'
            }
        })
        .collect();
    clean = clean.trim().trim_matches('.').replace("..", "_");
    if clean.is_empty() {
        clean = "destockd-clip".to_string();
    }
    if !clean.to_ascii_lowercase().ends_with(".mp4") {
        clean.push_str(".mp4");
    }
    clean
}

fn unique_path(dir: &Path, filename: &str) -> PathBuf {
    let path = dir.join(filename);
    if !path.exists() {
        return path;
    }
    let stem = Path::new(filename)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("clip");
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    dir.join(format!("{stem}-{stamp}.mp4"))
}

/// Only https URLs on destockd.com (or its subdomains) may be fetched, so a compromised or
/// misconfigured API response cannot make the app hit arbitrary hosts.
fn is_trusted_clip(url: &str) -> bool {
    reqwest::Url::parse(url).ok().is_some_and(|url| {
        url.scheme() == "https"
            && url
                .host_str()
                .is_some_and(|host| host == "destockd.com" || host.ends_with(".destockd.com"))
    })
}

/// Streams the clip into `assets/video/` and records the attribution row.
pub async fn download(
    root: &Path,
    film: &str,
    shot_name: &str,
    name: Option<&str>,
    force: bool,
) -> Result<Downloaded, String> {
    let detail = shot(film, shot_name).await?;
    if detail.clip.trim().is_empty() {
        return Err(format!("Destockd returned no clip URL for {film} / {shot_name}"));
    }
    if !is_trusted_clip(&detail.clip) {
        return Err(format!(
            "refusing to download a clip outside destockd.com: {}",
            detail.clip
        ));
    }

    let dir = root.join("assets").join("video");
    std::fs::create_dir_all(&dir).map_err(|e| format!("couldn't create {}: {e}", dir.display()))?;
    let filename = asset_filename(film, shot_name, name);
    let path = if force { dir.join(&filename) } else { unique_path(&dir, &filename) };
    let final_name = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or(&filename)
        .to_string();

    let mut response = client()
        .get(&detail.clip)
        .send()
        .await
        .map_err(|e| format!("clip download failed: {e}"))?;
    if !response.status().is_success() {
        return Err(format!("clip download returned HTTP {}", response.status()));
    }

    let mut file =
        std::fs::File::create(&path).map_err(|e| format!("couldn't create {}: {e}", path.display()))?;
    let mut size_bytes = 0u64;
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|e| format!("clip download interrupted: {e}"))?
    {
        file.write_all(&chunk)
            .map_err(|e| format!("couldn't write {}: {e}", path.display()))?;
        size_bytes += chunk.len() as u64;
    }
    file.flush().map_err(|e| format!("couldn't flush {}: {e}", path.display()))?;
    drop(file);
    if size_bytes == 0 {
        let _ = std::fs::remove_file(&path);
        return Err(format!("Destockd clip was empty: {}", detail.clip));
    }

    let rel_path = format!("assets/video/{final_name}");
    let page_url = format!(
        "{SITE_BASE}/#/shot/{}/{}",
        encode_segment(film),
        encode_segment(shot_name)
    );
    let attribution = append_attribution(
        root,
        &rel_path,
        film,
        shot_name,
        &detail.clip,
        &page_url,
        detail.archive_url.as_deref(),
    )?;

    Ok(Downloaded {
        rel_path,
        filename: final_name,
        size_bytes,
        film: film.to_string(),
        shot: shot_name.to_string(),
        clip: detail.clip,
        page_url,
        archive_url: detail.archive_url,
        national_archives_url: detail.national_archives_url,
        attribution_file: attribution,
        rights: RIGHTS_NOTICE.to_string(),
    })
}

const ATTRIBUTIONS_HEADER: &str = "# Project Asset Attributions\n\n\
| Asset | Source / URL | Author / Creator | License | Notes / Usage |\n\
| :--- | :--- | :--- | :--- | :--- |\n";

/// Adds (or refreshes) one row in `assets/ATTRIBUTIONS.md`; returns the file's relative path.
pub fn append_attribution(
    root: &Path,
    rel_path: &str,
    film: &str,
    shot: &str,
    clip: &str,
    page_url: &str,
    archive_url: Option<&str>,
) -> Result<String, String> {
    let path = root.join("assets").join("ATTRIBUTIONS.md");
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("couldn't create {}: {e}", parent.display()))?;
    }
    let mut body = std::fs::read_to_string(&path).unwrap_or_default();
    if body.trim().is_empty() {
        body = ATTRIBUTIONS_HEADER.to_string();
    }

    let source = match archive_url {
        Some(url) => format!("[archive.org]({url})"),
        None => format!("[Destockd]({page_url})"),
    };
    let row = format!(
        "| `{rel_path}` | [Destockd shot]({page_url}) · {clip} | Destockd / FedFlix — {film} ({shot}) | Public domain or unrestricted (verify per clip) | Source record: {source} |"
    );

    let prefix = format!("| `{rel_path}` |");
    let existing = body.lines().find(|line| line.starts_with(&prefix)).map(str::to_string);
    // keep a previously recorded archive.org source when this call could not resolve one
    let keep_existing = archive_url.is_none()
        && existing
            .as_deref()
            .is_some_and(|line| line.contains("archive.org"));
    let mut lines: Vec<&str> = body.lines().filter(|line| !line.starts_with(&prefix)).collect();
    // keep the table contiguous: a blank line between the separator and a row breaks markdown
    while lines.last().is_some_and(|line| line.trim().is_empty()) {
        lines.pop();
    }
    let row_ref: &str = if keep_existing {
        existing.as_deref().unwrap_or(&row)
    } else {
        &row
    };
    lines.push(row_ref);
    let mut next = lines.join("\n");
    next.push('\n');
    std::fs::write(&path, next).map_err(|e| format!("couldn't write {}: {e}", path.display()))?;
    Ok("assets/ATTRIBUTIONS.md".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encodes_path_segments_like_the_site() {
        assert_eq!(
            encode_segment("AMERICAN FIRST ARMY--AACHEN #1"),
            "AMERICAN%20FIRST%20ARMY--AACHEN%20%231"
        );
        assert_eq!(encode_segment("shot_042"), "shot_042");
        assert_eq!(encode_segment("a'b[c]"), "a%27b%5Bc%5D");
    }

    #[test]
    fn sanitises_asset_names() {
        assert_eq!(asset_filename("Task Force", "shot_006", None), "Task Force - shot_006.mp4");
        assert_eq!(asset_filename("a/b", "shot", Some("my clip")), "my clip.mp4");
        assert_eq!(asset_filename("a", "b", Some("../evil.mp4")), "_evil.mp4");
        assert!(asset_filename("a", "b", Some("")).ends_with(".mp4"));
        assert_eq!(asset_filename("#", "?", None), "_ - _.mp4");
    }

    #[test]
    fn only_downloads_from_destockd_hosts() {
        assert!(is_trusted_clip("https://clips.destockd.com/clips/a/b.mp4"));
        assert!(is_trusted_clip("https://destockd.com/x.mp4"));
        assert!(!is_trusted_clip("http://clips.destockd.com/a.mp4"));
        assert!(!is_trusted_clip("https://evil.example/a.mp4"));
        assert!(!is_trusted_clip("https://destockd.com.evil.example/a.mp4"));
        assert!(!is_trusted_clip("file:///etc/passwd"));
    }

    #[test]
    fn parses_search_payloads() {
        let json = r#"{"query":"carrier","results":[
            {"film":"Task Force","shot":"shot_006","keyframe":"/keyframes/Task%20Force/shot_006.jpg",
             "preview":"https://clips.destockd.com/clips/Task%20Force/shot_006_preview.mp4",
             "clip":"https://clips.destockd.com/clips/Task%20Force/shot_006.mp4","color_type":"bw","score":0.29}],
            "has_more":true}"#;
        let page: SearchResponse = serde_json::from_str(json).unwrap();
        assert_eq!(page.results.len(), 1);
        assert_eq!(page.results[0].film, "Task Force");
        assert!(page.has_more);
        assert_eq!(page.results[0].score, Some(0.29));
    }

    #[test]
    fn attribution_rows_are_idempotent() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        let first = append_attribution(
            root,
            "assets/video/Task Force - shot_006.mp4",
            "Task Force",
            "shot_006",
            "https://clips.destockd.com/clips/Task%20Force/shot_006.mp4",
            "https://www.destockd.com/#/shot/Task%20Force/shot_006",
            Some("https://archive.org/details/task_force"),
        )
        .unwrap();
        assert_eq!(first, "assets/ATTRIBUTIONS.md");
        append_attribution(
            root,
            "assets/video/Task Force - shot_006.mp4",
            "Task Force",
            "shot_006",
            "https://clips.destockd.com/clips/Task%20Force/shot_006.mp4",
            "https://www.destockd.com/#/shot/Task%20Force/shot_006",
            None,
        )
        .unwrap();
        let body = std::fs::read_to_string(root.join("assets/ATTRIBUTIONS.md")).unwrap();
        assert_eq!(body.matches("assets/video/Task Force - shot_006.mp4").count(), 1);
        assert!(body.contains("| Asset | Source / URL |"));
        // the archive.org source recorded by the first call survives a refresh without one
        assert!(body.contains("archive.org/details/task_force"));
        assert!(body.contains("destockd.com/#/shot/"));
    }

    #[tokio::test]
    #[ignore = "hits the live Destockd API"]
    async fn live_search_returns_hits() {
        let page = search("aircraft carrier", 1, false).await.unwrap();
        assert!(!page.hits.is_empty());
        assert!(page.hits[0].clip.starts_with("https://"));
    }
}
