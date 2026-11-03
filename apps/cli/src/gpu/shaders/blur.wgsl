// One direction of a separable Gaussian blur. Prepended with common.wgsl.
struct BlurU { dir: vec2f, sigma: f32, radius: f32 };

@group(0) @binding(0) var<uniform> u: BlurU;
@group(0) @binding(1) var src: texture_2d<f32>;

@fragment fn fs(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let dims = vec2i(textureDimensions(src));
  let c = vec2i(pos.xy);
  let r = i32(u.radius);
  var sum = vec4f(0.0);
  var wsum = 0.0;
  for (var i = -r; i <= r; i++) {
    let w = exp(-f32(i * i) / (2.0 * u.sigma * u.sigma));
    let p = clamp(c + vec2i(u.dir) * i, vec2i(0), dims - 1);
    sum += textureLoad(src, p, 0) * w;
    wsum += w;
  }
  return sum / wsum;
}
