// Rust port of packages/runtime/src/gpu/text.ts.
//
// Desktop measures/rasterises text with Canvas2D. The CLI has no browser, so this
// module uses cosmic-text (system fonts + harfrust shaping + swash rasterisation)
// and reproduces the Canvas2D layout rules used by the runtime:
//   * hard `\n` line breaks only (no width-based wrapping)
//   * line height = fontSize * lineHeight
//   * each line box is vertically centred on the font box
//   * lines aligned left/center/right inside max(boxWidth, widest line);
//     word wrapping happens in the runtime, which inserts the `\n`s
//   * colour baked into the raster
//
// Text metrics are close to, but not bit-identical with, Canvas2D.

use std::collections::{HashMap, VecDeque};
use std::sync::Arc;

use cosmic_text::{Attrs, Buffer, Family, FontSystem, Metrics, Shaping, SwashCache, Weight};
use serde::{Deserialize, Serialize};

use crate::color::parse_color;

const DEFAULT_FAMILY: &str = "SF Pro Text";
const DEFAULT_FONT_SIZE: f32 = 48.0;
const DEFAULT_FONT_WEIGHT: u16 = 400;
const DEFAULT_LINE_HEIGHT: f32 = 1.2;
const CACHE_LIMIT: usize = 512;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TextProps {
    #[serde(default)]
    pub text: String,
    #[serde(default = "default_family", rename = "fontFamily")]
    pub font_family: String,
    #[serde(default = "default_font_size", rename = "fontSize")]
    pub font_size: f32,
    #[serde(default = "default_font_weight", rename = "fontWeight")]
    pub font_weight: u16,
    #[serde(default = "default_line_height", rename = "lineHeight")]
    pub line_height: f32,
    /// "left" | "center" | "right"
    #[serde(default = "default_align")]
    pub align: String,
    /// Layout box width in units; lines align within max(this, widest line).
    #[serde(default, rename = "boxWidth")]
    pub box_width: f32,
}

impl Default for TextProps {
    fn default() -> Self {
        Self {
            text: String::new(),
            font_family: default_family(),
            font_size: DEFAULT_FONT_SIZE,
            font_weight: DEFAULT_FONT_WEIGHT,
            line_height: DEFAULT_LINE_HEIGHT,
            align: default_align(),
            box_width: 0.0,
        }
    }
}

fn default_align() -> String {
    "left".to_string()
}

fn default_family() -> String {
    DEFAULT_FAMILY.to_string()
}

const fn default_font_size() -> f32 {
    DEFAULT_FONT_SIZE
}

const fn default_font_weight() -> u16 {
    DEFAULT_FONT_WEIGHT
}

const fn default_line_height() -> f32 {
    DEFAULT_LINE_HEIGHT
}

#[derive(Debug, Clone)]
pub struct RasterImage {
    pub width: u32,
    pub height: u32,
    /// Premultiplied RGBA, ready for texture upload (matches `copyExternalImageToTexture`
    /// with `premultipliedAlpha: true` on the desktop).
    pub data: Vec<u8>,
}

#[derive(Debug, Clone)]
pub struct RasterResult {
    pub key: String,
    pub image: Arc<RasterImage>,
    /// Width in layout units (canvas pixels / scale).
    pub width: f32,
    /// Height in layout units (canvas pixels / scale).
    pub height: f32,
}

pub struct TextEngine {
    font_system: FontSystem,
    swash: SwashCache,
    cache: HashMap<String, Arc<RasterImage>>,
    order: VecDeque<String>,
}

impl Default for TextEngine {
    fn default() -> Self {
        Self::new()
    }
}

impl TextEngine {
    pub fn new() -> Self {
        Self {
            font_system: FontSystem::new(),
            swash: SwashCache::new(),
            cache: HashMap::new(),
            order: VecDeque::new(),
        }
    }

    fn attrs<'a>(props: &'a TextProps) -> Attrs<'a> {
        Attrs::new()
            .family(Family::Name(&props.font_family))
            .weight(Weight(props.font_weight))
    }

    fn layout_buffer(&mut self, props: &TextProps, scale: f32) -> Buffer {
        let font_size = (props.font_size * scale).max(0.01);
        let line_height = (props.font_size * props.line_height * scale).max(0.01);
        let mut buffer = Buffer::new(&mut self.font_system, Metrics::new(font_size, line_height));
        buffer.set_size(None, None);
        buffer.set_text(&props.text, &Self::attrs(props), Shaping::Advanced, None);
        buffer.shape_until_scroll(&mut self.font_system, false);
        buffer
    }

    /// Measure text in layout units (scale = 1), matching `measureText` in the runtime.
    pub fn measure(&mut self, props: &TextProps) -> (f32, f32) {
        let line_height = props.font_size * props.line_height;
        let buffer = self.layout_buffer(props, 1.0);

        let width = buffer
            .layout_runs()
            .map(|run| run.line_w)
            .fold(0.0f32, f32::max);
        let line_count = props.text.split('\n').count().max(1) as f32;

        (width, line_height * line_count)
    }

    pub fn raster(&mut self, props: &TextProps, color: &str, scale: f32) -> RasterResult {
        let key = format!(
            "{}|{}|{}|{}|{}|{}|{}|{}|{}",
            props.text,
            props.font_family,
            props.font_size,
            props.font_weight,
            color,
            props.line_height,
            props.align,
            props.box_width,
            scale
        );

        if let Some(image) = self.cache.get(&key) {
            let width = image.width as f32 / scale;
            let height = image.height as f32 / scale;
            return RasterResult {
                key,
                image: Arc::clone(image),
                width,
                height,
            };
        }

        let (layout_w, layout_h) = self.measure(props);
        let color_rgba = parse_color(color).unwrap_or([1.0, 1.0, 1.0, 1.0]);

        let canvas_w = (layout_w.max(props.box_width) * scale).ceil().max(1.0) as u32;
        let k = match props.align.as_str() {
            "center" => 0.5,
            "right" => 1.0,
            _ => 0.0,
        };
        let canvas_h = (layout_h * scale).ceil().max(1.0) as u32;

        let mut canvas = vec![0u8; canvas_w as usize * canvas_h as usize * 4];
        let buffer = self.layout_buffer(props, scale);

        for run in buffer.layout_runs() {
            let offset_x = ((canvas_w as f32 - run.line_w) * k).max(0.0);
            for glyph in run.glyphs {
                let physical = glyph.physical((offset_x, run.line_y), 1.0);
                let TextEngine {
                    font_system, swash, ..
                } = self;
                let image_ref = swash.get_image(font_system, physical.cache_key);
                let Some(image) = image_ref.as_ref() else {
                    continue;
                };

                let ox = physical.x + image.placement.left;
                let oy = physical.y - image.placement.top;
                let gw = image.placement.width as i32;
                let gh = image.placement.height as i32;
                let data = image.data.as_slice();

                match image.content {
                    cosmic_text::SwashContent::Mask => {
                        for row in 0..gh {
                            for col in 0..gw {
                                let idx = (row * gw + col) as usize;
                                let Some(&coverage) = data.get(idx) else {
                                    continue;
                                };
                                let alpha = (coverage as f32 / 255.0) * color_rgba[3];
                                blend_pixel(
                                    &mut canvas,
                                    canvas_w,
                                    canvas_h,
                                    ox + col,
                                    oy + row,
                                    [color_rgba[0], color_rgba[1], color_rgba[2]],
                                    alpha,
                                );
                            }
                        }
                    }
                    cosmic_text::SwashContent::SubpixelMask => {
                        for row in 0..gh {
                            for col in 0..gw {
                                let idx = (row * gw + col) as usize * 3;
                                let r = data.get(idx).copied().unwrap_or(0) as f32 / 255.0;
                                let g = data.get(idx + 1).copied().unwrap_or(0) as f32 / 255.0;
                                let b = data.get(idx + 2).copied().unwrap_or(0) as f32 / 255.0;
                                let alpha = ((r + g + b) / 3.0) * color_rgba[3];
                                blend_pixel(
                                    &mut canvas,
                                    canvas_w,
                                    canvas_h,
                                    ox + col,
                                    oy + row,
                                    [color_rgba[0] * r, color_rgba[1] * g, color_rgba[2] * b],
                                    alpha,
                                );
                            }
                        }
                    }
                    cosmic_text::SwashContent::Color => {
                        for row in 0..gh {
                            for col in 0..gw {
                                let idx = (row * gw + col) as usize * 4;
                                let r = data.get(idx).copied().unwrap_or(0) as f32 / 255.0;
                                let g = data.get(idx + 1).copied().unwrap_or(0) as f32 / 255.0;
                                let b = data.get(idx + 2).copied().unwrap_or(0) as f32 / 255.0;
                                let a = data.get(idx + 3).copied().unwrap_or(0) as f32 / 255.0;
                                blend_pixel(
                                    &mut canvas,
                                    canvas_w,
                                    canvas_h,
                                    ox + col,
                                    oy + row,
                                    [r, g, b],
                                    a,
                                );
                            }
                        }
                    }
                }
            }
        }

        premultiply(&mut canvas);
        let image = Arc::new(RasterImage {
            width: canvas_w,
            height: canvas_h,
            data: canvas,
        });

        self.cache.insert(key.clone(), Arc::clone(&image));
        self.order.push_back(key.clone());
        while self.order.len() > CACHE_LIMIT {
            if let Some(old) = self.order.pop_front() {
                self.cache.remove(&old);
            }
        }

        RasterResult {
            key,
            image,
            width: canvas_w as f32 / scale,
            height: canvas_h as f32 / scale,
        }
    }
}

fn blend_pixel(
    canvas: &mut [u8],
    width: u32,
    height: u32,
    x: i32,
    y: i32,
    rgb: [f32; 3],
    alpha: f32,
) {
    if x < 0 || y < 0 || x >= width as i32 || y >= height as i32 {
        return;
    }
    let a = alpha.clamp(0.0, 1.0);
    if a <= 0.0 {
        return;
    }
    let idx = ((y as u32 * width + x as u32) * 4) as usize;
    let dst_a = canvas[idx + 3] as f32 / 255.0;
    let out_a = a + dst_a * (1.0 - a);
    if out_a <= 0.0 {
        return;
    }
    for c in 0..3 {
        let dst = canvas[idx + c] as f32 / 255.0;
        let out = (rgb[c] * a + dst * dst_a * (1.0 - a)) / out_a;
        canvas[idx + c] = (out.clamp(0.0, 1.0) * 255.0).round() as u8;
    }
    canvas[idx + 3] = (out_a.clamp(0.0, 1.0) * 255.0).round() as u8;
}

fn premultiply(canvas: &mut [u8]) {
    for pixel in canvas.chunks_exact_mut(4) {
        let a = pixel[3] as u32;
        for channel in &mut pixel[..3] {
            *channel = ((*channel as u32 * a) / 255) as u8;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn measures_and_rasterizes_text() {
        let mut engine = TextEngine::new();
        let props = TextProps {
            text: "Hello\nWorld".into(),
            font_size: 32.0,
            line_height: 1.2,
            ..Default::default()
        };
        let (w, h) = engine.measure(&props);
        assert!(w > 0.0, "width should be positive, got {w}");
        assert!((h - 32.0 * 1.2 * 2.0).abs() < 0.01, "height {h}");

        let raster = engine.raster(&props, "#ffffff", 1.0);
        assert!(raster.image.width > 0 && raster.image.height > 0);
        assert_eq!(
            raster.width, raster.image.width as f32,
            "scale 1 raster width matches"
        );
        assert!(
            raster.image.data.iter().any(|&b| b > 0),
            "raster is not blank"
        );
    }

    fn lit_center_x(image: &RasterImage) -> f32 {
        let (mut min, mut max) = (u32::MAX, 0u32);
        for y in 0..image.height {
            for x in 0..image.width {
                if image.data[((y * image.width + x) * 4 + 3) as usize] > 128 {
                    min = min.min(x);
                    max = max.max(x);
                }
            }
        }
        (min + max) as f32 / 2.0
    }

    #[test]
    fn aligns_lines_inside_the_box() {
        let mut engine = TextEngine::new();
        let mut props = TextProps {
            text: "I".into(),
            box_width: 240.0,
            ..Default::default()
        };
        let left = engine.raster(&props, "#ffffff", 1.0);
        assert_eq!(left.image.width, 240, "raster spans the box");
        assert!(lit_center_x(&left.image) < 40.0);
        props.align = "center".into();
        let center = engine.raster(&props, "#ffffff", 1.0);
        assert!((lit_center_x(&center.image) - 120.0).abs() < 12.0);
        props.align = "right".into();
        let right = engine.raster(&props, "#ffffff", 1.0);
        assert!(lit_center_x(&right.image) > 200.0);
    }

    #[test]
    fn measure_is_cached_consistently() {
        let mut engine = TextEngine::new();
        let props = TextProps {
            text: "Deterministic".into(),
            ..Default::default()
        };
        let a = engine.measure(&props);
        let b = engine.measure(&props);
        assert_eq!(a, b);
    }
}
