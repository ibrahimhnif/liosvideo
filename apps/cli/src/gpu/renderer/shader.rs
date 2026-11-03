// Real WGSL execution for `shader(...)` nodes.
//
// Contract (documented in the CLI skill):
//   * user code defines `@fragment fn fs(@location(0) uv: vec2f) -> @location(0) vec4f`
//   * the CLI prepends a fullscreen vertex shader and these bindings:
//       @group(0) @binding(0) var<uniform> u_globals: LiosGlobals;
//         u_globals.time       -> vec4(time_seconds, progress, 0, 0)
//         u_globals.resolution -> vec4(width_px, height_px, 0, 0)
//       @group(0) @binding(1) var<uniform> u: LiosUniforms;
//         one `vec4f` field per `uniforms` key, in sorted-key order
//   * a scalar `speed: 1.5` becomes `u.speed.x`; arrays fill x/y/z/w
//
// The result is rendered into an offscreen rgba8unorm texture and composited as a
// textured quad, so transforms, opacity, blur and clips behave like every other node.

use std::collections::hash_map::DefaultHasher;
use std::collections::HashMap;
use std::hash::{Hash, Hasher};

use serde_json::{Map, Value};

use super::LAYER_FORMAT;

const MAX_UNIFORMS: usize = 64;

pub struct ShaderRenderer {
    pipelines: HashMap<u64, Option<wgpu::RenderPipeline>>,
    warned: HashMap<u64, ()>,
}

pub struct ShaderTexture {
    pub texture: wgpu::Texture,
}

impl Default for ShaderRenderer {
    fn default() -> Self {
        Self::new()
    }
}

impl ShaderRenderer {
    pub fn new() -> Self {
        Self {
            pipelines: HashMap::new(),
            warned: HashMap::new(),
        }
    }

    /// Render `code` into a fresh texture at `width_px` x `height_px`.
    #[allow(clippy::too_many_arguments)]
    pub fn render(
        &mut self,
        device: &wgpu::Device,
        queue: &wgpu::Queue,
        code: &str,
        uniforms: Option<&Map<String, Value>>,
        width_px: u32,
        height_px: u32,
        time: f32,
        progress: f32,
    ) -> Option<ShaderTexture> {
        let width_px = width_px.max(1);
        let height_px = height_px.max(1);

        let empty = Map::new();
        let uniforms = uniforms.unwrap_or(&empty);
        let keys: Vec<String> = uniforms
            .keys()
            .filter(|k| is_identifier(k))
            .take(MAX_UNIFORMS)
            .cloned()
            .collect();

        let source = build_source(code, &keys);
        let mut hasher = DefaultHasher::new();
        source.hash(&mut hasher);
        let key = hasher.finish();

        if contains_binding_decl(code) {
            if self.warned.insert(key, ()).is_none() {
                eprintln!(
                    "Warning: shader declares its own @group/@binding; use u_globals and u instead"
                );
            }
            return None;
        }

        let pipeline = match self.pipelines.entry(key) {
            std::collections::hash_map::Entry::Occupied(entry) => entry.into_mut(),
            std::collections::hash_map::Entry::Vacant(entry) => {
                let built = build_pipeline(device, &source);
                if built.is_none() && self.warned.insert(key, ()).is_none() {
                    eprintln!("Warning: shader failed to compile or validate; drawing a white box");
                }
                entry.insert(built)
            }
        };
        let pipeline = pipeline.as_ref()?;

        let mut globals = [0.0f32; 8];
        globals[0] = time;
        globals[1] = progress;
        globals[4] = width_px as f32;
        globals[5] = height_px as f32;
        let globals_buffer = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("liosvideo shader globals"),
            size: 32,
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        queue.write_buffer(&globals_buffer, 0, bytemuck::cast_slice(&globals));

        let mut values = vec![0.0f32; 4 * keys.len().max(1)];
        for (index, name) in keys.iter().enumerate() {
            let slot = &mut values[index * 4..index * 4 + 4];
            match uniforms.get(name) {
                Some(Value::Number(n)) => slot[0] = n.as_f64().unwrap_or(0.0) as f32,
                Some(Value::Array(items)) => {
                    for (i, item) in items.iter().take(4).enumerate() {
                        slot[i] = item.as_f64().unwrap_or(0.0) as f32;
                    }
                }
                Some(Value::Bool(b)) => slot[0] = if *b { 1.0 } else { 0.0 },
                _ => {}
            }
        }
        let user_buffer = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("liosvideo shader uniforms"),
            size: (values.len() * 4) as u64,
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        queue.write_buffer(&user_buffer, 0, bytemuck::cast_slice(&values));

        let bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("liosvideo shader bind"),
            layout: &pipeline.get_bind_group_layout(0),
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: globals_buffer.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: user_buffer.as_entire_binding(),
                },
            ],
        });

        let texture = device.create_texture(&wgpu::TextureDescriptor {
            label: Some("liosvideo shader target"),
            size: wgpu::Extent3d {
                width: width_px,
                height: height_px,
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
        });
        let view = texture.create_view(&wgpu::TextureViewDescriptor::default());

        let mut encoder = device.create_command_encoder(&wgpu::CommandEncoderDescriptor {
            label: Some("liosvideo shader encoder"),
        });
        {
            let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("liosvideo shader pass"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: &view,
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
            pass.set_bind_group(0, &bind_group, &[]);
            pass.draw(0..3, 0..1);
        }
        queue.submit(Some(encoder.finish()));

        Some(ShaderTexture { texture })
    }
}

fn build_pipeline(device: &wgpu::Device, source: &str) -> Option<wgpu::RenderPipeline> {
    // Validate on the CPU first: wgpu panics on uncaptured validation errors.
    let module = naga::front::wgsl::parse_str(source).ok()?;
    let mut validator = naga::valid::Validator::new(
        naga::valid::ValidationFlags::all(),
        naga::valid::Capabilities::all(),
    );
    validator.validate(&module).ok()?;

    let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
        label: Some("liosvideo user shader"),
        source: wgpu::ShaderSource::Wgsl(source.into()),
    });

    let pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
        label: Some("liosvideo user shader pipeline"),
        layout: None,
        vertex: wgpu::VertexState {
            module: &shader,
            entry_point: Some("lios_vs_main"),
            compilation_options: Default::default(),
            buffers: &[],
        },
        fragment: Some(wgpu::FragmentState {
            module: &shader,
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
    Some(pipeline)
}

fn build_source(code: &str, keys: &[String]) -> String {
    let mut uniform_fields = String::new();
    if keys.is_empty() {
        uniform_fields.push_str("    _unused: vec4<f32>,\n");
    } else {
        for key in keys {
            uniform_fields.push_str(&format!("    {key}: vec4<f32>,\n"));
        }
    }

    format!(
        r#"struct LiosGlobals {{
    time: vec4<f32>,
    resolution: vec4<f32>,
}};
@group(0) @binding(0) var<uniform> u_globals: LiosGlobals;

struct LiosUniforms {{
{uniform_fields}}};
@group(0) @binding(1) var<uniform> u: LiosUniforms;

struct LiosVSOut {{
    @builtin(position) position: vec4<f32>,
    @location(0) uv: vec2<f32>,
}};

@vertex
fn lios_vs_main(@builtin(vertex_index) vi: u32) -> LiosVSOut {{
    var corners = array<vec2<f32>, 3>(
        vec2<f32>(-1.0, -1.0),
        vec2<f32>(3.0, -1.0),
        vec2<f32>(-1.0, 3.0)
    );
    let corner = corners[vi];
    var out: LiosVSOut;
    out.position = vec4<f32>(corner, 0.0, 1.0);
    out.uv = vec2<f32>((corner.x + 1.0) * 0.5, 1.0 - (corner.y + 1.0) * 0.5);
    return out;
}}

// ---- user shader ----
{code}
"#
    )
}

fn contains_binding_decl(code: &str) -> bool {
    code.contains("@group")
}

fn is_identifier(value: &str) -> bool {
    let mut chars = value.chars();
    match chars.next() {
        Some(c) if c.is_ascii_alphabetic() || c == '_' => {}
        _ => return false,
    }
    chars.all(|c| c.is_ascii_alphanumeric() || c == '_')
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generates_fullscreen_preamble_and_uniform_struct() {
        let source = build_source(
            "@fragment fn fs(@location(0) uv: vec2f) -> @location(0) vec4f { return vec4f(uv, 0.0, 1.0); }",
            &["speed".to_string(), "tint".to_string()],
        );
        assert!(source.contains("fn lios_vs_main"));
        assert!(source.contains("speed: vec4<f32>"));
        assert!(source.contains("tint: vec4<f32>"));
        assert!(source.contains("@fragment fn fs"));
    }

    #[test]
    fn validates_generated_shader() {
        let source = build_source(
            "@fragment fn fs(@location(0) uv: vec2f) -> @location(0) vec4f { let t = u_globals.time.x; return vec4f(uv * t, 0.0, 1.0); }",
            &["speed".to_string()],
        );
        let module = naga::front::wgsl::parse_str(&source).expect("parses");
        let mut validator = naga::valid::Validator::new(
            naga::valid::ValidationFlags::all(),
            naga::valid::Capabilities::all(),
        );
        validator.validate(&module).expect("validates");
    }

    #[test]
    fn rejects_identifiers() {
        assert!(is_identifier("speed"));
        assert!(is_identifier("_x1"));
        assert!(!is_identifier("1speed"));
        assert!(!is_identifier("has space"));
    }
}
