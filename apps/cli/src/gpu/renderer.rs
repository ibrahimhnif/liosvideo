use anyhow::{anyhow, Result};
use wgpu::util::DeviceExt;

use crate::gpu::target::RenderTarget;

#[repr(C)]
#[derive(Copy, Clone, Debug, bytemuck::Pod, bytemuck::Zeroable)]
pub struct Vertex {
    pub position: [f32; 2],
    pub color: [f32; 4],
}

impl Vertex {
    pub fn desc() -> wgpu::VertexBufferLayout<'static> {
        wgpu::VertexBufferLayout {
            array_stride: std::mem::size_of::<Vertex>() as wgpu::BufferAddress,
            step_mode: wgpu::VertexStepMode::Vertex,
            attributes: &[
                wgpu::VertexAttribute {
                    offset: 0,
                    shader_location: 0,
                    format: wgpu::VertexFormat::Float32x2,
                },
                wgpu::VertexAttribute {
                    offset: std::mem::size_of::<[f32; 2]>() as wgpu::BufferAddress,
                    shader_location: 1,
                    format: wgpu::VertexFormat::Float32x4,
                },
            ],
        }
    }
}

pub struct Renderer {
    pub pipeline: wgpu::RenderPipeline,
}

impl Renderer {
    pub fn new(device: &wgpu::Device, format: wgpu::TextureFormat) -> Self {
        let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("Liosvideo 2D Shader"),
            source: wgpu::ShaderSource::Wgsl(
                r#"
                struct VertexInput {
                    @location(0) position: vec2<f32>,
                    @location(1) color: vec4<f32>,
                };

                struct VertexOutput {
                    @builtin(position) clip_position: vec4<f32>,
                    @location(0) color: vec4<f32>,
                };

                @vertex
                fn vs_main(model: VertexInput) -> VertexOutput {
                    var out: VertexOutput;
                    out.clip_position = vec4<f32>(model.position, 0.0, 1.0);
                    out.color = model.color;
                    return out;
                }

                @fragment
                fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
                    return in.color;
                }
                "#
                .into(),
            ),
        });

        let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("Liosvideo 2D Pipeline Layout"),
            bind_group_layouts: &[],
            push_constant_ranges: &[],
        });

        let pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("Liosvideo 2D Pipeline"),
            layout: Some(&pipeline_layout),
            vertex: wgpu::VertexState {
                module: &shader,
                entry_point: Some("vs_main"),
                compilation_options: Default::default(),
                buffers: &[Vertex::desc()],
            },
            fragment: Some(wgpu::FragmentState {
                module: &shader,
                entry_point: Some("fs_main"),
                compilation_options: Default::default(),
                targets: &[Some(wgpu::ColorTargetState {
                    format,
                    blend: Some(wgpu::BlendState::ALPHA_BLENDING),
                    write_mask: wgpu::ColorWrites::ALL,
                })],
            }),
            primitive: wgpu::PrimitiveState {
                topology: wgpu::PrimitiveTopology::TriangleList,
                strip_index_format: None,
                front_face: wgpu::FrontFace::Ccw,
                cull_mode: None,
                unclipped_depth: false,
                polygon_mode: wgpu::PolygonMode::Fill,
                conservative: false,
            },
            depth_stencil: None,
            multisample: wgpu::MultisampleState::default(),
            multiview: None,
            cache: None,
        });

        Self { pipeline }
    }

    pub fn render_frame(
        &self,
        device: &wgpu::Device,
        queue: &wgpu::Queue,
        target: &RenderTarget,
        render_list: &serde_json::Value,
    ) -> Result<()> {
        let bg_str = render_list
            .get("background")
            .and_then(|v| v.as_str())
            .unwrap_or("#000000");

        let (bg_r, bg_g, bg_b, bg_a) = parse_color(bg_str).unwrap_or((0.0, 0.0, 0.0, 1.0));
        let clear_color = wgpu::Color {
            r: srgb_to_linear(bg_r) as f64,
            g: srgb_to_linear(bg_g) as f64,
            b: srgb_to_linear(bg_b) as f64,
            a: bg_a as f64,
        };

        let mut vertices: Vec<Vertex> = Vec::new();

        if let Some(items) = render_list.get("items").and_then(|v| v.as_array()) {
            for item in items {
                let kind = item.get("kind").and_then(|v| v.as_str()).unwrap_or("");
                if kind == "rect" {
                    let w = item.get("width").and_then(|v| v.as_f64()).unwrap_or(0.0) as f32;
                    let h = item.get("height").and_then(|v| v.as_f64()).unwrap_or(0.0) as f32;
                    let opacity = item
                        .get("opacity")
                        .and_then(|v| v.as_f64())
                        .unwrap_or(1.0) as f32;
                    let fill_str = item
                        .get("fill")
                        .and_then(|v| v.as_str())
                        .unwrap_or("#ffffff");

                    let (r, g, b, a) = parse_color(fill_str).unwrap_or((1.0, 1.0, 1.0, 1.0));
                    let color = [
                        srgb_to_linear(r),
                        srgb_to_linear(g),
                        srgb_to_linear(b),
                        a * opacity,
                    ];

                    let matrix: [f32; 6] = if let Some(m_arr) =
                        item.get("matrix").and_then(|v| v.as_array())
                    {
                        if m_arr.len() == 6 {
                            [
                                m_arr[0].as_f64().unwrap_or(1.0) as f32,
                                m_arr[1].as_f64().unwrap_or(0.0) as f32,
                                m_arr[2].as_f64().unwrap_or(0.0) as f32,
                                m_arr[3].as_f64().unwrap_or(1.0) as f32,
                                m_arr[4].as_f64().unwrap_or(0.0) as f32,
                                m_arr[5].as_f64().unwrap_or(0.0) as f32,
                            ]
                        } else {
                            [1.0, 0.0, 0.0, 1.0, 0.0, 0.0]
                        }
                    } else {
                        [1.0, 0.0, 0.0, 1.0, 0.0, 0.0]
                    };

                    let p0 = apply_affine(matrix, 0.0, 0.0);
                    let p1 = apply_affine(matrix, w, 0.0);
                    let p2 = apply_affine(matrix, w, h);
                    let p3 = apply_affine(matrix, 0.0, h);

                    let tw = target.width as f32;
                    let th = target.height as f32;

                    let ndc0 = to_ndc(p0, tw, th);
                    let ndc1 = to_ndc(p1, tw, th);
                    let ndc2 = to_ndc(p2, tw, th);
                    let ndc3 = to_ndc(p3, tw, th);

                    let v0 = Vertex { position: ndc0, color };
                    let v1 = Vertex { position: ndc1, color };
                    let v2 = Vertex { position: ndc2, color };
                    let v3 = Vertex { position: ndc3, color };

                    // Two triangles: (v0, v1, v2) and (v0, v2, v3)
                    vertices.push(v0);
                    vertices.push(v1);
                    vertices.push(v2);

                    vertices.push(v0);
                    vertices.push(v2);
                    vertices.push(v3);
                }
            }
        }

        let mut encoder = device.create_command_encoder(&wgpu::CommandEncoderDescriptor {
            label: Some("Liosvideo Render Encoder"),
        });

        {
            let mut rpass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("Liosvideo Render Pass"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: &target.view,
                    resolve_target: None,
                    ops: wgpu::Operations {
                        load: wgpu::LoadOp::Clear(clear_color),
                        store: wgpu::StoreOp::Store,
                    },
                })],
                depth_stencil_attachment: None,
                timestamp_writes: None,
                occlusion_query_set: None,
            });

            if !vertices.is_empty() {
                let vertex_buffer =
                    device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
                        label: Some("Liosvideo Vertex Buffer"),
                        contents: bytemuck::cast_slice(&vertices),
                        usage: wgpu::BufferUsages::VERTEX,
                    });

                rpass.set_pipeline(&self.pipeline);
                rpass.set_vertex_buffer(0, vertex_buffer.slice(..));
                rpass.draw(0..vertices.len() as u32, 0..1);
            }
        }

        queue.submit(Some(encoder.finish()));
        Ok(())
    }
}

fn apply_affine(m: [f32; 6], x: f32, y: f32) -> (f32, f32) {
    (m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5])
}

fn to_ndc(p: (f32, f32), width: f32, height: f32) -> [f32; 2] {
    let ndc_x = (p.0 / width) * 2.0 - 1.0;
    let ndc_y = 1.0 - (p.1 / height) * 2.0;
    [ndc_x, ndc_y]
}

pub fn parse_color(hex: &str) -> Result<(f32, f32, f32, f32)> {
    let mut h = hex.trim_start_matches('#');
    let expanded;
    if h.len() == 3 || h.len() == 4 {
        expanded = h.chars().flat_map(|c| [c, c]).collect::<String>();
        h = &expanded;
    }
    let mut hex_str = h.to_string();
    if hex_str.len() == 6 {
        hex_str.push_str("ff");
    }
    if hex_str.len() != 8 {
        return Err(anyhow!("Invalid hex color: {hex}"));
    }
    let r = u8::from_str_radix(&hex_str[0..2], 16)? as f32 / 255.0;
    let g = u8::from_str_radix(&hex_str[2..4], 16)? as f32 / 255.0;
    let b = u8::from_str_radix(&hex_str[4..6], 16)? as f32 / 255.0;
    let a = u8::from_str_radix(&hex_str[6..8], 16)? as f32 / 255.0;
    Ok((r, g, b, a))
}

pub fn srgb_to_linear(c: f32) -> f32 {
    if c <= 0.04045 {
        c / 12.92
    } else {
        ((c + 0.055) / 1.055).powf(2.4)
    }
}
