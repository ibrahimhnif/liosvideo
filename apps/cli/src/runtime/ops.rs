// deno_core ops exposed to the embedded liosvideo runtime.
//
// The desktop worker registers `measureText` (Canvas2D) with
// `setTextMeasurer`. The CLI registers a synchronous op backed by the Rust
// cosmic-text engine instead.

use std::collections::HashMap;
use std::path::PathBuf;

use deno_core::{op2, OpState};

use crate::text::{TextEngine, TextProps};

/// RGBA frames produced by the three.js software rasteriser, keyed by node path.
#[derive(Default)]
pub struct ThreeFrames(pub HashMap<String, (u32, u32, Vec<u8>)>);

#[op2(fast)]
pub fn op_three_frame(
    state: &mut OpState,
    #[string] path: String,
    width: u32,
    height: u32,
    #[buffer] pixels: &[u8],
) {
    let store = state.borrow_mut::<ThreeFrames>();
    store.0.insert(path, (width, height, pixels.to_vec()));
}

/// The project directory; `op_read_asset` never reads outside it.
pub struct ProjectRoot(pub PathBuf);

/// Bytes of a project file, for gltf() / hdr() / texture() in three() setup.
#[op2]
#[buffer]
pub fn op_read_asset(
    state: &mut OpState,
    #[string] src: String,
) -> Result<Vec<u8>, deno_error::JsErrorBox> {
    let root = state.borrow::<ProjectRoot>().0.clone();
    read_asset(&root, &src).map_err(deno_error::JsErrorBox::generic)
}

pub fn read_asset(root: &std::path::Path, src: &str) -> Result<Vec<u8>, String> {
    let root = root
        .canonicalize()
        .map_err(|e| format!("project root: {e}"))?;
    let path = root
        .join(src.trim_start_matches("./"))
        .canonicalize()
        .map_err(|_| format!("asset not found: {src}"))?;
    if !path.starts_with(&root) {
        return Err(format!("asset outside the project: {src}"));
    }
    std::fs::read(&path).map_err(|e| format!("cannot read {src}: {e}"))
}

/// PNG / JPEG / WebP bytes to `[width u32 LE, height u32 LE, RGBA8 rows top-first...]`.
#[op2]
#[buffer]
pub fn op_decode_image(#[buffer] bytes: &[u8]) -> Result<Vec<u8>, deno_error::JsErrorBox> {
    decode_image(bytes).map_err(deno_error::JsErrorBox::generic)
}

pub fn decode_image(bytes: &[u8]) -> Result<Vec<u8>, String> {
    let img = image::load_from_memory(bytes)
        .map_err(|e| format!("cannot decode image: {e}"))?
        .to_rgba8();
    let (w, h) = img.dimensions();
    let mut out = Vec::with_capacity(8 + (w * h * 4) as usize);
    out.extend_from_slice(&w.to_le_bytes());
    out.extend_from_slice(&h.to_le_bytes());
    out.extend_from_slice(img.as_raw());
    Ok(out)
}

#[op2]
#[string]
pub fn op_measure_text(
    state: &mut OpState,
    #[string] props_json: String,
) -> Result<String, deno_error::JsErrorBox> {
    let props: TextProps = serde_json::from_str(&props_json)
        .map_err(|e| deno_error::JsErrorBox::generic(format!("Invalid text props: {e}")))?;

    let engine = state.borrow_mut::<TextEngine>();
    let (width, height) = engine.measure(&props);

    Ok(serde_json::json!({ "width": width, "height": height }).to_string())
}

deno_core::extension!(
    liosvideo_text,
    ops = [
        op_measure_text,
        op_three_frame,
        op_read_asset,
        op_decode_image
    ],
    state = |state| {
        state.put(TextEngine::new());
        state.put(ThreeFrames::default());
    },
    docs = "Text measurement + rasterisation for the liosvideo CLI runtime."
);
