// Rust port of packages/runtime/src/gpu/renderer.ts.
//
// The CLI uses the exact same WGSL (copied into `gpu/shaders`) and the exact same
// 24-float instance layout, so offscreen renders match the desktop preview:
//   * one instanced quad pass for rect/circle/text/image/video/path/shader/three
//   * recursive layer targets with opacity, blur and rounded-rect clip
//   * rgba8unorm everywhere, premultiplied alpha, no sRGB linearisation

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;

use anyhow::Result;
use serde_json::Value;
use wgpu::util::DeviceExt;

use super::RenderTarget;
use crate::assets::{AssetStore, ImageAsset};
use crate::color::parse_color;
use crate::text::{RasterImage, TextEngine, TextProps};

mod shader;
use shader::ShaderRenderer;

const LAYER_FORMAT: wgpu::TextureFormat = wgpu::TextureFormat::Rgba8Unorm;
const INST_FLOATS: usize = 24;
const MAX_BLUR_RADIUS: f32 = 64.0;
const MODE_RECT: f32 = 0.0;
const MODE_TEXTURE: f32 = 1.0;
const MODE_SOLID: f32 = 2.0;

pub const INSTANCE_FLOATS: usize = INST_FLOATS;

const COMMON_WGSL: &str = include_str!("../shaders/common.wgsl");
const QUAD_WGSL: &str = include_str!("../shaders/quad.wgsl");
const BLUR_WGSL: &str = include_str!("../shaders/blur.wgsl");
const COMPOSITE_WGSL: &str = include_str!("../shaders/composite.wgsl");
const FILTER_WGSL: &str = include_str!("../shaders/filter.wgsl");

type Affine = [f32; 6];

fn identity() -> Affine {
    [1.0, 0.0, 0.0, 1.0, 0.0, 0.0]
}

fn multiply(m: Affine, n: Affine) -> Affine {
    [
        m[0] * n[0] + m[2] * n[1],
        m[1] * n[0] + m[3] * n[1],
        m[0] * n[2] + m[2] * n[3],
        m[1] * n[2] + m[3] * n[3],
        m[0] * n[4] + m[2] * n[5] + m[4],
        m[1] * n[4] + m[3] * n[5] + m[5],
    ]
}

fn invert(m: Affine) -> Affine {
    let [a, b, c, d, e, f] = m;
    let det = if a * d - b * c == 0.0 {
        1e-12
    } else {
        a * d - b * c
    };
    [
        d / det,
        -b / det,
        -c / det,
        a / det,
        (c * f - d * e) / det,
        (b * e - a * f) / det,
    ]
}

fn matrix_from(value: &Value) -> Affine {
    let mut out = identity();
    if let Some(arr) = value.as_array() {
        for (i, v) in arr.iter().take(6).enumerate() {
            out[i] = v.as_f64().unwrap_or(0.0) as f32;
        }
    }
    out
}

fn f32_of(value: &Value, key: &str, default: f32) -> f32 {
    value
        .get(key)
        .and_then(|v| v.as_f64())
        .map(|v| v as f32)
        .unwrap_or(default)
}

fn str_of<'a>(value: &'a Value, key: &str, default: &'a str) -> &'a str {
    value.get(key).and_then(|v| v.as_str()).unwrap_or(default)
}

fn color_of(value: &Value, key: &str) -> Option<[f32; 4]> {
    value
        .get(key)
        .and_then(|v| v.as_str())
        .and_then(|s| parse_color(s).ok())
}

/// Transparent margin around a rasterised path, in device pixels (see gpu/path.ts).
const PATH_PAD_PX: u32 = 1;

fn escape_xml(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for ch in text.chars() {
        match ch {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&apos;"),
            _ => out.push(ch),
        }
    }
    out
}

fn css_color(color: [f32; 4]) -> String {
    let channel = |v: f32| (v.clamp(0.0, 1.0) * 255.0).round() as u32;
    format!(
        "#{:02x}{:02x}{:02x}",
        channel(color[0]),
        channel(color[1]),
        channel(color[2])
    )
}

/// Rasterises an SVG `d` path into premultiplied RGBA, using the same quad mapping
/// as the desktop renderer. `origin`/`quad` are in the path's local units.
#[allow(clippy::too_many_arguments)]
fn rasterize_path(
    d: &str,
    fill: Option<[f32; 4]>,
    stroke: Option<[f32; 4]>,
    stroke_width: f32,
    origin_x: f32,
    origin_y: f32,
    quad_width: f32,
    quad_height: f32,
    width_px: u32,
    height_px: u32,
) -> Option<RasterImage> {
    let mut paint = String::new();
    match fill {
        Some(color) if color[3] > 0.0 && !d.is_empty() => {
            paint.push_str(&format!(
                r#" fill="{}" fill-opacity="{}""#,
                css_color(color),
                color[3]
            ));
        }
        _ => paint.push_str(r#" fill="none""#),
    }
    if let Some(color) = stroke {
        if color[3] > 0.0 && stroke_width > 0.0 && !d.is_empty() {
            paint.push_str(&format!(
                r#" stroke="{}" stroke-opacity="{}" stroke-width="{}""#,
                css_color(color),
                color[3],
                stroke_width
            ));
        }
    }

    let svg = format!(
        r#"<svg xmlns="http://www.w3.org/2000/svg" width="{width_px}" height="{height_px}" viewBox="{} {} {} {}"><path d="{}"{paint}/></svg>"#,
        origin_x,
        origin_y,
        quad_width,
        quad_height,
        escape_xml(d)
    );

    let options = resvg::usvg::Options::default();
    let tree = resvg::usvg::Tree::from_str(&svg, &options).ok()?;
    let mut pixmap = resvg::tiny_skia::Pixmap::new(width_px.max(1), height_px.max(1))?;
    resvg::render(
        &tree,
        resvg::tiny_skia::Transform::default(),
        &mut pixmap.as_mut(),
    );
    Some(RasterImage {
        width: pixmap.width(),
        height: pixmap.height(),
        data: pixmap.take(),
    })
}

pub struct FrameData {
    instances: wgpu::Buffer,
    globals: wgpu::BindGroup,
    leaf_binds: Vec<wgpu::BindGroup>,
}

pub struct Renderer {
    quad_pipeline: wgpu::RenderPipeline,
    blur_pipeline: wgpu::RenderPipeline,
    filter_pipeline: wgpu::RenderPipeline,
    composite_pipelines: HashMap<(wgpu::TextureFormat, bool), wgpu::RenderPipeline>,
    composite_module: Arc<wgpu::ShaderModule>,
    texture_layout: wgpu::BindGroupLayout,
    sampler: wgpu::Sampler,
    white: wgpu::Texture,
    white_bind: wgpu::BindGroup,
    text_textures: HashMap<String, (wgpu::Texture, wgpu::BindGroup)>,
    path_textures: HashMap<String, (wgpu::Texture, wgpu::BindGroup)>,
    image_textures: HashMap<String, (wgpu::Texture, wgpu::BindGroup)>,
    video_textures: HashMap<String, VideoTexture>,
    text: TextEngine,
    assets: AssetStore,
    shader_renderer: ShaderRenderer,
    shader_keepalive: Vec<wgpu::Texture>,
    three_textures: HashMap<String, (wgpu::Texture, u32, u32)>,
}

struct VideoTexture {
    texture: wgpu::Texture,
    bind: wgpu::BindGroup,
    width: u32,
    height: u32,
    time: f64,
}

impl Renderer {
    pub fn new(device: &wgpu::Device, queue: &wgpu::Queue, project_root: PathBuf) -> Self {
        let quad_module = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("liosvideo quad"),
            source: wgpu::ShaderSource::Wgsl(format!("{COMMON_WGSL}\n{QUAD_WGSL}").into()),
        });
        let blur_module = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("liosvideo blur"),
            source: wgpu::ShaderSource::Wgsl(format!("{COMMON_WGSL}\n{BLUR_WGSL}").into()),
        });
        let composite_module = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("liosvideo composite"),
            source: wgpu::ShaderSource::Wgsl(format!("{COMMON_WGSL}\n{COMPOSITE_WGSL}").into()),
        });

        let premultiplied = wgpu::BlendState {
            color: wgpu::BlendComponent {
                src_factor: wgpu::BlendFactor::One,
                dst_factor: wgpu::BlendFactor::OneMinusSrcAlpha,
                operation: wgpu::BlendOperation::Add,
            },
            alpha: wgpu::BlendComponent {
                src_factor: wgpu::BlendFactor::One,
                dst_factor: wgpu::BlendFactor::OneMinusSrcAlpha,
                operation: wgpu::BlendOperation::Add,
            },
        };

        let quad_pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("liosvideo quad pipeline"),
            layout: None,
            vertex: wgpu::VertexState {
                module: &quad_module,
                entry_point: Some("vs"),
                compilation_options: Default::default(),
                buffers: &[],
            },
            fragment: Some(wgpu::FragmentState {
                module: &quad_module,
                entry_point: Some("fs"),
                compilation_options: Default::default(),
                targets: &[Some(wgpu::ColorTargetState {
                    format: LAYER_FORMAT,
                    blend: Some(premultiplied),
                    write_mask: wgpu::ColorWrites::ALL,
                })],
            }),
            primitive: Default::default(),
            depth_stencil: None,
            multisample: Default::default(),
            multiview: None,
            cache: None,
        });

        let blur_pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("liosvideo blur pipeline"),
            layout: None,
            vertex: wgpu::VertexState {
                module: &blur_module,
                entry_point: Some("vsFullscreen"),
                compilation_options: Default::default(),
                buffers: &[],
            },
            fragment: Some(wgpu::FragmentState {
                module: &blur_module,
                entry_point: Some("fs"),
                compilation_options: Default::default(),
                targets: &[Some(wgpu::ColorTargetState {
                    format: LAYER_FORMAT,
                    blend: None,
                    write_mask: wgpu::ColorWrites::ALL,
                })],
            }),
            primitive: Default::default(),
            depth_stencil: None,
            multisample: Default::default(),
            multiview: None,
            cache: None,
        });

        let filter_module = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("liosvideo filter"),
            source: wgpu::ShaderSource::Wgsl(format!("{COMMON_WGSL}\n{FILTER_WGSL}").into()),
        });
        let filter_pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("liosvideo filter pipeline"),
            layout: None,
            vertex: wgpu::VertexState {
                module: &filter_module,
                entry_point: Some("vsFullscreen"),
                compilation_options: Default::default(),
                buffers: &[],
            },
            fragment: Some(wgpu::FragmentState {
                module: &filter_module,
                entry_point: Some("fs"),
                compilation_options: Default::default(),
                targets: &[Some(wgpu::ColorTargetState {
                    format: LAYER_FORMAT,
                    blend: None,
                    write_mask: wgpu::ColorWrites::ALL,
                })],
            }),
            primitive: Default::default(),
            depth_stencil: None,
            multisample: Default::default(),
            multiview: None,
            cache: None,
        });
        let composite_pipelines = HashMap::new();
        let texture_layout = quad_pipeline.get_bind_group_layout(1);

        let sampler = device.create_sampler(&wgpu::SamplerDescriptor {
            label: Some("liosvideo sampler"),
            mag_filter: wgpu::FilterMode::Linear,
            min_filter: wgpu::FilterMode::Linear,
            ..Default::default()
        });

        let white = device.create_texture(&wgpu::TextureDescriptor {
            label: Some("liosvideo white"),
            size: wgpu::Extent3d {
                width: 1,
                height: 1,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: LAYER_FORMAT,
            usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
            view_formats: &[],
        });
        queue.write_texture(
            wgpu::TexelCopyTextureInfo {
                texture: &white,
                mip_level: 0,
                origin: wgpu::Origin3d::ZERO,
                aspect: wgpu::TextureAspect::All,
            },
            &[255u8, 255, 255, 255],
            wgpu::TexelCopyBufferLayout {
                offset: 0,
                bytes_per_row: Some(4),
                rows_per_image: Some(1),
            },
            wgpu::Extent3d {
                width: 1,
                height: 1,
                depth_or_array_layers: 1,
            },
        );

        let white_bind = make_texture_bind(device, &texture_layout, &sampler, &white);

        Self {
            quad_pipeline,
            blur_pipeline,
            filter_pipeline,
            composite_pipelines,
            composite_module: Arc::new(composite_module),
            texture_layout,
            sampler,
            white,
            white_bind,
            text_textures: HashMap::new(),
            path_textures: HashMap::new(),
            image_textures: HashMap::new(),
            video_textures: HashMap::new(),
            text: TextEngine::new(),
            assets: AssetStore::new(project_root),
            shader_renderer: ShaderRenderer::new(),
            shader_keepalive: Vec::new(),
            three_textures: HashMap::new(),
        }
    }

    fn three_texture(
        &mut self,
        device: &wgpu::Device,
        queue: &wgpu::Queue,
        path: &str,
        image: &ImageAsset,
    ) -> wgpu::BindGroup {
        let needs_new = match self.three_textures.get(path) {
            Some((_, width, height)) => *width != image.width || *height != image.height,
            None => true,
        };
        if needs_new {
            let texture = device.create_texture(&wgpu::TextureDescriptor {
                label: Some("liosvideo three target"),
                size: wgpu::Extent3d {
                    width: image.width.max(1),
                    height: image.height.max(1),
                    depth_or_array_layers: 1,
                },
                mip_level_count: 1,
                sample_count: 1,
                dimension: wgpu::TextureDimension::D2,
                format: LAYER_FORMAT,
                usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
                view_formats: &[],
            });
            self.three_textures
                .insert(path.to_string(), (texture, image.width, image.height));
        }
        {
            let (texture, _, _) = self.three_textures.get(path).expect("three texture");
            queue.write_texture(
                wgpu::TexelCopyTextureInfo {
                    texture,
                    mip_level: 0,
                    origin: wgpu::Origin3d::ZERO,
                    aspect: wgpu::TextureAspect::All,
                },
                &image.rgba,
                wgpu::TexelCopyBufferLayout {
                    offset: 0,
                    bytes_per_row: Some(image.width.max(1) * 4),
                    rows_per_image: Some(image.height.max(1)),
                },
                wgpu::Extent3d {
                    width: image.width.max(1),
                    height: image.height.max(1),
                    depth_or_array_layers: 1,
                },
            );
        }
        let (texture, _, _) = self.three_textures.get(path).expect("three texture");
        make_texture_bind(device, &self.texture_layout, &self.sampler, texture)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn render_frame(
        &mut self,
        device: &wgpu::Device,
        queue: &wgpu::Queue,
        target: &RenderTarget,
        list: &Value,
        time: f32,
        progress: f32,
        three_frames: &HashMap<String, Arc<ImageAsset>>,
    ) -> Result<()> {
        self.shader_keepalive.clear();
        let width = target.width;
        let height = target.height;
        let list_w = list
            .get("width")
            .and_then(|v| v.as_f64())
            .unwrap_or(width as f64) as f32;
        let list_h = list
            .get("height")
            .and_then(|v| v.as_f64())
            .unwrap_or(height as f64) as f32;
        let sx = width as f32 / list_w.max(1.0);
        let sy = height as f32 / list_h.max(1.0);

        let items = list
            .get("items")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();

        let mut leaves: Vec<&Value> = Vec::new();
        collect_leaves(&items, &mut leaves);

        let mut instance_data = vec![0f32; leaves.len().max(1) * INST_FLOATS];
        let mut leaf_binds = Vec::with_capacity(leaves.len());
        for (index, leaf) in leaves.iter().enumerate() {
            let (data, bind) =
                self.prepare_leaf(device, queue, leaf, sx, time, progress, three_frames)?;
            instance_data[index * INST_FLOATS..(index + 1) * INST_FLOATS].copy_from_slice(&data);
            leaf_binds.push(bind);
        }

        let instances = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("liosvideo instances"),
            contents: bytemuck::cast_slice(&instance_data),
            usage: wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_DST,
        });
        let globals_buffer = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("liosvideo globals"),
            contents: bytemuck::cast_slice(&[width as f32, height as f32, sx, sy]),
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
        });
        let globals = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("liosvideo globals bind"),
            layout: &self.quad_pipeline.get_bind_group_layout(0),
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: globals_buffer.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: instances.as_entire_binding(),
                },
            ],
        });

        let frame = FrameData {
            instances,
            globals,
            leaf_binds,
        };

        let [bg_r, bg_g, bg_b, bg_a] = match list.get("background").and_then(|v| v.as_str()) {
            Some(bg) => parse_color(bg).unwrap_or([0.0, 0.0, 0.0, 1.0]),
            None => [0.0, 0.0, 0.0, 1.0],
        };
        let clear = wgpu::Color {
            r: (bg_r * bg_a) as f64,
            g: (bg_g * bg_a) as f64,
            b: (bg_b * bg_a) as f64,
            a: bg_a as f64,
        };

        let mut encoder = device.create_command_encoder(&wgpu::CommandEncoderDescriptor {
            label: Some("liosvideo frame encoder"),
        });

        clear_target(&mut encoder, &target.view, clear);

        let mut allocations: Vec<wgpu::Texture> = Vec::new();
        let mut counter = 0usize;
        let composite_module = Arc::clone(&self.composite_module);
        draw_items(
            device,
            queue,
            &mut encoder,
            self,
            &target.view,
            &items,
            &frame,
            &mut counter,
            &mut allocations,
            width,
            height,
            sx,
            sy,
            &composite_module,
        );

        queue.submit(Some(encoder.finish()));

        let _ = &self.white;
        let _ = &frame.instances;
        drop(allocations);
        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    fn prepare_leaf(
        &mut self,
        device: &wgpu::Device,
        queue: &wgpu::Queue,
        leaf: &Value,
        sx: f32,
        time: f32,
        progress: f32,
        three_frames: &HashMap<String, Arc<ImageAsset>>,
    ) -> Result<([f32; INST_FLOATS], wgpu::BindGroup)> {
        let kind = str_of(leaf, "kind", "");
        let opacity = f32_of(leaf, "opacity", 1.0);
        let matrix = matrix_from(leaf.get("matrix").unwrap_or(&Value::Null));
        let [a, b, c, d, mut e, mut f] = matrix;

        let mut width: f32;
        let mut height: f32;
        let mut color = [1.0f32, 1.0, 1.0, 1.0];
        let mut stroke = [0.0f32, 0.0, 0.0, 0.0];
        let params: [f32; 4];
        let mut uv = [0.0f32, 0.0, 1.0, 1.0];
        let mut bind = self.white_bind.clone();

        match kind {
            "rect" | "circle" => {
                width = f32_of(leaf, "width", 0.0);
                height = f32_of(leaf, "height", 0.0);
                color = color_of(leaf, "fill").unwrap_or([0.0, 0.0, 0.0, 0.0]);
                if let Some(s) = color_of(leaf, "stroke") {
                    stroke = s;
                }
                params = [
                    f32_of(leaf, "radius", 0.0),
                    f32_of(leaf, "strokeWidth", 0.0),
                    opacity,
                    MODE_RECT,
                ];
            }
            "path" => {
                // Mirrors PathRasterizer in packages/runtime/src/gpu/path.ts: the quad covers the
                // path's local bounds plus a one-pixel transparent margin at `scale` device px/unit.
                let bounds = leaf.get("bounds").unwrap_or(&Value::Null);
                let bx = f32_of(bounds, "x", 0.0);
                let by = f32_of(bounds, "y", 0.0);
                let bw = f32_of(bounds, "width", 0.0);
                let bh = f32_of(bounds, "height", 0.0);
                let scale =
                    (((a * d - b * c).abs().sqrt() * sx * 100.0).round() / 100.0).max(0.01);

                let width_px = ((bw * scale).ceil() as u32)
                    .saturating_add(PATH_PAD_PX * 2)
                    .clamp(1, 8192);
                let height_px = ((bh * scale).ceil() as u32)
                    .saturating_add(PATH_PAD_PX * 2)
                    .clamp(1, 8192);
                let origin_x = bx - PATH_PAD_PX as f32 / scale;
                let origin_y = by - PATH_PAD_PX as f32 / scale;
                let quad_width = width_px as f32 / scale;
                let quad_height = height_px as f32 / scale;

                let d_str = str_of(leaf, "d", "");
                let fill = color_of(leaf, "fill");
                let stroke_color = color_of(leaf, "stroke");
                let stroke_width = f32_of(leaf, "strokeWidth", 0.0);
                let key = format!(
                    "path:{}|{:?}|{:?}|{}|{}|{}|{}|{}|{}",
                    d_str, fill, stroke_color, stroke_width, bx, by, bw, bh, scale
                );

                if let Some(image) = rasterize_path(
                    d_str,
                    fill,
                    stroke_color,
                    stroke_width,
                    origin_x,
                    origin_y,
                    quad_width,
                    quad_height,
                    width_px,
                    height_px,
                ) {
                    bind = self.path_texture(device, queue, &key, &image);
                    e += a * origin_x + c * origin_y;
                    f += b * origin_x + d * origin_y;
                    width = quad_width;
                    height = quad_height;
                    color = [1.0, 1.0, 1.0, 1.0];
                    params = [0.0, 0.0, opacity, MODE_TEXTURE];
                } else {
                    width = quad_width;
                    height = quad_height;
                    color = [0.0, 0.0, 0.0, 0.0];
                    params = [0.0, 0.0, opacity, MODE_SOLID];
                }
            }
            "shader" => {
                width = non_zero(f32_of(leaf, "width", 0.0), 100.0);
                height = non_zero(f32_of(leaf, "height", 0.0), 100.0);
                let code = str_of(leaf, "code", "");
                let scale = (((a * d - b * c).abs().sqrt() * sx * 100.0).round() / 100.0).max(0.01);
                let width_px = ((width * scale).ceil() as u32).clamp(1, 8192);
                let height_px = ((height * scale).ceil() as u32).clamp(1, 8192);

                let rendered = if code.trim().is_empty() {
                    None
                } else {
                    self.shader_renderer.render(
                        device,
                        queue,
                        code,
                        leaf.get("uniforms").and_then(|v| v.as_object()),
                        width_px,
                        height_px,
                        time,
                        progress,
                    )
                };

                if let Some(shader_tex) = rendered {
                    let view = shader_tex
                        .texture
                        .create_view(&wgpu::TextureViewDescriptor::default());
                    bind = make_texture_bind_with_view(
                        device,
                        &self.texture_layout,
                        &self.sampler,
                        &view,
                    );
                    self.shader_keepalive.push(shader_tex.texture);
                    params = [0.0, 0.0, opacity, MODE_TEXTURE];
                } else {
                    color = [1.0, 1.0, 1.0, 1.0];
                    params = [0.0, 0.0, opacity, MODE_SOLID];
                }
            }
            "text" => {
                let mut scale = ((a * d - b * c).abs().sqrt() * sx * 100.0).round() / 100.0;
                if !scale.is_finite() || scale == 0.0 {
                    scale = 1.0;
                }
                let props = TextProps {
                    text: str_of(leaf, "text", "").to_string(),
                    font_family: str_of(leaf, "fontFamily", "SF Pro Text").to_string(),
                    font_size: f32_of(leaf, "fontSize", 48.0),
                    font_weight: f32_of(leaf, "fontWeight", 400.0) as u16,
                    line_height: f32_of(leaf, "lineHeight", 1.2),
                    align: str_of(leaf, "align", "left").to_string(),
                    box_width: f32_of(leaf, "boxWidth", 0.0),
                };
                let text_color = str_of(leaf, "color", "#ffffff");
                let raster = self.text.raster(&props, text_color, scale);
                let tex_bind = self.text_texture(device, queue, &raster.key, &raster.image);
                bind = tex_bind;
                width = raster.width;
                height = raster.height;
                params = [0.0, 0.0, opacity, MODE_TEXTURE];
            }
            "three" => {
                let item_width = f32_of(leaf, "width", 0.0);
                let item_height = f32_of(leaf, "height", 0.0);
                let path = str_of(leaf, "path", "");
                if let Some(image) = three_frames.get(path) {
                    width = non_zero(item_width, image.width as f32);
                    height = non_zero(item_height, image.height as f32);
                    bind = self.three_texture(device, queue, path, image);
                    params = [0.0, 0.0, opacity, MODE_TEXTURE];
                } else {
                    width = non_zero(item_width, 100.0);
                    height = non_zero(item_height, 100.0);
                    color = [0.0, 0.0, 0.0, 0.0];
                    params = [0.0, 0.0, 0.0, MODE_SOLID];
                }
            }
            _ => {
                let src = str_of(leaf, "src", "");
                let is_video = kind == "video";
                let asset = if is_video {
                    self.assets
                        .video_frame(src, f32_of(leaf, "time", 0.0) as f64)
                } else {
                    self.assets.image(src)
                };

                if let Some(image) = asset {
                    let item_width = f32_of(leaf, "width", 0.0);
                    let item_height = f32_of(leaf, "height", 0.0);
                    width = non_zero(item_width, image.width as f32);
                    height = non_zero(item_height, image.height as f32);

                    let box_aspect = width / height.max(0.0001);
                    let img_aspect = image.width as f32 / image.height.max(1) as f32;
                    match str_of(leaf, "fit", "fill") {
                        "contain" => {
                            let cw = if img_aspect > box_aspect {
                                width
                            } else {
                                height * img_aspect
                            };
                            let ch = if img_aspect > box_aspect {
                                width / img_aspect
                            } else {
                                height
                            };
                            let ox = (width - cw) / 2.0;
                            let oy = (height - ch) / 2.0;
                            e += a * ox + c * oy;
                            f += b * ox + d * oy;
                            width = cw;
                            height = ch;
                        }
                        "cover" => {
                            if img_aspect > box_aspect {
                                let k = box_aspect / img_aspect;
                                uv = [(1.0 - k) / 2.0, 0.0, (1.0 + k) / 2.0, 1.0];
                            } else {
                                let k = img_aspect / box_aspect;
                                uv = [0.0, (1.0 - k) / 2.0, 1.0, (1.0 + k) / 2.0];
                            }
                        }
                        _ => {}
                    }

                    if is_video {
                        bind = self.video_texture(
                            device,
                            queue,
                            src,
                            &image,
                            f32_of(leaf, "time", 0.0) as f64,
                        );
                    } else {
                        bind = self.image_texture(device, queue, src, &image);
                    }
                    params = [0.0, 0.0, opacity, MODE_TEXTURE];
                } else {
                    width = non_zero(f32_of(leaf, "width", 0.0), 100.0);
                    height = non_zero(f32_of(leaf, "height", 0.0), 100.0);
                    color = [1.0, 0.0, 1.0, 1.0];
                    params = [0.0, 0.0, opacity, MODE_SOLID];
                }
            }
        }

        let matrix = [a, b, c, d, e, f];

        let mut data = [0.0f32; INST_FLOATS];
        data[0..6].copy_from_slice(&matrix);
        data[6] = width;
        data[7] = height;
        data[8..12].copy_from_slice(&color);
        data[12..16].copy_from_slice(&stroke);
        data[16..20].copy_from_slice(&params);
        data[20..24].copy_from_slice(&uv);

        Ok((data, bind))
    }

    fn text_texture(
        &mut self,
        device: &wgpu::Device,
        queue: &wgpu::Queue,
        key: &str,
        image: &RasterImage,
    ) -> wgpu::BindGroup {
        if let Some((_, bind)) = self.text_textures.get(key) {
            return bind.clone();
        }
        let texture = upload_raw_texture(device, queue, image.width, image.height, &image.data);
        let bind = make_texture_bind(device, &self.texture_layout, &self.sampler, &texture);
        self.text_textures
            .insert(key.to_string(), (texture, bind.clone()));
        bind
    }

    fn path_texture(
        &mut self,
        device: &wgpu::Device,
        queue: &wgpu::Queue,
        key: &str,
        image: &RasterImage,
    ) -> wgpu::BindGroup {
        if let Some((_, bind)) = self.path_textures.get(key) {
            return bind.clone();
        }
        let texture = upload_raw_texture(device, queue, image.width, image.height, &image.data);
        let bind = make_texture_bind(device, &self.texture_layout, &self.sampler, &texture);
        self.path_textures
            .insert(key.to_string(), (texture, bind.clone()));
        bind
    }

    fn image_texture(
        &mut self,
        device: &wgpu::Device,
        queue: &wgpu::Queue,
        key: &str,
        image: &ImageAsset,
    ) -> wgpu::BindGroup {
        if let Some((_, bind)) = self.image_textures.get(key) {
            return bind.clone();
        }
        let texture = upload_texture(device, queue, image);
        let bind = make_texture_bind(device, &self.texture_layout, &self.sampler, &texture);
        self.image_textures
            .insert(key.to_string(), (texture, bind.clone()));
        bind
    }

    fn video_texture(
        &mut self,
        device: &wgpu::Device,
        queue: &wgpu::Queue,
        key: &str,
        image: &ImageAsset,
        time: f64,
    ) -> wgpu::BindGroup {
        let reuse = self
            .video_textures
            .get(key)
            .map(|v| v.width == image.width && v.height == image.height)
            .unwrap_or(false);

        if reuse {
            let entry = self.video_textures.get_mut(key).unwrap();
            if (entry.time - time).abs() < 1e-6 {
                return entry.bind.clone();
            }
            queue.write_texture(
                wgpu::TexelCopyTextureInfo {
                    texture: &entry.texture,
                    mip_level: 0,
                    origin: wgpu::Origin3d::ZERO,
                    aspect: wgpu::TextureAspect::All,
                },
                &image.rgba,
                wgpu::TexelCopyBufferLayout {
                    offset: 0,
                    bytes_per_row: Some(image.width * 4),
                    rows_per_image: Some(image.height),
                },
                wgpu::Extent3d {
                    width: image.width,
                    height: image.height,
                    depth_or_array_layers: 1,
                },
            );
            entry.time = time;
            return entry.bind.clone();
        }

        let texture = upload_texture(device, queue, image);
        let bind = make_texture_bind(device, &self.texture_layout, &self.sampler, &texture);
        self.video_textures.insert(
            key.to_string(),
            VideoTexture {
                texture,
                bind: bind.clone(),
                width: image.width,
                height: image.height,
                time,
            },
        );
        bind
    }

    fn composite_pipeline(
        &mut self,
        device: &wgpu::Device,
        module: &wgpu::ShaderModule,
        format: wgpu::TextureFormat,
        blend: bool,
    ) -> &wgpu::RenderPipeline {
        let key = (format, blend);
        if let std::collections::hash_map::Entry::Vacant(entry) =
            self.composite_pipelines.entry(key)
        {
            let blend_state = if blend {
                Some(wgpu::BlendState {
                    color: wgpu::BlendComponent {
                        src_factor: wgpu::BlendFactor::One,
                        dst_factor: wgpu::BlendFactor::OneMinusSrcAlpha,
                        operation: wgpu::BlendOperation::Add,
                    },
                    alpha: wgpu::BlendComponent {
                        src_factor: wgpu::BlendFactor::One,
                        dst_factor: wgpu::BlendFactor::OneMinusSrcAlpha,
                        operation: wgpu::BlendOperation::Add,
                    },
                })
            } else {
                None
            };
            let pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
                label: Some("liosvideo composite pipeline"),
                layout: None,
                vertex: wgpu::VertexState {
                    module,
                    entry_point: Some("vsFullscreen"),
                    compilation_options: Default::default(),
                    buffers: &[],
                },
                fragment: Some(wgpu::FragmentState {
                    module,
                    entry_point: Some("fs"),
                    compilation_options: Default::default(),
                    targets: &[Some(wgpu::ColorTargetState {
                        format,
                        blend: blend_state,
                        write_mask: wgpu::ColorWrites::ALL,
                    })],
                }),
                primitive: Default::default(),
                depth_stencil: None,
                multisample: Default::default(),
                multiview: None,
                cache: None,
            });
            entry.insert(pipeline);
        }
        self.composite_pipelines.get(&key).unwrap()
    }
}

fn non_zero(value: f32, fallback: f32) -> f32 {
    if value == 0.0 {
        fallback
    } else {
        value
    }
}

fn collect_leaves<'a>(items: &'a [Value], out: &mut Vec<&'a Value>) {
    for item in items {
        if str_of(item, "kind", "") == "layer" {
            if let Some(children) = item.get("items").and_then(|v| v.as_array()) {
                collect_leaves(children, out);
            }
        } else {
            out.push(item);
        }
    }
}

fn upload_texture(device: &wgpu::Device, queue: &wgpu::Queue, image: &ImageAsset) -> wgpu::Texture {
    upload_raw_texture(device, queue, image.width, image.height, &image.rgba)
}

fn upload_raw_texture(
    device: &wgpu::Device,
    queue: &wgpu::Queue,
    width: u32,
    height: u32,
    rgba: &[u8],
) -> wgpu::Texture {
    let texture = device.create_texture(&wgpu::TextureDescriptor {
        label: Some("liosvideo asset"),
        size: wgpu::Extent3d {
            width: width.max(1),
            height: height.max(1),
            depth_or_array_layers: 1,
        },
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format: LAYER_FORMAT,
        usage: wgpu::TextureUsages::TEXTURE_BINDING
            | wgpu::TextureUsages::COPY_DST
            | wgpu::TextureUsages::RENDER_ATTACHMENT,
        view_formats: &[],
    });
    queue.write_texture(
        wgpu::TexelCopyTextureInfo {
            texture: &texture,
            mip_level: 0,
            origin: wgpu::Origin3d::ZERO,
            aspect: wgpu::TextureAspect::All,
        },
        rgba,
        wgpu::TexelCopyBufferLayout {
            offset: 0,
            bytes_per_row: Some(width * 4),
            rows_per_image: Some(height),
        },
        wgpu::Extent3d {
            width: width.max(1),
            height: height.max(1),
            depth_or_array_layers: 1,
        },
    );
    texture
}

fn make_texture_bind(
    device: &wgpu::Device,
    layout: &wgpu::BindGroupLayout,
    sampler: &wgpu::Sampler,
    texture: &wgpu::Texture,
) -> wgpu::BindGroup {
    let view = texture.create_view(&wgpu::TextureViewDescriptor::default());
    make_texture_bind_with_view(device, layout, sampler, &view)
}

fn make_texture_bind_with_view(
    device: &wgpu::Device,
    layout: &wgpu::BindGroupLayout,
    sampler: &wgpu::Sampler,
    view: &wgpu::TextureView,
) -> wgpu::BindGroup {
    device.create_bind_group(&wgpu::BindGroupDescriptor {
        label: Some("liosvideo texture bind"),
        layout,
        entries: &[
            wgpu::BindGroupEntry {
                binding: 0,
                resource: wgpu::BindingResource::TextureView(view),
            },
            wgpu::BindGroupEntry {
                binding: 1,
                resource: wgpu::BindingResource::Sampler(sampler),
            },
        ],
    })
}

fn create_layer_texture(device: &wgpu::Device, width: u32, height: u32) -> wgpu::Texture {
    device.create_texture(&wgpu::TextureDescriptor {
        label: Some("liosvideo layer"),
        size: wgpu::Extent3d {
            width: width.max(1),
            height: height.max(1),
            depth_or_array_layers: 1,
        },
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format: LAYER_FORMAT,
        usage: wgpu::TextureUsages::RENDER_ATTACHMENT
            | wgpu::TextureUsages::TEXTURE_BINDING
            | wgpu::TextureUsages::COPY_SRC,
        view_formats: &[],
    })
}

fn clear_target(encoder: &mut wgpu::CommandEncoder, view: &wgpu::TextureView, color: wgpu::Color) {
    let _pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
        label: Some("liosvideo clear"),
        color_attachments: &[Some(wgpu::RenderPassColorAttachment {
            view,
            resolve_target: None,
            ops: wgpu::Operations {
                load: wgpu::LoadOp::Clear(color),
                store: wgpu::StoreOp::Store,
            },
        })],
        depth_stencil_attachment: None,
        timestamp_writes: None,
        occlusion_query_set: None,
    });
}

#[allow(clippy::too_many_arguments)]
fn draw_items(
    device: &wgpu::Device,
    queue: &wgpu::Queue,
    encoder: &mut wgpu::CommandEncoder,
    renderer: &mut Renderer,
    parent_view: &wgpu::TextureView,
    items: &[Value],
    frame: &FrameData,
    counter: &mut usize,
    allocations: &mut Vec<wgpu::Texture>,
    width: u32,
    height: u32,
    sx: f32,
    sy: f32,
    composite_module: &wgpu::ShaderModule,
) {
    let mut run_start = *counter;
    let mut run_len = 0usize;

    for item in items {
        if str_of(item, "kind", "") != "layer" {
            *counter += 1;
            run_len += 1;
            continue;
        }

        draw_leaf_run(encoder, renderer, parent_view, frame, run_start, run_len);
        run_len = 0;
        draw_layer(
            device,
            queue,
            encoder,
            renderer,
            parent_view,
            item,
            frame,
            counter,
            allocations,
            width,
            height,
            sx,
            sy,
            composite_module,
        );
        run_start = *counter;
    }

    draw_leaf_run(encoder, renderer, parent_view, frame, run_start, run_len);
}

fn draw_leaf_run(
    encoder: &mut wgpu::CommandEncoder,
    renderer: &Renderer,
    view: &wgpu::TextureView,
    frame: &FrameData,
    start: usize,
    len: usize,
) {
    if len == 0 {
        return;
    }
    let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
        label: Some("liosvideo leaves"),
        color_attachments: &[Some(wgpu::RenderPassColorAttachment {
            view,
            resolve_target: None,
            ops: wgpu::Operations {
                load: wgpu::LoadOp::Load,
                store: wgpu::StoreOp::Store,
            },
        })],
        depth_stencil_attachment: None,
        timestamp_writes: None,
        occlusion_query_set: None,
    });
    pass.set_pipeline(&renderer.quad_pipeline);
    pass.set_bind_group(0, &frame.globals, &[]);
    for index in start..start + len {
        let Some(bind) = frame.leaf_binds.get(index) else {
            continue;
        };
        pass.set_bind_group(1, bind, &[]);
        pass.draw(0..6, index as u32..index as u32 + 1);
    }
}

#[allow(clippy::too_many_arguments)]
fn draw_layer(
    device: &wgpu::Device,
    queue: &wgpu::Queue,
    encoder: &mut wgpu::CommandEncoder,
    renderer: &mut Renderer,
    parent_view: &wgpu::TextureView,
    layer: &Value,
    frame: &FrameData,
    counter: &mut usize,
    allocations: &mut Vec<wgpu::Texture>,
    width: u32,
    height: u32,
    sx: f32,
    sy: f32,
    composite_module: &wgpu::ShaderModule,
) {
    let content = create_layer_texture(device, width, height);
    let content_view = content.create_view(&wgpu::TextureViewDescriptor::default());
    {
        let _pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
            label: Some("liosvideo layer clear"),
            color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                view: &content_view,
                resolve_target: None,
                ops: wgpu::Operations {
                    load: wgpu::LoadOp::Clear(wgpu::Color::TRANSPARENT),
                    store: wgpu::StoreOp::Store,
                },
            })],
            depth_stencil_attachment: None,
            timestamp_writes: None,
            occlusion_query_set: None,
        });
    }

    if let Some(children) = layer.get("items").and_then(|v| v.as_array()) {
        draw_items(
            device,
            queue,
            encoder,
            renderer,
            &content_view,
            children,
            frame,
            counter,
            allocations,
            width,
            height,
            sx,
            sy,
            composite_module,
        );
    }

    let blur = f32_of(layer, "blur", 0.0);
    if blur > 0.0 {
        blur_into(
            device,
            encoder,
            renderer,
            &content,
            &content,
            blur * sx,
            width,
            height,
            allocations,
        );
    }
    let result = match layer.get("filters") {
        Some(filters) => apply_filters(
            device,
            encoder,
            renderer,
            &content,
            filters,
            sx,
            width,
            height,
            allocations,
        ),
        None => content.create_view(&wgpu::TextureViewDescriptor::default()),
    };

    let opacity = f32_of(layer, "opacity", 1.0);
    let mut values = [
        1.0f32, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, opacity, 0.0, 0.0, 1.0,
    ];

    if let Some(clip) = layer.get("clip") {
        let device_scale = [sx, 0.0, 0.0, sy, 0.0, 0.0];
        let clip_matrix = matrix_from(clip.get("matrix").unwrap_or(&Value::Null));
        let full = multiply(device_scale, clip_matrix);
        let inv = invert(full);
        let units_per_px = (inv[0] * inv[0] + inv[1] * inv[1]).sqrt();
        let clip_width = f32_of(clip, "width", 0.0);
        let clip_height = f32_of(clip, "height", 0.0);
        let radius = f32_of(clip, "radius", 0.0);
        values = [
            inv[0],
            inv[1],
            inv[2],
            inv[3],
            inv[4],
            inv[5],
            clip_width,
            clip_height,
            opacity,
            radius,
            1.0,
            units_per_px,
        ];
    }

    {
        let pipeline = renderer.composite_pipeline(device, composite_module, LAYER_FORMAT, true);
        fullscreen(
            device,
            encoder,
            pipeline,
            parent_view,
            &values,
            &result,
            wgpu::LoadOp::Load,
        );
    }

    allocations.push(content);
}

/// Two-pass Gaussian blur of `src` into `dest` (they may be the same texture). `px` is in device pixels.
#[allow(clippy::too_many_arguments)]
fn blur_into(
    device: &wgpu::Device,
    encoder: &mut wgpu::CommandEncoder,
    renderer: &Renderer,
    dest: &wgpu::Texture,
    src: &wgpu::Texture,
    px: f32,
    width: u32,
    height: u32,
    allocations: &mut Vec<wgpu::Texture>,
) {
    let sigma = (px / 2.0).max(0.01);
    let radius = (sigma * 3.0).ceil().min(MAX_BLUR_RADIUS);
    let tmp = create_layer_texture(device, width, height);
    let tmp_view = tmp.create_view(&wgpu::TextureViewDescriptor::default());
    let src_view = src.create_view(&wgpu::TextureViewDescriptor::default());
    let dest_view = dest.create_view(&wgpu::TextureViewDescriptor::default());
    let clear = wgpu::LoadOp::Clear(wgpu::Color::TRANSPARENT);
    fullscreen(
        device,
        encoder,
        &renderer.blur_pipeline,
        &tmp_view,
        &[1.0, 0.0, sigma, radius],
        &src_view,
        clear,
    );
    fullscreen(
        device,
        encoder,
        &renderer.blur_pipeline,
        &dest_view,
        &[0.0, 1.0, sigma, radius],
        &tmp_view,
        clear,
    );
    allocations.push(tmp);
}

/// Runs a layer's filters in their fixed order (pixelate → posterize → halftone → outline → chalk → glow),
/// mirroring `applyFilters` in packages/runtime/src/gpu/renderer.ts. Returns a view of the result.
#[allow(clippy::too_many_arguments)]
fn apply_filters(
    device: &wgpu::Device,
    encoder: &mut wgpu::CommandEncoder,
    renderer: &Renderer,
    content: &wgpu::Texture,
    filters: &Value,
    sx: f32,
    width: u32,
    height: u32,
    allocations: &mut Vec<wgpu::Texture>,
) -> wgpu::TextureView {
    let [r, g, b, a] = color_of(filters, "outlineColor").unwrap_or([0.067, 0.067, 0.067, 1.0]);
    let intensity = f32_of(filters, "glowIntensity", 1.0);
    let mut cur = content.create_view(&wgpu::TextureViewDescriptor::default());
    let step = |encoder: &mut wgpu::CommandEncoder,
                mode: f32,
                amount: f32,
                extra: Option<&wgpu::TextureView>,
                cur: &mut wgpu::TextureView,
                allocations: &mut Vec<wgpu::Texture>| {
        let out = create_layer_texture(device, width, height);
        let out_view = out.create_view(&wgpu::TextureViewDescriptor::default());
        let values = [mode, amount, sx, intensity, r * a, g * a, b * a, a];
        filter_pass(
            device,
            encoder,
            &renderer.filter_pipeline,
            &out_view,
            &values,
            cur,
            extra.unwrap_or(cur),
        );
        *cur = out_view;
        allocations.push(out);
    };
    let pixelate = f32_of(filters, "pixelate", 0.0);
    let posterize = f32_of(filters, "posterize", 0.0);
    let halftone = f32_of(filters, "halftone", 0.0);
    let outline = f32_of(filters, "outline", 0.0);
    let chalk = f32_of(filters, "chalk", 0.0);
    let glow = f32_of(filters, "glow", 0.0);
    let threshold = f32_of(filters, "glowThreshold", 0.0).min(1.0);
    if pixelate > 0.0 {
        step(encoder, 1.0, pixelate * sx, None, &mut cur, allocations);
    }
    if posterize > 0.0 {
        step(encoder, 2.0, posterize, None, &mut cur, allocations);
    }
    if halftone > 0.0 {
        step(encoder, 3.0, halftone * sx, None, &mut cur, allocations);
    }
    if outline > 0.0 {
        step(encoder, 4.0, outline * sx, None, &mut cur, allocations);
    }
    if chalk > 0.0 {
        step(encoder, 5.0, chalk.min(1.0), None, &mut cur, allocations);
    }
    if glow > 0.0 {
        let halo = create_layer_texture(device, width, height);
        let halo_view = halo.create_view(&wgpu::TextureViewDescriptor::default());
        let tmp = create_layer_texture(device, width, height);
        let tmp_view = tmp.create_view(&wgpu::TextureViewDescriptor::default());
        let sigma = (glow * sx / 2.0).max(0.01);
        let radius = (sigma * 3.0).ceil().min(MAX_BLUR_RADIUS);
        let clear = wgpu::LoadOp::Clear(wgpu::Color::TRANSPARENT);
        // bloom: only what is brighter than the threshold spreads light
        let bright = (threshold > 0.0).then(|| {
            let t = create_layer_texture(device, width, height);
            let v = t.create_view(&wgpu::TextureViewDescriptor::default());
            let values = [7.0, threshold, sx, intensity, 0.0, 0.0, 0.0, 0.0];
            filter_pass(device, encoder, &renderer.filter_pipeline, &v, &values, &cur, &cur);
            (t, v)
        });
        fullscreen(
            device,
            encoder,
            &renderer.blur_pipeline,
            &tmp_view,
            &[1.0, 0.0, sigma, radius],
            bright.as_ref().map_or(&cur, |(_, v)| v),
            clear,
        );
        if let Some((t, _)) = bright {
            allocations.push(t);
        }
        fullscreen(
            device,
            encoder,
            &renderer.blur_pipeline,
            &halo_view,
            &[0.0, 1.0, sigma, radius],
            &tmp_view,
            clear,
        );
        allocations.push(tmp);
        step(encoder, 6.0, 0.0, Some(&halo_view), &mut cur, allocations);
        allocations.push(halo);
    }
    cur
}

#[allow(clippy::too_many_arguments)]
fn filter_pass(
    device: &wgpu::Device,
    encoder: &mut wgpu::CommandEncoder,
    pipeline: &wgpu::RenderPipeline,
    view: &wgpu::TextureView,
    values: &[f32; 8],
    source: &wgpu::TextureView,
    extra: &wgpu::TextureView,
) {
    let buffer = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
        label: Some("liosvideo filter uniform"),
        contents: bytemuck::cast_slice(values),
        usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
    });
    let bind = device.create_bind_group(&wgpu::BindGroupDescriptor {
        label: Some("liosvideo filter bind"),
        layout: &pipeline.get_bind_group_layout(0),
        entries: &[
            wgpu::BindGroupEntry {
                binding: 0,
                resource: buffer.as_entire_binding(),
            },
            wgpu::BindGroupEntry {
                binding: 1,
                resource: wgpu::BindingResource::TextureView(source),
            },
            wgpu::BindGroupEntry {
                binding: 2,
                resource: wgpu::BindingResource::TextureView(extra),
            },
        ],
    });
    let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
        label: Some("liosvideo filter"),
        color_attachments: &[Some(wgpu::RenderPassColorAttachment {
            view,
            resolve_target: None,
            ops: wgpu::Operations {
                load: wgpu::LoadOp::Clear(wgpu::Color::TRANSPARENT),
                store: wgpu::StoreOp::Store,
            },
        })],
        depth_stencil_attachment: None,
        timestamp_writes: None,
        occlusion_query_set: None,
    });
    pass.set_pipeline(pipeline);
    pass.set_bind_group(0, &bind, &[]);
    pass.draw(0..3, 0..1);
}

fn fullscreen(
    device: &wgpu::Device,
    encoder: &mut wgpu::CommandEncoder,
    pipeline: &wgpu::RenderPipeline,
    view: &wgpu::TextureView,
    values: &[f32],
    source: &wgpu::TextureView,
    load: wgpu::LoadOp<wgpu::Color>,
) {
    let buffer = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
        label: Some("liosvideo pass uniform"),
        contents: bytemuck::cast_slice(values),
        usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
    });
    let bind = device.create_bind_group(&wgpu::BindGroupDescriptor {
        label: Some("liosvideo pass bind"),
        layout: &pipeline.get_bind_group_layout(0),
        entries: &[
            wgpu::BindGroupEntry {
                binding: 0,
                resource: buffer.as_entire_binding(),
            },
            wgpu::BindGroupEntry {
                binding: 1,
                resource: wgpu::BindingResource::TextureView(source),
            },
        ],
    });

    let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
        label: Some("liosvideo fullscreen"),
        color_attachments: &[Some(wgpu::RenderPassColorAttachment {
            view,
            resolve_target: None,
            ops: wgpu::Operations {
                load,
                store: wgpu::StoreOp::Store,
            },
        })],
        depth_stencil_attachment: None,
        timestamp_writes: None,
        occlusion_query_set: None,
    });
    pass.set_pipeline(pipeline);
    pass.set_bind_group(0, &bind, &[]);
    pass.draw(0..3, 0..1);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn affine_roundtrip() {
        let m = [2.0, 0.0, 0.0, 3.0, 10.0, 20.0];
        let inv = invert(m);
        let id = multiply(m, inv);
        assert!((id[0] - 1.0).abs() < 1e-5);
        assert!((id[3] - 1.0).abs() < 1e-5);
        assert!(id[4].abs() < 1e-4);
        assert!(id[5].abs() < 1e-4);
    }

    #[test]
    fn shaders_match_runtime_sources() {
        let base = concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../packages/runtime/src/gpu/shaders/"
        );
        for (name, embedded) in [
            ("common.wgsl", COMMON_WGSL),
            ("quad.wgsl", QUAD_WGSL),
            ("blur.wgsl", BLUR_WGSL),
            ("composite.wgsl", COMPOSITE_WGSL),
            ("filter.wgsl", FILTER_WGSL),
        ] {
            let runtime = std::fs::read_to_string(format!("{base}{name}"))
                .unwrap_or_else(|e| panic!("read {name}: {e}"));
            assert_eq!(
                embedded, runtime,
                "CLI shader {name} drifted from the runtime"
            );
        }
    }

    #[test]
    fn flattens_nested_layers() {
        let items = vec![serde_json::json!({
            "kind": "layer",
            "items": [
                { "kind": "rect" },
                { "kind": "layer", "items": [ { "kind": "text" } ] }
            ]
        })];
        let mut leaves = Vec::new();
        collect_leaves(&items, &mut leaves);
        assert_eq!(leaves.len(), 2);
        assert_eq!(leaves[0]["kind"], "rect");
        assert_eq!(leaves[1]["kind"], "text");
    }
}
