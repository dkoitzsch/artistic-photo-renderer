// Mischt Effekt-Ausgang und Eingang: Mischmodus (normal = ersetzen, sonst Effekt über dem Eingang),
// danach Gewicht = strength · Wirkbereich (whole / focus-weighted / inverse-focus) · Effektmaske.

struct MixParams {
  weight: f32,
  region: u32,   // 0 = whole, 1 = focus-weighted, 2 = inverse-focus
  mode: u32,     // Mischmodus (blendmodes.wgsl)
  has_mask: u32, // 1 = Effektmaske (r) verwenden
}

@group(0) @binding(0) var<uniform> mp: MixParams;
@group(0) @binding(1) var base: texture_2d<f32>;
@group(0) @binding(2) var fx: texture_2d<f32>;
@group(0) @binding(3) var focus_tex: texture_2d<f32>;
@group(0) @binding(4) var dst: texture_storage_2d<rgba16float, write>;
@group(0) @binding(5) var mask_tex: texture_2d<f32>;

fn aux_at(t: texture_2d<f32>, p: vec2i, size: vec2u) -> f32 {
  let ts = vec2f(textureDimensions(t));
  let uv = (vec2f(p) + 0.5) / vec2f(size);
  return textureLoad(t, vec2i(clamp(uv * ts, vec2f(0.0), ts - 1.0)), 0).r;
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3u) {
  let size = textureDimensions(dst);
  if (id.x >= size.x || id.y >= size.y) { return; }
  let p = vec2i(id.xy);
  var w = mp.weight;
  if (mp.region != 0u) {
    let f = aux_at(focus_tex, p, size);
    w *= select(1.0 - f, f, mp.region == 1u);
  }
  if (mp.has_mask != 0u) { w *= clamp(aux_at(mask_tex, p, size), 0.0, 1.0); }
  let b = textureLoad(base, p, 0);
  var e = textureLoad(fx, p, 0);
  if (mp.mode != 0u) { e = composite(b, e, mp.mode); }
  textureStore(dst, p, mix(b, e, w));
}
