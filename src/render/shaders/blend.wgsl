// Compositor: legt einen Layer (linear, vormultipliziert) mit Deckkraft und Mischmodus über die Basis.
// Kontrast-Mischmodi rechnen auf sRGB-kodierten Werten (W3C Compositing; siehe DECISIONS.md),
// das Alpha-Compositing bleibt linear: co = cs·(1−αb) + cb·(1−αs) + αs·αb·B(Cb, Cs)

struct BlendParams {
  opacity: f32,
  mode: u32,     // 0 normal, 1 multiply, 2 screen, 3 overlay, 4 soft-light, 5 lighten, 6 darken, 7 difference
  has_base: u32,
  _p: f32,
}

@group(0) @binding(0) var<uniform> bp: BlendParams;
@group(0) @binding(1) var base: texture_2d<f32>;
@group(0) @binding(2) var layer: texture_2d<f32>;
@group(0) @binding(3) var dst: texture_storage_2d<rgba16float, write>;

fn soft_light_ch(b: f32, s: f32) -> f32 {
  if (s <= 0.5) { return b - (1.0 - 2.0 * s) * b * (1.0 - b); }
  var d = sqrt(b);
  if (b <= 0.25) { d = ((16.0 * b - 12.0) * b + 4.0) * b; }
  return b + (2.0 * s - 1.0) * (d - b);
}

fn overlay_ch(b: f32, s: f32) -> f32 {
  if (b <= 0.5) { return 2.0 * b * s; }
  return 1.0 - 2.0 * (1.0 - b) * (1.0 - s);
}

fn mix_mode(b: vec3f, s: vec3f, mode: u32) -> vec3f {
  switch mode {
    case 1u: { return b * s; }
    case 2u: { return b + s - b * s; }
    case 3u: { return vec3f(overlay_ch(b.r, s.r), overlay_ch(b.g, s.g), overlay_ch(b.b, s.b)); }
    case 4u: { return vec3f(soft_light_ch(b.r, s.r), soft_light_ch(b.g, s.g), soft_light_ch(b.b, s.b)); }
    case 5u: { return max(b, s); }
    case 6u: { return min(b, s); }
    case 7u: { return abs(b - s); }
    default: { return s; }
  }
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3u) {
  let size = textureDimensions(dst);
  if (id.x >= size.x || id.y >= size.y) { return; }
  let p = vec2i(id.xy);
  let l = textureLoad(layer, p, 0) * bp.opacity;
  var b = vec4f(0.0);
  if (bp.has_base != 0u) { b = textureLoad(base, p, 0); }
  if (bp.mode == 0u || b.a <= 0.0 || l.a <= 0.0) {
    textureStore(dst, p, l + b * (1.0 - l.a));
    return;
  }
  let cb = linear_to_srgb(clamp(b.rgb / b.a, vec3f(0.0), vec3f(1.0)));
  let cs = linear_to_srgb(clamp(l.rgb / l.a, vec3f(0.0), vec3f(1.0)));
  let mixed = srgb_to_linear(clamp(mix_mode(cb, cs, bp.mode), vec3f(0.0), vec3f(1.0)));
  let rgb = l.rgb * (1.0 - b.a) + b.rgb * (1.0 - l.a) + l.a * b.a * mixed;
  textureStore(dst, p, vec4f(rgb, l.a + b.a * (1.0 - l.a)));
}
