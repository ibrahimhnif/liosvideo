//! AI image generation with Google Gemini ("Nano Banana") for project assets.
//!
//! Images are generated once and saved as ordinary assets, never at render time, so renders stay
//! deterministic and offline:
//! - the active image lives at `assets/images/<id>.<ext>` (what `image({ src })` points at);
//! - every version is kept at `assets/images/generated/<id>/v<n>.<ext>`;
//! - prompts, revisions and the active version are recorded in `.liosvideo/images.json`;
//! - each image gets a row in `assets/ATTRIBUTIONS.md`.
//!
//! A revision ("darker background", "less saturated") sends the active version back to the model
//! as the base image together with the instruction, and stores the result as a new version.
//!
//! The API key is passed in by the caller (GEMINI_API_KEY / GOOGLE_API_KEY from the keychain).
//! `LIOSVIDEO_GEMINI_BASE_URL` overrides the endpoint (tests, proxies).
//!
//! This file is duplicated in `apps/cli/src/imagegen.rs` and `apps/desktop/src-tauri/src/imagegen.rs`.

use std::path::{Path, PathBuf};

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

pub const DEFAULT_MODEL: &str = "gemini-nano-banana-2.1";
pub const API_BASE: &str = "https://generativelanguage.googleapis.com/v1beta";
pub const ASPECTS: &[&str] = &[
    "1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9",
];
pub const SIZES: &[&str] = &["1K", "2K", "4K"];
pub const KEY_NAMES: &[&str] = &["GEMINI_API_KEY", "GOOGLE_API_KEY"];

const MANIFEST: &str = ".liosvideo/images.json";
const MAX_REF_BYTES: u64 = 15 * 1024 * 1024;

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Version {
    pub n: u32,
    /// Project-relative path of this version's file.
    pub file: String,
    /// The full prompt for a fresh generation, or the revision instruction for an edit.
    pub prompt: String,
    /// Version this one was revised from (None for a fresh generation).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub from: Option<u32>,
    pub model: String,
    pub aspect: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub refs: Vec<String>,
    pub created_at: u64,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ImageEntry {
    pub id: String,
    /// Project-relative path scenes use: `assets/images/<id>.<ext>`.
    pub src: String,
    pub active: u32,
    pub versions: Vec<Version>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Manifest {
    #[serde(default)]
    pub images: Vec<ImageEntry>,
}

#[derive(Debug, Clone, Default)]
pub struct GenerateOptions {
    pub aspect: Option<String>,
    pub size: Option<String>,
    pub model: Option<String>,
    /// Project-relative reference images (style, character, product to keep consistent).
    pub refs: Vec<String>,
}

/// Image bytes returned by the model.
#[derive(Debug, Clone)]
pub struct ImageData {
    pub mime: String,
    pub bytes: Vec<u8>,
}

fn now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

/// `palace-night` style ids: lowercase ascii letters, digits, `-` and `_`.
pub fn clean_id(raw: &str) -> Result<String, String> {
    let mut id = String::new();
    for c in raw.trim().chars() {
        if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
            id.push(c.to_ascii_lowercase());
        } else if (c == ' ' || c == '.') && !id.ends_with('-') {
            id.push('-');
        }
    }
    let id = id.trim_matches('-').to_string();
    if id.is_empty() {
        return Err(format!("invalid image id \"{raw}\": use letters, digits, - or _"));
    }
    Ok(id)
}

/// 9:16 when the project only has a vertical composition, else 16:9.
pub fn default_aspect(root: &Path) -> String {
    if root.join("short.ts").exists() && !root.join("long.ts").exists() {
        "9:16".into()
    } else {
        "16:9".into()
    }
}

fn ext_for(mime: &str) -> &'static str {
    match mime {
        "image/jpeg" | "image/jpg" => "jpg",
        "image/webp" => "webp",
        _ => "png",
    }
}

fn mime_for(path: &Path) -> Result<&'static str, String> {
    match path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .as_deref()
    {
        Some("png") => Ok("image/png"),
        Some("jpg") | Some("jpeg") => Ok("image/jpeg"),
        Some("webp") => Ok("image/webp"),
        _ => Err(format!(
            "{}: reference images must be PNG, JPEG or WebP",
            path.display()
        )),
    }
}

/// Resolves a project-relative path and refuses anything outside the project.
fn inside(root: &Path, rel: &str) -> Result<PathBuf, String> {
    let rel_path = Path::new(rel);
    if rel_path.is_absolute()
        || rel_path
            .components()
            .any(|c| matches!(c, std::path::Component::ParentDir))
    {
        return Err(format!("{rel}: use a path inside the project, e.g. assets/images/x.png"));
    }
    Ok(root.join(rel_path))
}

pub fn load_manifest(root: &Path) -> Manifest {
    std::fs::read_to_string(root.join(MANIFEST))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn save_manifest(root: &Path, manifest: &Manifest) -> Result<(), String> {
    let path = root.join(MANIFEST);
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| format!("couldn't create {}: {e}", dir.display()))?;
    }
    let body = serde_json::to_string_pretty(manifest).map_err(|e| e.to_string())?;
    std::fs::write(&path, body + "\n").map_err(|e| format!("couldn't write {}: {e}", path.display()))
}

pub fn find(root: &Path, id: &str) -> Option<ImageEntry> {
    load_manifest(root).images.into_iter().find(|e| e.id == id)
}

/// Request body for `models/<model>:generateContent`. `images` go after the text, base first.
pub fn request_body(prompt: &str, images: &[ImageData], aspect: &str, size: Option<&str>) -> Value {
    let mut parts = vec![json!({ "text": prompt })];
    for image in images {
        parts.push(json!({
            "inlineData": { "mimeType": image.mime, "data": BASE64.encode(&image.bytes) }
        }));
    }
    let mut image_config = json!({ "aspectRatio": aspect });
    if let Some(size) = size {
        image_config["imageSize"] = json!(size);
    }
    json!({
        "contents": [{ "role": "user", "parts": parts }],
        "generationConfig": {
            "responseModalities": ["IMAGE"],
            "imageConfig": image_config
        }
    })
}

/// First image in a `generateContent` response; otherwise the model's text or block reason.
pub fn parse_response(body: &Value) -> Result<ImageData, String> {
    if let Some(error) = body.get("error") {
        let message = error.get("message").and_then(|m| m.as_str()).unwrap_or("unknown error");
        return Err(format!("Gemini error: {message}"));
    }
    let mut said = Vec::new();
    for candidate in body.get("candidates").and_then(|c| c.as_array()).into_iter().flatten() {
        let parts = candidate
            .pointer("/content/parts")
            .and_then(|p| p.as_array())
            .cloned()
            .unwrap_or_default();
        for part in parts {
            let inline = part.get("inlineData").or_else(|| part.get("inline_data"));
            if let Some(inline) = inline {
                let data = inline.get("data").and_then(|d| d.as_str()).unwrap_or_default();
                let mime = inline
                    .get("mimeType")
                    .or_else(|| inline.get("mime_type"))
                    .and_then(|m| m.as_str())
                    .unwrap_or("image/png");
                let bytes = BASE64
                    .decode(data)
                    .map_err(|e| format!("Gemini returned invalid image data: {e}"))?;
                if !bytes.is_empty() {
                    return Ok(ImageData { mime: mime.to_string(), bytes });
                }
            }
            if let Some(text) = part.get("text").and_then(|t| t.as_str()) {
                said.push(text.trim().to_string());
            }
        }
        if let Some(reason) = candidate.get("finishReason").and_then(|r| r.as_str()) {
            if reason != "STOP" {
                said.push(format!("finish reason: {reason}"));
            }
        }
    }
    if let Some(reason) = body.pointer("/promptFeedback/blockReason").and_then(|r| r.as_str()) {
        said.push(format!("prompt blocked: {reason}"));
    }
    let detail = said.into_iter().filter(|s| !s.is_empty()).collect::<Vec<_>>().join(" · ");
    Err(if detail.is_empty() {
        "Gemini returned no image".to_string()
    } else {
        format!("Gemini returned no image ({detail})")
    })
}

fn api_base() -> String {
    std::env::var("LIOSVIDEO_GEMINI_BASE_URL")
        .ok()
        .filter(|b| !b.trim().is_empty())
        .unwrap_or_else(|| API_BASE.to_string())
}

async fn call_model(
    base: &str,
    api_key: &str,
    model: &str,
    prompt: &str,
    images: &[ImageData],
    aspect: &str,
    size: Option<&str>,
) -> Result<ImageData, String> {
    if api_key.trim().is_empty() {
        return Err("No Gemini API key. Set one with `liosvideo key set GEMINI_API_KEY <key>` \
                    or in the desktop Settings (Google AI Studio key)."
            .into());
    }
    let url = format!("{}/models/{model}:generateContent", base.trim_end_matches('/'));
    let client = reqwest::Client::builder()
        .user_agent(format!("liosvideo/{}", env!("CARGO_PKG_VERSION")))
        .timeout(std::time::Duration::from_secs(180))
        .build()
        .unwrap_or_else(|_| reqwest::Client::new());
    let response = client
        .post(&url)
        .header("x-goog-api-key", api_key.trim())
        .json(&request_body(prompt, images, aspect, size))
        .send()
        .await
        .map_err(|e| format!("Gemini request failed: {e}"))?;
    let status = response.status();
    let body: Value = response
        .json()
        .await
        .map_err(|e| format!("Gemini returned HTTP {status} with an unreadable body: {e}"))?;
    if !status.is_success() && body.get("error").is_none() {
        return Err(format!("Gemini returned HTTP {status}"));
    }
    parse_response(&body)
}

fn read_image(root: &Path, rel: &str) -> Result<ImageData, String> {
    let path = inside(root, rel)?;
    let mime = mime_for(&path)?;
    let meta = std::fs::metadata(&path).map_err(|e| format!("{rel}: {e}"))?;
    if meta.len() > MAX_REF_BYTES {
        return Err(format!("{rel}: reference images must be under 15 MB"));
    }
    let bytes = std::fs::read(&path).map_err(|e| format!("{rel}: {e}"))?;
    Ok(ImageData { mime: mime.to_string(), bytes })
}

/// Writes `image` as the next version of `id`, makes it active and records it.
#[allow(clippy::too_many_arguments)]
pub fn store_version(
    root: &Path,
    id: &str,
    image: &ImageData,
    prompt: &str,
    from: Option<u32>,
    model: &str,
    aspect: &str,
    refs: Vec<String>,
) -> Result<ImageEntry, String> {
    let mut manifest = load_manifest(root);
    let index = match manifest.images.iter().position(|e| e.id == id) {
        Some(i) => i,
        None => {
            manifest.images.push(ImageEntry { id: id.to_string(), ..Default::default() });
            manifest.images.len() - 1
        }
    };
    let n = manifest.images[index].versions.iter().map(|v| v.n).max().unwrap_or(0) + 1;
    let ext = ext_for(&image.mime);
    let file = format!("assets/images/generated/{id}/v{n}.{ext}");
    let path = root.join(&file);
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| format!("couldn't create {}: {e}", dir.display()))?;
    }
    std::fs::write(&path, &image.bytes).map_err(|e| format!("couldn't write {}: {e}", path.display()))?;
    let entry = &mut manifest.images[index];
    entry.versions.push(Version {
        n,
        file,
        prompt: prompt.to_string(),
        from,
        model: model.to_string(),
        aspect: aspect.to_string(),
        refs,
        created_at: now(),
    });
    activate(root, entry, n)?;
    let entry = entry.clone();
    save_manifest(root, &manifest)?;
    Ok(entry)
}

/// Copies version `n` to `assets/images/<id>.<ext>` and records the attribution row.
fn activate(root: &Path, entry: &mut ImageEntry, n: u32) -> Result<(), String> {
    let version = entry
        .versions
        .iter()
        .find(|v| v.n == n)
        .cloned()
        .ok_or_else(|| format!("{} has no version {n}", entry.id))?;
    let ext = Path::new(&version.file)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("png")
        .to_string();
    let src = format!("assets/images/{}.{ext}", entry.id);
    // a different extension than before must not leave the old file behind as a stale duplicate
    if !entry.src.is_empty() && entry.src != src {
        let _ = std::fs::remove_file(root.join(&entry.src));
    }
    std::fs::copy(root.join(&version.file), root.join(&src))
        .map_err(|e| format!("couldn't write {src}: {e}"))?;
    entry.src = src;
    entry.active = n;
    let original = original_prompt(entry, n);
    append_attribution(root, &entry.src, &version.model, &original, n)?;
    Ok(())
}

/// The fresh-generation prompt a version descends from, plus the revisions applied since.
fn original_prompt(entry: &ImageEntry, n: u32) -> String {
    let mut chain = Vec::new();
    let mut cursor = entry.versions.iter().find(|v| v.n == n);
    while let Some(version) = cursor {
        chain.push(version.prompt.clone());
        cursor = version.from.and_then(|f| entry.versions.iter().find(|v| v.n == f));
    }
    chain.reverse();
    match chain.split_first() {
        Some((first, rest)) if !rest.is_empty() => format!("{first} — revised: {}", rest.join("; ")),
        Some((first, _)) => first.clone(),
        None => String::new(),
    }
}

/// Makes an earlier version the active one again.
pub fn use_version(root: &Path, id: &str, n: u32) -> Result<ImageEntry, String> {
    let mut manifest = load_manifest(root);
    let entry = manifest
        .images
        .iter_mut()
        .find(|e| e.id == id)
        .ok_or_else(|| format!("no generated image \"{id}\""))?;
    activate(root, entry, n)?;
    let entry = entry.clone();
    save_manifest(root, &manifest)?;
    Ok(entry)
}

/// Generates a new image (or a new version of an existing id) from a prompt.
pub async fn generate(
    root: &Path,
    api_key: &str,
    id: &str,
    prompt: &str,
    opts: GenerateOptions,
) -> Result<ImageEntry, String> {
    generate_at(&api_base(), root, api_key, id, prompt, opts).await
}

async fn generate_at(
    base: &str,
    root: &Path,
    api_key: &str,
    id: &str,
    prompt: &str,
    opts: GenerateOptions,
) -> Result<ImageEntry, String> {
    let id = clean_id(id)?;
    let prompt = prompt.trim();
    if prompt.is_empty() {
        return Err("prompt is required".into());
    }
    let aspect = opts.aspect.unwrap_or_else(|| default_aspect(root));
    if !ASPECTS.contains(&aspect.as_str()) {
        return Err(format!("aspect {aspect} is not supported; use one of {}", ASPECTS.join(", ")));
    }
    if let Some(size) = &opts.size {
        if !SIZES.contains(&size.as_str()) {
            return Err(format!("size {size} is not supported; use one of {}", SIZES.join(", ")));
        }
    }
    let model = opts.model.unwrap_or_else(|| DEFAULT_MODEL.to_string());
    let refs = opts.refs;
    let images = refs
        .iter()
        .map(|r| read_image(root, r))
        .collect::<Result<Vec<_>, _>>()?;
    let image = call_model(base, api_key, &model, prompt, &images, &aspect, opts.size.as_deref()).await?;
    store_version(root, &id, &image, prompt, None, &model, &aspect, refs)
}

/// Revises the active version of `id` with a plain-language instruction.
pub async fn edit(
    root: &Path,
    api_key: &str,
    id: &str,
    instruction: &str,
    size: Option<String>,
) -> Result<ImageEntry, String> {
    edit_at(&api_base(), root, api_key, id, instruction, size).await
}

async fn edit_at(
    api: &str,
    root: &Path,
    api_key: &str,
    id: &str,
    instruction: &str,
    size: Option<String>,
) -> Result<ImageEntry, String> {
    let instruction = instruction.trim();
    if instruction.is_empty() {
        return Err("say what to change, e.g. \"make the sky darker\"".into());
    }
    let entry = find(root, id).ok_or_else(|| format!("no generated image \"{id}\""))?;
    let base = entry
        .versions
        .iter()
        .find(|v| v.n == entry.active)
        .cloned()
        .ok_or_else(|| format!("{id} has no active version"))?;
    let mut images = vec![read_image(root, &base.file)?];
    for r in &base.refs {
        images.push(read_image(root, r)?);
    }
    let prompt = format!(
        "Edit the first image. Keep its composition, subject and style; change only this: {instruction}"
    );
    let image = call_model(api, api_key, &base.model, &prompt, &images, &base.aspect, size.as_deref()).await?;
    store_version(
        root,
        id,
        &image,
        instruction,
        Some(base.n),
        &base.model,
        &base.aspect,
        base.refs.clone(),
    )
}

const ATTRIBUTIONS_HEADER: &str = "# Project Asset Attributions\n\n\
| Asset | Source / URL | Author / Creator | License | Notes / Usage |\n\
| :--- | :--- | :--- | :--- | :--- |\n";

fn cell(text: &str) -> String {
    let one_line = text.split_whitespace().collect::<Vec<_>>().join(" ").replace('|', "/");
    if one_line.chars().count() > 240 {
        format!("{}…", one_line.chars().take(239).collect::<String>())
    } else {
        one_line
    }
}

/// Adds (or replaces) the row for `rel_path` in `assets/ATTRIBUTIONS.md`.
fn append_attribution(root: &Path, rel_path: &str, model: &str, prompt: &str, n: u32) -> Result<(), String> {
    let path = root.join("assets").join("ATTRIBUTIONS.md");
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("couldn't create {}: {e}", parent.display()))?;
    }
    let mut body = std::fs::read_to_string(&path).unwrap_or_default();
    if body.trim().is_empty() {
        body = ATTRIBUTIONS_HEADER.to_string();
    }
    let row = format!(
        "| `{rel_path}` | Generated with Google Gemini (`{model}`) | AI-generated | AI-generated image (Google Gemini terms) | v{n} · Prompt: {} |",
        cell(prompt)
    );
    let prefix = format!("| `{rel_path}` |");
    let mut lines: Vec<&str> = body.lines().filter(|line| !line.starts_with(&prefix)).collect();
    while lines.last().is_some_and(|line| line.trim().is_empty()) {
        lines.pop();
    }
    lines.push(&row);
    let mut next = lines.join("\n");
    next.push('\n');
    std::fs::write(&path, next).map_err(|e| format!("couldn't write {}: {e}", path.display()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn png(tag: u8) -> ImageData {
        ImageData { mime: "image/png".into(), bytes: vec![0x89, b'P', b'N', b'G', tag] }
    }

    #[test]
    fn cleans_ids() {
        assert_eq!(clean_id("Palace Night").unwrap(), "palace-night");
        assert_eq!(clean_id("../etc/passwd").unwrap(), "etcpasswd");
        assert_eq!(clean_id("hero_v2.png").unwrap(), "hero_v2-png");
        assert!(clean_id("  ").is_err());
    }

    #[test]
    fn defaults_to_the_projects_orientation() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(default_aspect(dir.path()), "16:9");
        std::fs::write(dir.path().join("short.ts"), "").unwrap();
        assert_eq!(default_aspect(dir.path()), "9:16");
        std::fs::write(dir.path().join("long.ts"), "").unwrap();
        assert_eq!(default_aspect(dir.path()), "16:9");
    }

    #[test]
    fn builds_an_image_request_with_references_after_the_prompt() {
        let body = request_body("a palace at night", &[png(1)], "9:16", Some("2K"));
        let parts = body.pointer("/contents/0/parts").unwrap().as_array().unwrap();
        assert_eq!(parts[0]["text"], "a palace at night");
        assert_eq!(parts[1]["inlineData"]["mimeType"], "image/png");
        assert_eq!(parts[1]["inlineData"]["data"], BASE64.encode(png(1).bytes));
        assert_eq!(body["generationConfig"]["responseModalities"], json!(["IMAGE"]));
        assert_eq!(body["generationConfig"]["imageConfig"], json!({ "aspectRatio": "9:16", "imageSize": "2K" }));
    }

    #[test]
    fn reads_the_image_out_of_a_response() {
        let body = json!({ "candidates": [{ "content": { "parts": [
            { "text": "Here you go" },
            { "inlineData": { "mimeType": "image/jpeg", "data": BASE64.encode([1, 2, 3]) } }
        ] } }] });
        let image = parse_response(&body).unwrap();
        assert_eq!(image.mime, "image/jpeg");
        assert_eq!(image.bytes, vec![1, 2, 3]);
    }

    #[test]
    fn explains_why_no_image_came_back() {
        let refused = json!({ "candidates": [{
            "content": { "parts": [{ "text": "I can't make that." }] },
            "finishReason": "IMAGE_SAFETY"
        }] });
        let err = parse_response(&refused).unwrap_err();
        assert!(err.contains("I can't make that.") && err.contains("IMAGE_SAFETY"), "{err}");
        let blocked = json!({ "promptFeedback": { "blockReason": "SAFETY" } });
        assert!(parse_response(&blocked).unwrap_err().contains("prompt blocked: SAFETY"));
        let api = json!({ "error": { "code": 400, "message": "API key not valid" } });
        assert_eq!(parse_response(&api).unwrap_err(), "Gemini error: API key not valid");
    }

    #[test]
    fn keeps_every_version_and_points_the_asset_at_the_active_one() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        let first = store_version(root, "hero", &png(1), "a red car", None, DEFAULT_MODEL, "16:9", vec![]).unwrap();
        assert_eq!(first.src, "assets/images/hero.png");
        assert_eq!(first.active, 1);
        let second = store_version(root, "hero", &png(2), "make it blue", Some(1), DEFAULT_MODEL, "16:9", vec![]).unwrap();
        assert_eq!(second.active, 2);
        assert_eq!(std::fs::read(root.join("assets/images/hero.png")).unwrap(), png(2).bytes);
        assert_eq!(std::fs::read(root.join("assets/images/generated/hero/v1.png")).unwrap(), png(1).bytes);

        let back = use_version(root, "hero", 1).unwrap();
        assert_eq!(back.active, 1);
        assert_eq!(std::fs::read(root.join("assets/images/hero.png")).unwrap(), png(1).bytes);
        assert_eq!(find(root, "hero").unwrap().versions.len(), 2);
        assert!(use_version(root, "hero", 9).is_err());
    }

    #[test]
    fn records_one_attribution_row_with_the_revision_chain() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        store_version(root, "hero", &png(1), "a red | car", None, DEFAULT_MODEL, "16:9", vec![]).unwrap();
        store_version(root, "hero", &png(2), "make it blue", Some(1), DEFAULT_MODEL, "16:9", vec![]).unwrap();
        let md = std::fs::read_to_string(root.join("assets/ATTRIBUTIONS.md")).unwrap();
        let rows: Vec<&str> = md.lines().filter(|l| l.starts_with("| `assets/images/hero.png`")).collect();
        assert_eq!(rows.len(), 1, "{md}");
        assert!(rows[0].contains("v2 · Prompt: a red / car — revised: make it blue"), "{}", rows[0]);
        assert!(rows[0].contains("AI-generated"));
    }

    #[test]
    fn refuses_reference_images_outside_the_project() {
        let dir = tempfile::tempdir().unwrap();
        assert!(read_image(dir.path(), "../secret.png").unwrap_err().contains("inside the project"));
        assert!(read_image(dir.path(), "/etc/hosts.png").unwrap_err().contains("inside the project"));
        std::fs::write(dir.path().join("notes.txt"), "x").unwrap();
        assert!(read_image(dir.path(), "notes.txt").unwrap_err().contains("PNG, JPEG or WebP"));
    }

    #[tokio::test]
    async fn generates_and_revises_through_the_api() {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let mut requests = Vec::new();
            for tag in [7u8, 8u8] {
                let (mut socket, _) = listener.accept().await.unwrap();
                let mut buf = Vec::new();
                let mut chunk = [0u8; 65536];
                loop {
                    let n = socket.read(&mut chunk).await.unwrap();
                    buf.extend_from_slice(&chunk[..n]);
                    let text = String::from_utf8_lossy(&buf).to_string();
                    if let Some(head_end) = text.find("\r\n\r\n") {
                        let len = text[..head_end]
                            .lines()
                            .find_map(|l| l.to_ascii_lowercase().strip_prefix("content-length:").map(|v| v.trim().parse::<usize>().unwrap()))
                            .unwrap_or(0);
                        if buf.len() >= head_end + 4 + len {
                            break;
                        }
                    }
                }
                requests.push(String::from_utf8_lossy(&buf).to_string());
                let reply = json!({ "candidates": [{ "content": { "parts": [
                    { "inlineData": { "mimeType": "image/png", "data": BASE64.encode([tag]) } }
                ] } }] })
                .to_string();
                let response = format!(
                    "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{reply}",
                    reply.len()
                );
                socket.write_all(response.as_bytes()).await.unwrap();
            }
            requests
        });

        let api = format!("http://{addr}");
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        std::fs::write(root.join("short.ts"), "").unwrap();
        let made = generate_at(&api, root, "k", "Palace Night", "a palace at night", GenerateOptions::default())
            .await
            .unwrap();
        assert_eq!(made.id, "palace-night");
        assert_eq!(made.versions[0].aspect, "9:16");
        let revised = edit_at(&api, root, "k", "palace-night", "darker sky", None).await.unwrap();

        assert_eq!(revised.active, 2);
        assert_eq!(revised.versions[1].from, Some(1));
        assert_eq!(std::fs::read(root.join("assets/images/palace-night.png")).unwrap(), vec![8]);
        let requests = server.await.unwrap();
        assert!(requests[0].starts_with(&format!("POST /models/{DEFAULT_MODEL}:generateContent")));
        assert!(requests[0].to_ascii_lowercase().contains("x-goog-api-key: k"));
        // the revision sends the active version (byte 7) back as the base image
        assert!(requests[1].contains("change only this: darker sky"));
        assert!(requests[1].contains(&BASE64.encode([7u8])));
    }

    #[tokio::test]
    async fn needs_an_api_key() {
        let dir = tempfile::tempdir().unwrap();
        let err = generate(dir.path(), "", "x", "a cat", GenerateOptions::default()).await.unwrap_err();
        assert!(err.contains("GEMINI_API_KEY"), "{err}");
    }
}
