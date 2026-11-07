//! Tauri commands behind the Images tab: generate, revise and pick versions of AI images.

use tauri::State;

use crate::imagegen::{self, GenerateOptions, ImageEntry};
use crate::keychain::Keychain;
use crate::project::ProjectState;

fn root(state: &ProjectState) -> Result<std::path::PathBuf, String> {
    state.root().map_err(|e| e.to_string())
}

fn api_key() -> String {
    imagegen::KEY_NAMES
        .iter()
        .find_map(|name| Keychain::get_secret(name))
        .unwrap_or_default()
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageStudio {
    images: Vec<ImageEntry>,
    default_aspect: String,
    aspects: Vec<&'static str>,
    has_key: bool,
}

#[tauri::command]
pub fn image_list(state: State<'_, ProjectState>) -> Result<ImageStudio, String> {
    let root = root(&state)?;
    let mut images = imagegen::load_manifest(&root).images;
    // newest first: the image you just made is the one you want to look at
    images.sort_by_key(|e| std::cmp::Reverse(e.versions.iter().map(|v| v.created_at).max().unwrap_or(0)));
    Ok(ImageStudio {
        images,
        default_aspect: imagegen::default_aspect(&root),
        aspects: imagegen::ASPECTS.to_vec(),
        has_key: !api_key().trim().is_empty(),
    })
}

#[tauri::command]
pub async fn image_generate(
    state: State<'_, ProjectState>,
    prompt: String,
    id: String,
    aspect: Option<String>,
    refs: Option<Vec<String>>,
) -> Result<ImageEntry, String> {
    let root = root(&state)?;
    let opts = GenerateOptions { aspect, size: None, model: None, refs: refs.unwrap_or_default() };
    imagegen::generate(&root, &api_key(), &id, &prompt, opts).await
}

#[tauri::command]
pub async fn image_edit(
    state: State<'_, ProjectState>,
    id: String,
    instruction: String,
) -> Result<ImageEntry, String> {
    let root = root(&state)?;
    imagegen::edit(&root, &api_key(), &id, &instruction, None).await
}

#[tauri::command]
pub fn image_use_version(
    state: State<'_, ProjectState>,
    id: String,
    version: u32,
) -> Result<ImageEntry, String> {
    imagegen::use_version(&root(&state)?, &id, version)
}
