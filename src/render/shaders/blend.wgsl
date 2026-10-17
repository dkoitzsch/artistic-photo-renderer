// Compositor: legt einen Layer (linear, vormultipliziert) mit Deckkraft und Mischmodus über die Basis
// (Mischmodi in blendmodes.wgsl).

struct BlendParams {
  opacity: f32,
  mode: u32,     // 0 normal, 1 multiply, 2 screen, 3 overlay, 4 soft-light, 5 lighten, 6 darken, 7 difference
  has_base: u32,
  _p: f32,
  offset: vec2f, // Versatz der Ebene in px (Parallax-Vorschau), Ränder werden fortgesetzt
  _q: vec2f,
}

// Ebene an p − offset, bilinear, am Rand geklemmt
fn layer_at(p: vec2i) -> vec4f {
  if (bp.offset.x == 0.0 && bp.offset.y == 0.0) {
    return textureLoad(layer, p, 0);
  }
  let size = vec2i(textureDimensions(layer));
  let q = vec2f(p) - bp.offset;
  let i = vec2i(floor(q));
  let f = q - floor(q);
  let mx = size - vec2i(1);
  let a = textureLoad(layer, clamp(i, vec2i(0), mx), 0);
  let b = textureLoad(layer, clamp(i + vec2i(1, 0), vec2i(0), mx), 0);
  let c = textureLoad(layer, clamp(i + vec2i(0, 1), vec2i(0), mx), 0);
  let d = textureLoad(layer, clamp(i + vec2i(1, 1), vec2i(0), mx), 0);
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

@group(0) @binding(0) var<uniform> bp: BlendParams;
@group(0) @binding(1) var base: texture_2d<f32>;
@group(0) @binding(2) var layer: texture_2d<f32>;
@group(0) @binding(3) var dst: texture_storage_2d<rgba16float, write>;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3u) {
  let size = textureDimensions(dst);
  if (id.x >= size.x || id.y >= size.y) { return; }
  let p = vec2i(id.xy);
  let l = layer_at(p) * bp.opacity;
  var b = vec4f(0.0);
  if (bp.has_base != 0u) { b = textureLoad(base, p, 0); }
  textureStore(dst, p, composite(b, l, bp.mode));
}
