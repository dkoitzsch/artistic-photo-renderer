// Platziert eine Ebene (Ebenen-Textur) per affiner Abbildung auf der Leinwand (Ausschnitt in Render-px).
// m/t: Render-px → Texel der Ebenen-Textur. Außerhalb des Bildes transparent; Kanten über ein Ziel-Pixel geglättet.
// Beim Verkleinern (mehr als ~1,25 Texel pro Pixel) werden 4 Proben gemittelt.

struct Warp {
  m: vec4f,       // a, b, c, d: l.x = a·r.x + c·r.y + e, l.y = b·r.x + d·r.y + f
  t: vec2f,       // e, f
  origin: vec2f,  // Lage des Ausschnitts in Render-px
  size: vec2f,    // Größe der Ebenen-Textur in Texeln
  _pad: vec2f,
}

@group(0) @binding(0) var<uniform> u: Warp;
@group(0) @binding(1) var src: texture_2d<f32>;
@group(0) @binding(2) var samp: sampler;
@group(0) @binding(3) var dst: texture_storage_2d<rgba16float, write>;

fn to_local(r: vec2f) -> vec2f {
  return vec2f(u.m.x * r.x + u.m.z * r.y, u.m.y * r.x + u.m.w * r.y) + u.t;
}

fn tap(r: vec2f) -> vec4f {
  return textureSampleLevel(src, samp, to_local(r) / u.size, 0.0);
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3u) {
  let dsize = textureDimensions(dst);
  if (id.x >= dsize.x || id.y >= dsize.y) { return; }
  let r = u.origin + vec2f(id.xy) + 0.5;
  let l = to_local(r);
  // Texel pro Ziel-Pixel je Achse der Ebene
  let k = vec2f(length(vec2f(u.m.x, u.m.z)), length(vec2f(u.m.y, u.m.w)));
  let inside = min(l, u.size - l) / max(k, vec2f(1e-6));
  let cov = clamp(inside.x + 0.5, 0.0, 1.0) * clamp(inside.y + 0.5, 0.0, 1.0);
  if (cov <= 0.0) {
    textureStore(dst, id.xy, vec4f(0.0));
    return;
  }
  var c: vec4f;
  if (max(k.x, k.y) > 1.25) {
    c = 0.25 * (tap(r + vec2f(-0.25, -0.25)) + tap(r + vec2f(0.25, -0.25)) +
                tap(r + vec2f(-0.25, 0.25)) + tap(r + vec2f(0.25, 0.25)));
  } else {
    c = tap(r);
  }
  textureStore(dst, id.xy, c * cov);
}
