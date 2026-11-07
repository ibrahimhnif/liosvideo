//! WebGPU for the embedded runtime: deno_webgpu over wgpu, so three.js `WebGPURenderer` can
//! render `three()` nodes on the GPU (see `three_gpu.js`). deno_webgpu needs `deno_webidl` and a
//! few parts of `deno_web`; the CLI ships a small stand-in for the latter (`webgpu/*.js`) instead
//! of the whole web platform. WebGPU itself is only initialised when a three node is rendered.

deno_core::extension!(
    deno_web,
    deps = [deno_webidl, deno_console],
    esm = [dir "src/runtime/webgpu", "01_dom_exception.js", "02_event.js"],
);

deno_core::extension!(
    liosvideo_webgpu,
    deps = [deno_webgpu],
    esm_entry_point = "ext:liosvideo_webgpu/boot.js",
    esm = [dir "src/runtime/webgpu", "boot.js"],
);

/// Extensions to add to the runtime, in dependency order.
pub fn extensions() -> Vec<deno_core::Extension> {
    vec![
        deno_webidl::deno_webidl::init_ops_and_esm(),
        deno_console::deno_console::init_ops_and_esm(),
        deno_web::init_ops_and_esm(),
        deno_webgpu::deno_webgpu::init_ops_and_esm(),
        liosvideo_webgpu::init_ops_and_esm(),
    ]
}
