// deno_core ops exposed to the embedded liosvideo runtime.
//
// The desktop worker registers `measureText` (Canvas2D) with
// `setTextMeasurer`. The CLI registers a synchronous op backed by the Rust
// cosmic-text engine instead.

use std::collections::HashMap;

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
    ops = [op_measure_text, op_three_frame],
    state = |state| {
        state.put(TextEngine::new());
        state.put(ThreeFrames::default());
    },
    docs = "Text measurement + rasterisation for the liosvideo CLI runtime."
);
