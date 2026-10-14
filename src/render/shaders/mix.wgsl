// Mischt Effekt-Ausgang und Eingang nach strength und region (whole / focus-weighted / inverse-focus).

struct MixParams {
  weight: f32,
  region: u32, // 0 = whole, 1 = focus-weighted, 2 = inverse-focus
  _p0: f32,
  _p1: f32,
}

@group(0) @binding(0) var<uniform> mp: MixParams;
@group(0) @binding(1) var base: texture_2d<f32>;
@group(0) @binding(2) var fx: texture_2d<f32>;
@group(0) @binding(3) var focus_tex: texture_2d<f32>;
@group(0) @binding(4) var dst: texture_storage_2d<rgba16float, write>;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3u) {
  let size = textureDimensions(dst);
  if (id.x >= size.x || id.y >= size.y) { return; }
  let p = vec2i(id.xy);
  var w = mp.weight;
  if (mp.region != 0u) {
    let fs = vec2f(textureDimensions(focus_tex));
    let uv = (vec2f(p) + 0.5) / vec2f(size);
    let f = textureLoad(focus_tex, vec2i(clamp(uv * fs, vec2f(0.0), fs - 1.0)), 0).r;
    w *= select(1.0 - f, f, mp.region == 1u);
  }
  textureStore(dst, p, mix(textureLoad(base, p, 0), textureLoad(fx, p, 0), w));
}
