//! Wikimedia Commons client: search and download freely licensed photos with their attribution.
//!
//! Uses the public MediaWiki API (no key): `generator=search` over the File namespace plus
//! `prop=imageinfo` with `extmetadata` for author, licence, licence URL and whether attribution is
//! required. Only licences that allow reuse in a video are downloaded: CC0, public domain, CC BY and
//! CC BY-SA. Everything else (NC, ND, GFDL-only, fair use, unknown) is refused with the reason.
//!
//! This file is duplicated in `apps/cli/src/commons.rs` and `apps/desktop/src-tauri/src/commons.rs`.

use std::io::Write;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

pub const API: &str = "https://commons.wikimedia.org/w/api.php";

const METADATA: &str = "LicenseShortName|License|LicenseUrl|UsageTerms|AttributionRequired|Artist|Credit|NonFree|Copyrighted|ObjectName";

/// Originals wider than this (or in a format `image()` cannot show) are fetched as a thumbnail.
pub const MAX_ORIGINAL_WIDTH: u32 = 4096;
const THUMB_WIDTH: u32 = 3840;

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Licence {
    /// e.g. "CC BY-SA 4.0", "Public domain", "CC0"
    pub short: String,
    pub url: Option<String>,
    pub attribution_required: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Hit {
    /// "File:Presidente Bukele (cropped).jpg": pass it to download
    pub title: String,
    pub page_url: String,
    pub thumb_url: Option<String>,
    pub width: u32,
    pub height: u32,
    pub mime: String,
    pub author: String,
    pub licence: String,
    pub licence_url: Option<String>,
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
    pub title: String,
    pub page_url: String,
    pub author: String,
    pub licence: String,
    pub licence_url: Option<String>,
    pub attribution_required: bool,
    pub attribution_file: String,
    /// For `credit(root, { asset })`, which reads the same row: "Photo: AndreX, CC BY-SA 4.0"
    pub credit: String,
    /// For the video description, with the links CC BY needs
    pub description_credit: String,
}

// ---------------------------------------------------------------- API payloads

#[derive(Deserialize)]
struct ApiResponse {
    #[serde(default)]
    query: Option<ApiQuery>,
    #[serde(rename = "continue", default)]
    cont: Option<serde_json::Value>,
    #[serde(default)]
    error: Option<ApiError>,
}

#[derive(Deserialize)]
struct ApiError {
    #[serde(default)]
    info: String,
}

#[derive(Deserialize)]
struct ApiQuery {
    #[serde(default)]
    pages: Vec<ApiPage>,
}

#[derive(Deserialize)]
struct ApiPage {
    #[serde(default)]
    title: String,
    #[serde(default)]
    index: u32,
    #[serde(default)]
    missing: bool,
    #[serde(default)]
    imageinfo: Vec<ImageInfo>,
}

#[derive(Deserialize, Clone)]
struct ImageInfo {
    #[serde(default)]
    url: String,
    #[serde(default)]
    descriptionurl: String,
    #[serde(default)]
    thumburl: Option<String>,
    #[serde(default)]
    width: u32,
    #[serde(default)]
    height: u32,
    #[serde(default)]
    mime: String,
    #[serde(default)]
    extmetadata: serde_json::Map<String, serde_json::Value>,
}

fn meta(info: &ImageInfo, key: &str) -> String {
    info.extmetadata
        .get(key)
        .and_then(|v| v.get("value"))
        .map(|v| match v {
            serde_json::Value::String(s) => s.clone(),
            other => other.to_string(),
        })
        .unwrap_or_default()
}

// ---------------------------------------------------------------- licences

/// Plain text of an extmetadata HTML value ("<a …>AndreX</a>" -> "AndreX").
pub fn plain_text(html: &str) -> String {
    let mut out = String::with_capacity(html.len());
    let mut in_tag = false;
    for c in html.chars() {
        match c {
            '<' => in_tag = true,
            '>' if in_tag => {
                in_tag = false;
                out.push(' ');
            }
            _ if !in_tag => out.push(c),
            _ => {}
        }
    }
    let decoded = out
        .replace("&nbsp;", " ")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&#039;", "'")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&amp;", "&");
    // table cells: no pipes or line breaks
    decoded
        .replace('|', "/")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

/// Whether the file may be reused in a video, from its extmetadata. Err carries the reason.
pub fn licence_of(metadata: &serde_json::Map<String, serde_json::Value>) -> Result<Licence, String> {
    let get = |key: &str| {
        metadata
            .get(key)
            .and_then(|v| v.get("value"))
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim()
            .to_string()
    };
    let short = plain_text(&get("LicenseShortName"));
    let code = get("License").to_ascii_lowercase();
    let url = Some(get("LicenseUrl")).filter(|u| !u.is_empty());
    let attribution_required = !get("AttributionRequired").eq_ignore_ascii_case("false");
    let name = if short.is_empty() { code.clone() } else { short.clone() };
    let lower = format!("{} {}", code, short.to_ascii_lowercase());

    if get("NonFree").eq_ignore_ascii_case("true") || lower.contains("fair use") {
        return Err(format!("\"{name}\" is a non-free (fair use) file"));
    }
    if lower.contains("-nc") || lower.contains("noncommercial") {
        return Err(format!("\"{name}\" allows non-commercial use only"));
    }
    if lower.contains("-nd") || lower.contains("noderiv") {
        return Err(format!("\"{name}\" allows no derivatives, and a video edit is one"));
    }

    let cc_by = |prefix: &str| {
        code.strip_prefix(prefix)
            .is_some_and(|rest| rest.is_empty() || rest.starts_with(|c: char| c.is_ascii_digit()) || rest.starts_with('-'))
    };
    let allowed = code.starts_with("cc0")
        || code == "pd"
        || code.starts_with("pd-")
        || lower.contains("public domain")
        || short.eq_ignore_ascii_case("cc0")
        || cc_by("cc-by-sa-")
        || cc_by("cc-by-")
        || code == "cc-by"
        || code == "cc-by-sa"
        || (code.is_empty() && (short.starts_with("CC BY ") || short.starts_with("CC BY-SA ")));
    if allowed {
        let public = code.starts_with("cc0") || code == "pd" || code.starts_with("pd-") || lower.contains("public domain");
        return Ok(Licence {
            short: if short.is_empty() { code.to_ascii_uppercase() } else { short },
            url,
            attribution_required: attribution_required && !public,
        });
    }
    if lower.contains("gfdl") {
        return Err(format!(
            "\"{name}\" (GFDL) requires the full licence text to travel with the video; pick a CC or public domain file"
        ));
    }
    if name.is_empty() {
        return Err("the file has no machine-readable licence".to_string());
    }
    Err(format!(
        "\"{name}\" is not on the allowed list (CC0, public domain, CC BY, CC BY-SA)"
    ))
}

fn author_of(info: &ImageInfo) -> String {
    let artist = plain_text(&meta(info, "Artist"));
    let credit = plain_text(&meta(info, "Credit"));
    let author = if !artist.is_empty() {
        artist
    } else if !credit.is_empty() && !credit.eq_ignore_ascii_case("own work") {
        credit
    } else {
        "Unknown author".to_string()
    };
    if author.chars().count() > 120 {
        format!("{}…", author.chars().take(119).collect::<String>())
    } else {
        author
    }
}

fn hit_of(page: &ApiPage) -> Option<Hit> {
    let info = page.imageinfo.first()?;
    let licence = licence_of(&info.extmetadata);
    let (licence_name, licence_url, refused) = match &licence {
        Ok(l) => (l.short.clone(), l.url.clone(), None),
        Err(reason) => (plain_text(&meta(info, "LicenseShortName")), None, Some(reason.clone())),
    };
    Some(Hit {
        title: page.title.clone(),
        page_url: info.descriptionurl.clone(),
        thumb_url: info.thumburl.clone(),
        width: info.width,
        height: info.height,
        mime: info.mime.clone(),
        author: author_of(info),
        licence: licence_name,
        licence_url,
        reusable: licence.is_ok(),
        refused,
    })
}

// ---------------------------------------------------------------- HTTP

fn client() -> reqwest::Client {
    // Wikimedia asks API clients to identify themselves with a project URL
    reqwest::Client::builder()
        .user_agent(format!(
            "liosvideo/{} (https://github.com/ibrahimhnif/liosvideo)",
            env!("CARGO_PKG_VERSION")
        ))
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .unwrap_or_else(|_| reqwest::Client::new())
}

async fn api(params: &[(&str, String)]) -> Result<ApiResponse, String> {
    let mut url = reqwest::Url::parse(API).map_err(|e| format!("invalid Commons URL: {e}"))?;
    {
        let mut pairs = url.query_pairs_mut();
        pairs.append_pair("action", "query");
        pairs.append_pair("format", "json");
        pairs.append_pair("formatversion", "2");
        pairs.append_pair("prop", "imageinfo");
        pairs.append_pair("iiprop", "url|size|mime|extmetadata");
        pairs.append_pair("iiextmetadatafilter", METADATA);
        for (k, v) in params {
            pairs.append_pair(k, v);
        }
    }
    let response = client()
        .get(url)
        .send()
        .await
        .map_err(|e| format!("Wikimedia Commons request failed: {e}"))?;
    let status = response.status();
    if !status.is_success() {
        return Err(format!("Wikimedia Commons returned HTTP {status}"));
    }
    let body: ApiResponse = response
        .json()
        .await
        .map_err(|e| format!("Wikimedia Commons returned invalid JSON: {e}"))?;
    if let Some(error) = &body.error {
        return Err(format!("Wikimedia Commons: {}", error.info));
    }
    Ok(body)
}

/// Photos and drawings on Commons matching `query`, with their licence checked.
pub async fn search(query: &str, page: u32, limit: u32) -> Result<SearchPage, String> {
    let page = page.max(1);
    let limit = limit.clamp(1, 50);
    let body = api(&[
        ("generator", "search".to_string()),
        ("gsrsearch", format!("{query} filetype:bitmap|drawing")),
        ("gsrnamespace", "6".to_string()),
        ("gsrlimit", limit.to_string()),
        ("gsroffset", ((page - 1) * limit).to_string()),
        ("iiurlwidth", "640".to_string()),
    ])
    .await?;
    Ok(search_page(query, page, body))
}

fn search_page(query: &str, page: u32, body: ApiResponse) -> SearchPage {
    let mut pages = body.query.map(|q| q.pages).unwrap_or_default();
    pages.sort_by_key(|p| p.index);
    SearchPage {
        query: query.to_string(),
        page,
        hits: pages.iter().filter_map(hit_of).collect(),
        has_more: body.cont.is_some(),
    }
}

/// "File:X.jpg", "X.jpg" or "https://commons.wikimedia.org/wiki/File:X.jpg" -> "File:X.jpg".
pub fn file_title(input: &str) -> Result<String, String> {
    let mut s = input.trim().to_string();
    if let Some(idx) = s.find("/wiki/") {
        s = s[idx + "/wiki/".len()..].to_string();
        s = percent_decode(&s);
    }
    let s = s.split(['#', '?']).next().unwrap_or("").replace('_', " ");
    let name = s
        .strip_prefix("File:")
        .or_else(|| s.strip_prefix("file:"))
        .or_else(|| s.strip_prefix("Image:"))
        .unwrap_or(&s)
        .trim();
    if name.is_empty() || !name.contains('.') {
        return Err(format!("not a Commons file name: \"{input}\" (expected File:Name.jpg)"));
    }
    Ok(format!("File:{name}"))
}

fn percent_decode(s: &str) -> String {
    let hex = |b: u8| (b as char).to_digit(16).map(|d| d as u8);
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        let escaped = if bytes[i] == b'%' && i + 2 < bytes.len() {
            hex(bytes[i + 1]).zip(hex(bytes[i + 2]))
        } else {
            None
        };
        if let Some((hi, lo)) = escaped {
            out.push(hi * 16 + lo);
            i += 3;
            continue;
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Only https files on wikimedia.org hosts are fetched.
fn is_trusted_file(url: &str) -> bool {
    reqwest::Url::parse(url).ok().is_some_and(|url| {
        url.scheme() == "https"
            && url
                .host_str()
                .is_some_and(|host| host == "wikimedia.org" || host.ends_with(".wikimedia.org"))
    })
}

/// Formats `image()` shows as they are; others come down as Commons' JPEG/PNG thumbnail.
fn shows_as_is(mime: &str) -> bool {
    matches!(mime, "image/jpeg" | "image/png" | "image/webp" | "image/svg+xml" | "image/gif")
}

fn extension_of(url: &str, mime: &str) -> &'static str {
    let path = url.split('?').next().unwrap_or("").to_ascii_lowercase();
    if path.ends_with(".png") {
        "png"
    } else if path.ends_with(".webp") {
        "webp"
    } else if path.ends_with(".svg") {
        "svg"
    } else if path.ends_with(".gif") {
        "gif"
    } else if path.ends_with(".jpg") || path.ends_with(".jpeg") {
        "jpg"
    } else {
        match mime {
            "image/png" => "png",
            "image/webp" => "webp",
            "image/svg+xml" => "svg",
            _ => "jpg",
        }
    }
}

/// `assets/images/<name>.<ext>`: letters, digits, `-`, `_`, `.` and spaces only.
pub fn asset_filename(title: &str, name: Option<&str>, ext: &str) -> String {
    let raw = match name {
        Some(name) if !name.trim().is_empty() => name.trim().to_string(),
        _ => {
            let file = title.strip_prefix("File:").unwrap_or(title);
            match file.rfind('.') {
                Some(dot) => file[..dot].to_string(),
                None => file.to_string(),
            }
        }
    };
    let mut clean: String = raw
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_' | ' ') { c } else { '_' })
        .collect();
    clean = clean.trim().trim_matches('.').replace("..", "_");
    if clean.is_empty() {
        clean = "commons-image".to_string();
    }
    let lower = clean.to_ascii_lowercase();
    for known in [".jpg", ".jpeg", ".png", ".webp", ".svg", ".gif"] {
        if lower.ends_with(known) {
            clean.truncate(clean.len() - known.len());
            break;
        }
    }
    format!("{clean}.{ext}")
}

fn unique_path(dir: &Path, filename: &str) -> PathBuf {
    let path = dir.join(filename);
    if !path.exists() {
        return path;
    }
    let p = Path::new(filename);
    let stem = p.file_stem().and_then(|s| s.to_str()).unwrap_or("image");
    let ext = p.extension().and_then(|s| s.to_str()).unwrap_or("jpg");
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    dir.join(format!("{stem}-{stamp}.{ext}"))
}

/// Checks the licence, saves the file into `assets/images/` and records its attribution row.
/// `width` asks for a thumbnail that wide instead of the original.
pub async fn download(
    root: &Path,
    file: &str,
    name: Option<&str>,
    width: Option<u32>,
    force: bool,
) -> Result<Downloaded, String> {
    let title = file_title(file)?;
    let mut params = vec![("titles", title.clone())];
    if let Some(w) = width {
        params.push(("iiurlwidth", w.clamp(64, 8000).to_string()));
    } else {
        params.push(("iiurlwidth", THUMB_WIDTH.to_string()));
    }
    let body = api(&params).await?;
    let page = body
        .query
        .and_then(|q| q.pages.into_iter().next())
        .ok_or_else(|| format!("Wikimedia Commons returned nothing for {title}"))?;
    if page.missing {
        return Err(format!("{title} does not exist on Wikimedia Commons"));
    }
    let info = page
        .imageinfo
        .first()
        .cloned()
        .ok_or_else(|| format!("{title} has no image information"))?;
    let licence = licence_of(&info.extmetadata).map_err(|reason| format!("refusing {title}: {reason}"))?;
    let author = author_of(&info);

    let use_thumb = width.is_some() || !shows_as_is(&info.mime) || info.width > MAX_ORIGINAL_WIDTH;
    let url = match (&info.thumburl, use_thumb) {
        (Some(thumb), true) => thumb.clone(),
        _ => info.url.clone(),
    };
    if !is_trusted_file(&url) {
        return Err(format!("refusing to download a file outside wikimedia.org: {url}"));
    }

    let dir = root.join("assets").join("images");
    std::fs::create_dir_all(&dir).map_err(|e| format!("couldn't create {}: {e}", dir.display()))?;
    let filename = asset_filename(&title, name, extension_of(&url, &info.mime));
    let path = if force { dir.join(&filename) } else { unique_path(&dir, &filename) };
    let final_name = path.file_name().and_then(|n| n.to_str()).unwrap_or(&filename).to_string();

    let mut response = client()
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("download failed: {e}"))?;
    if !response.status().is_success() {
        return Err(format!("download returned HTTP {}", response.status()));
    }
    let mut out = std::fs::File::create(&path).map_err(|e| format!("couldn't create {}: {e}", path.display()))?;
    let mut size_bytes = 0u64;
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|e| format!("download interrupted: {e}"))?
    {
        out.write_all(&chunk)
            .map_err(|e| format!("couldn't write {}: {e}", path.display()))?;
        size_bytes += chunk.len() as u64;
    }
    out.flush().map_err(|e| format!("couldn't flush {}: {e}", path.display()))?;
    drop(out);
    if size_bytes == 0 {
        let _ = std::fs::remove_file(&path);
        return Err(format!("the file was empty: {url}"));
    }

    let rel_path = format!("assets/images/{final_name}");
    let page_url = info.descriptionurl.clone();
    let attribution_file = record_attribution(root, &rel_path, &page_url, &author, &licence)?;
    let (credit, description_credit) = credits(&author, &licence, &page_url);
    Ok(Downloaded {
        rel_path,
        filename: final_name,
        size_bytes,
        title,
        page_url,
        author,
        licence: licence.short,
        licence_url: licence.url,
        attribution_required: licence.attribution_required,
        attribution_file,
        credit,
        description_credit,
    })
}

/// The on-screen credit (what `credit(root, { asset })` renders from the row) and the
/// description credit with the links CC BY asks for.
pub fn credits(author: &str, licence: &Licence, page_url: &str) -> (String, String) {
    let on_screen = format!("Photo: {author}, {}", licence.short);
    let link = licence
        .url
        .as_deref()
        .map(|u| format!(" ({u})"))
        .unwrap_or_default();
    let description = format!("Photo: {author}, {}{link}, via Wikimedia Commons: {page_url}", licence.short);
    (on_screen, description)
}

const ATTRIBUTIONS_HEADER: &str = "# Project Asset Attributions\n\n\
| Asset | Source / URL | Author / Creator | License | Notes / Usage |\n\
| :--- | :--- | :--- | :--- | :--- |\n";

/// Adds (or replaces) the file's row in `assets/ATTRIBUTIONS.md`. Author and licence are plain
/// text, because `credit()` puts them on screen as written.
pub fn record_attribution(
    root: &Path,
    rel_path: &str,
    page_url: &str,
    author: &str,
    licence: &Licence,
) -> Result<String, String> {
    let path = root.join("assets").join("ATTRIBUTIONS.md");
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("couldn't create {}: {e}", parent.display()))?;
    }
    let mut body = std::fs::read_to_string(&path).unwrap_or_default();
    if body.trim().is_empty() {
        body = ATTRIBUTIONS_HEADER.to_string();
    }
    let notes = match &licence.url {
        Some(url) => format!("Wikimedia Commons; licence {url}"),
        None => "Wikimedia Commons".to_string(),
    };
    let row = format!(
        "| `{rel_path}` | {page_url} | {author} | {} | {notes} |",
        licence.short.replace('|', "/")
    );
    let prefix = format!("| `{rel_path}` |");
    let mut lines: Vec<&str> = body.lines().filter(|line| !line.starts_with(&prefix)).collect();
    while lines.last().is_some_and(|line| line.trim().is_empty()) {
        lines.pop();
    }
    lines.push(&row);
    let mut next = lines.join("\n");
    next.push('\n');
    std::fs::write(&path, next).map_err(|e| format!("couldn't write {}: {e}", path.display()))?;
    Ok("assets/ATTRIBUTIONS.md".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn metadata(v: serde_json::Value) -> serde_json::Map<String, serde_json::Value> {
        v.as_object()
            .unwrap()
            .iter()
            .map(|(k, v)| (k.clone(), json!({ "value": v })))
            .collect()
    }

    #[test]
    fn allows_cc0_public_domain_cc_by_and_cc_by_sa() {
        let ok = |m: serde_json::Value| licence_of(&metadata(m)).unwrap();
        let sa = ok(json!({ "License": "cc-by-sa-4.0", "LicenseShortName": "CC BY-SA 4.0",
            "LicenseUrl": "https://creativecommons.org/licenses/by-sa/4.0", "AttributionRequired": "true" }));
        assert_eq!(sa.short, "CC BY-SA 4.0");
        assert!(sa.attribution_required);
        assert_eq!(ok(json!({ "License": "cc-by-2.0", "LicenseShortName": "CC BY 2.0" })).short, "CC BY 2.0");
        let pd = ok(json!({ "License": "pd", "LicenseShortName": "Public domain", "AttributionRequired": "false" }));
        assert!(!pd.attribution_required);
        assert_eq!(ok(json!({ "License": "cc0", "LicenseShortName": "CC0" })).short, "CC0");
        assert!(licence_of(&metadata(json!({ "License": "pd-usgov", "LicenseShortName": "Public domain" }))).is_ok());
    }

    #[test]
    fn refuses_licences_that_do_not_allow_reuse_with_a_reason() {
        let no = |m: serde_json::Value| licence_of(&metadata(m)).unwrap_err();
        assert!(no(json!({ "License": "cc-by-nc-sa-2.0", "LicenseShortName": "CC BY-NC-SA 2.0" })).contains("non-commercial"));
        assert!(no(json!({ "License": "cc-by-nd-4.0", "LicenseShortName": "CC BY-ND 4.0" })).contains("no derivatives"));
        assert!(no(json!({ "License": "gfdl", "LicenseShortName": "GFDL" })).contains("GFDL"));
        assert!(no(json!({ "LicenseShortName": "Fair use", "NonFree": "true" })).contains("non-free"));
        assert!(no(json!({ "License": "fal", "LicenseShortName": "FAL" })).contains("not on the allowed list"));
        assert!(no(json!({})).contains("no machine-readable licence"));
    }

    #[test]
    fn strips_html_from_authors() {
        assert_eq!(
            plain_text(r#"<a href="//commons.wikimedia.org/w/index.php?title=User:AndreX&amp;action=edit" class="new">AndreX</a>"#),
            "AndreX"
        );
        assert_eq!(plain_text("<span>Casa&nbsp;Presidencial</span> | <b>SV</b>"), "Casa Presidencial / SV");
    }

    #[test]
    fn parses_a_search_response_in_rank_order() {
        let body: ApiResponse = serde_json::from_value(json!({
            "continue": { "gsroffset": 2 },
            "query": { "pages": [
                { "title": "File:B.png", "index": 2, "imageinfo": [{ "url": "https://upload.wikimedia.org/b.png",
                  "descriptionurl": "https://commons.wikimedia.org/wiki/File:B.png", "width": 10, "height": 10, "mime": "image/png",
                  "extmetadata": { "License": { "value": "cc-by-nc-4.0" }, "LicenseShortName": { "value": "CC BY-NC 4.0" } } }] },
                { "title": "File:Presidente Bukele (cropped).jpg", "index": 1, "imageinfo": [{
                  "url": "https://upload.wikimedia.org/wikipedia/commons/e/ef/Presidente_Bukele_%28cropped%29.jpg",
                  "descriptionurl": "https://commons.wikimedia.org/wiki/File:Presidente_Bukele_(cropped).jpg",
                  "width": 661, "height": 881, "mime": "image/jpeg",
                  "extmetadata": {
                    "Artist": { "value": "<a href=\"//commons.wikimedia.org/wiki/User:AndreX\">AndreX</a>" },
                    "LicenseShortName": { "value": "CC BY-SA 4.0" }, "License": { "value": "cc-by-sa-4.0" },
                    "LicenseUrl": { "value": "https://creativecommons.org/licenses/by-sa/4.0" },
                    "AttributionRequired": { "value": "true" } } }] }
            ] }
        }))
        .unwrap();
        let page = search_page("Nayib Bukele", 1, body);
        assert!(page.has_more);
        assert_eq!(page.hits[0].title, "File:Presidente Bukele (cropped).jpg");
        assert_eq!(page.hits[0].author, "AndreX");
        assert!(page.hits[0].reusable);
        assert!(!page.hits[1].reusable);
        assert!(page.hits[1].refused.as_deref().unwrap().contains("non-commercial"));
    }

    #[test]
    fn reads_file_titles_from_names_and_urls() {
        assert_eq!(file_title("File:A b.jpg").unwrap(), "File:A b.jpg");
        assert_eq!(file_title("A_b.jpg").unwrap(), "File:A b.jpg");
        assert_eq!(
            file_title("https://commons.wikimedia.org/wiki/File:Presidente_Bukele_(cropped).jpg").unwrap(),
            "File:Presidente Bukele (cropped).jpg"
        );
        assert_eq!(
            file_title("https://commons.wikimedia.org/wiki/File:Caf%C3%A9.png#Licensing").unwrap(),
            "File:Café.png"
        );
        assert!(file_title("Bukele").is_err());
    }

    #[test]
    fn names_and_hosts() {
        assert_eq!(asset_filename("File:Presidente Bukele (cropped).jpg", None, "jpg"), "Presidente Bukele _cropped_.jpg");
        assert_eq!(asset_filename("File:x.tif", Some("../bukele.jpg"), "jpg"), "_bukele.jpg");
        assert_eq!(asset_filename("File:x.png", Some("hero"), "png"), "hero.png");
        assert!(is_trusted_file("https://upload.wikimedia.org/wikipedia/commons/e/ef/x.jpg"));
        assert!(is_trusted_file("https://thumb.wikimedia.org/x.png"));
        assert!(!is_trusted_file("http://upload.wikimedia.org/x.jpg"));
        assert!(!is_trusted_file("https://wikimedia.org.evil.example/x.jpg"));
        assert_eq!(extension_of("https://upload.wikimedia.org/a/b/X.JPG?utm=1", "image/jpeg"), "jpg");
        assert_eq!(extension_of("https://thumb.wikimedia.org/a.tif/960px-a.tif.jpg", "image/tiff"), "jpg");
    }

    #[test]
    fn records_a_row_credit_reads_and_replaces_it_on_redownload() {
        let dir = tempfile::tempdir().unwrap();
        let licence = Licence {
            short: "CC BY-SA 4.0".into(),
            url: Some("https://creativecommons.org/licenses/by-sa/4.0".into()),
            attribution_required: true,
        };
        let page = "https://commons.wikimedia.org/wiki/File:Presidente_Bukele_(cropped).jpg";
        for _ in 0..2 {
            record_attribution(dir.path(), "assets/images/bukele.jpg", page, "AndreX", &licence).unwrap();
        }
        let body = std::fs::read_to_string(dir.path().join("assets/ATTRIBUTIONS.md")).unwrap();
        assert_eq!(body.matches("assets/images/bukele.jpg").count(), 1);
        assert!(body.contains(&format!("| `assets/images/bukele.jpg` | {page} | AndreX | CC BY-SA 4.0 |")));
        let (on_screen, description) = credits("AndreX", &licence, page);
        assert_eq!(on_screen, "Photo: AndreX, CC BY-SA 4.0");
        assert!(description.contains("creativecommons.org/licenses/by-sa/4.0") && description.contains(page));
    }

    #[tokio::test]
    #[ignore = "hits the live Wikimedia Commons API"]
    async fn live_search_and_download() {
        let page = search("Nayib Bukele", 1, 5).await.unwrap();
        assert!(!page.hits.is_empty());
        let hit = page.hits.iter().find(|h| h.reusable).expect("a reusable hit");
        let dir = tempfile::tempdir().unwrap();
        let saved = download(dir.path(), &hit.title, None, Some(320), false).await.unwrap();
        assert!(dir.path().join(&saved.rel_path).exists());
        assert!(std::fs::read_to_string(dir.path().join("assets/ATTRIBUTIONS.md")).unwrap().contains(&saved.rel_path));
    }
}
