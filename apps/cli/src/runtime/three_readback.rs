// Readback of a three() frame rendered by three.js WebGPURenderer (three_gpu.js).
//
// deno_webgpu's GPUBuffer.mapAsync waits at least 10 ms per call (it sleeps between device
// polls), which made every 3D frame cost ~15 ms however simple the scene. This op maps the
// buffer itself with a blocking poll, and turns the rows into the straight-alpha RGBA the
// compositor takes in Rust instead of a JavaScript loop.

use deno_core::op2;
use deno_error::JsErrorBox;
use deno_webgpu::buffer::GPUBuffer;
use deno_webgpu::wgpu_core::device::HostMap;
use deno_webgpu::wgpu_core::resource::BufferMapOperation;
use deno_webgpu::wgpu_types::Maintain;

/// Straight-alpha RGBA rows from a padded, premultiplied (RGBA or BGRA) readback.
/// With a background colour, partly transparent pixels are composited over it and come out opaque.
/// Rounds exactly like the JavaScript readback it replaces.
pub fn unpack_frame(
    src: &[u8],
    width: usize,
    height: usize,
    bytes_per_row: usize,
    bgra: bool,
    background: Option<[u8; 3]>,
) -> Vec<u8> {
    let mut out = vec![0u8; width * height * 4];
    let (ri, bi) = if bgra { (2, 0) } else { (0, 2) };
    for y in 0..height {
        let row = &src[y * bytes_per_row..y * bytes_per_row + width * 4];
        let dst = &mut out[y * width * 4..(y + 1) * width * 4];
        for (s, d) in row.chunks_exact(4).zip(dst.chunks_exact_mut(4)) {
            let a = s[3];
            let mut rgb = [s[ri], s[1], s[bi]];
            if a > 0 && a < 255 {
                for c in &mut rgb {
                    *c = ((*c as f64 * 255.0) / a as f64).round().min(255.0) as u8;
                }
            }
            if let Some(bg) = background {
                if a < 255 {
                    for (c, b) in rgb.iter_mut().zip(bg) {
                        *c = ((*c as f64 * a as f64 + b as f64 * (255 - a) as f64) / 255.0).round() as u8;
                    }
                }
            }
            d[..3].copy_from_slice(&rgb);
            d[3] = if background.is_some() { 255 } else { a };
        }
    }
    out
}

/// Maps `buffer` (filled by copyTextureToBuffer and submitted), unpacks it and unmaps it.
/// `background` is 0xRRGGBB, or negative for none.
#[op2]
#[buffer]
pub fn op_three_readback(
    #[cppgc] buffer: &GPUBuffer,
    width: u32,
    height: u32,
    bytes_per_row: u32,
    bgra: bool,
    background: i32,
) -> Result<Vec<u8>, JsErrorBox> {
    let size = bytes_per_row as u64 * height as u64;
    let err = |what: &str, e: &dyn std::fmt::Display| JsErrorBox::generic(format!("three readback: {what}: {e}"));
    let (tx, rx) = std::sync::mpsc::channel();
    buffer
        .instance
        .buffer_map_async(
            buffer.id,
            0,
            Some(size),
            BufferMapOperation {
                host: HostMap::Read,
                callback: Some(Box::new(move |status| {
                    let _ = tx.send(status);
                })),
            },
        )
        .map_err(|e| err("map", &e))?;
    buffer
        .instance
        .device_poll(buffer.device, Maintain::wait())
        .map_err(|e| err("poll", &e))?;
    rx.recv()
        .map_err(|e| err("map callback", &e))?
        .map_err(|e| err("map", &e))?;
    let (ptr, len) = buffer
        .instance
        .buffer_get_mapped_range(buffer.id, 0, Some(size))
        .map_err(|e| err("mapped range", &e))?;
    // SAFETY: wgpu keeps the mapped range alive and unaliased until buffer_unmap below
    let src = unsafe { std::slice::from_raw_parts(ptr.as_ptr(), len as usize) };
    let bg = (background >= 0).then(|| [(background >> 16) as u8, (background >> 8) as u8, background as u8]);
    let out = unpack_frame(src, width as usize, height as usize, bytes_per_row as usize, bgra, bg);
    buffer.instance.buffer_unmap(buffer.id).map_err(|e| err("unmap", &e))?;
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::unpack_frame;

    #[test]
    fn drops_row_padding_and_swaps_bgra() {
        // 1×2 image, rows padded to 8 bytes
        let src = [10, 20, 30, 255, 9, 9, 9, 9, 40, 50, 60, 255, 9, 9, 9, 9];
        assert_eq!(unpack_frame(&src, 1, 2, 8, false, None), vec![10, 20, 30, 255, 40, 50, 60, 255]);
        assert_eq!(unpack_frame(&src, 1, 2, 8, true, None), vec![30, 20, 10, 255, 60, 50, 40, 255]);
    }

    #[test]
    fn unpremultiplies_like_the_javascript_readback() {
        // JS: Math.min(255, Math.round((c * 255) / a))
        let src = [50, 100, 128, 128, 0, 0, 0, 0, 3, 1, 2, 2];
        let out = unpack_frame(&src, 3, 1, 12, false, None);
        assert_eq!(&out[0..4], &[100, 199, 255, 128]);
        assert_eq!(&out[4..8], &[0, 0, 0, 0]);
        assert_eq!(&out[8..12], &[255, 128, 255, 2]);
    }

    #[test]
    fn composites_over_the_background_colour() {
        // JS: Math.round((c * a + bg * (255 - a)) / 255) after unpremultiplying; alpha becomes 255
        let src = [50, 100, 128, 128, 0, 0, 0, 0, 7, 8, 9, 255];
        let out = unpack_frame(&src, 3, 1, 12, false, Some([255, 0, 10]));
        assert_eq!(&out[0..4], &[177, 100, 133, 255]);
        assert_eq!(&out[4..8], &[255, 0, 10, 255]);
        assert_eq!(&out[8..12], &[7, 8, 9, 255]);
    }
}
