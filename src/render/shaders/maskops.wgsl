// Masken-Operationen (Kanal r): Min/Max (Schrumpfen/Erweitern), Schwelle, Kurve, Invertieren, Kanal-Kopie,
// Tiefenband aus einer Tiefenkarte.

struct M {
  dir: vec2f,
  radius: f32,
  mode: u32,     // minmax: 0 = max (erweitern), 1 = min (schrumpfen)
  invert: u32,   // load: 1 = 1 − Wert
  curve: u32,    // 0 linear, 1 weich, 2 steil
  _p0: f32,
  _p1: f32,
}

@group(0) @binding(0) var<uniform> m: M;
@group(0) @binding(1) var src: texture_2d<f32>;
@group(0) @binding(2) var dst: texture_storage_2d<rgba16float, write>;

fn value(p: vec2i) -> f32 {
  let size = vec2i(textureDimensions(src));
  return textureLoad(src, clamp(p, vec2i(0), size - vec2i(1)), 0).r;
}

fn put(id: vec2u, v: f32) {
  textureStore(dst, id, vec4f(v, v, v, 1.0));
}

// Bilineares Skalieren + optional invertieren (Maske beliebiger Größe → Zielgröße).
@compute @workgroup_size(8, 8)
fn load(@builtin(global_invocation_id) id: vec3u) {
  let size = textureDimensions(dst);
  if (id.x >= size.x || id.y >= size.y) { return; }
  let s = vec2f(textureDimensions(src));
  let q = (vec2f(id.xy) + 0.5) * s / vec2f(size) - 0.5;
  let i = vec2i(floor(q));
  let f = q - floor(q);
  let a = mix(value(i), value(i + vec2i(1, 0)), f.x);
  let b = mix(value(i + vec2i(0, 1)), value(i + vec2i(1, 1)), f.x);
  var v = clamp(mix(a, b, f.y), 0.0, 1.0);
  if (m.invert != 0u) { v = 1.0 - v; }
  put(id.xy, v);
}

@compute @workgroup_size(8, 8)
fn minmax(@builtin(global_invocation_id) id: vec3u) {
  let size = textureDimensions(dst);
  if (id.x >= size.x || id.y >= size.y) { return; }
  let r = i32(ceil(m.radius));
  let dir = vec2i(m.dir);
  let p = vec2i(id.xy);
  var v = value(p);
  for (var i = -r; i <= r; i++) {
    // Randgewicht für Sub-Pixel-Radien
    let w = clamp(m.radius - f32(abs(i)) + 1.0, 0.0, 1.0);
    let s = value(p + dir * i);
    if (m.mode == 0u) { v = max(v, mix(v, s, w)); } else { v = min(v, mix(v, s, w)); }
  }
  put(id.xy, v);
}

// Kantenhärte 0: binär mit Antialiasing (Schwelle 0,5 über ±0,75 px).
@compute @workgroup_size(8, 8)
fn threshold(@builtin(global_invocation_id) id: vec3u) {
  let size = textureDimensions(dst);
  if (id.x >= size.x || id.y >= size.y) { return; }
  let p = vec2i(id.xy);
  let v = value(p);
  let gx = (value(p + vec2i(1, 0)) - value(p - vec2i(1, 0))) * 0.5;
  let gy = (value(p + vec2i(0, 1)) - value(p - vec2i(0, 1))) * 0.5;
  let w = max(length(vec2f(gx, gy)) * 0.75, 1e-3);
  put(id.xy, smoothstep(0.5 - w, 0.5 + w, v));
}

// Tiefenband [near, far] (dir.x, dir.y) mit weichem Übergang (radius = halbe Breite in Tiefeneinheiten).
// near ≤ 0 bzw. far ≥ 1: keine untere bzw. obere Kante. Tiefenkarte wird bilinear auf dst skaliert.
@compute @workgroup_size(8, 8)
fn band(@builtin(global_invocation_id) id: vec3u) {
  let size = textureDimensions(dst);
  if (id.x >= size.x || id.y >= size.y) { return; }
  let s = vec2f(textureDimensions(src));
  let q = (vec2f(id.xy) + 0.5) * s / vec2f(size) - 0.5;
  let i = vec2i(floor(q));
  let f = q - floor(q);
  let d = mix(mix(value(i), value(i + vec2i(1, 0)), f.x), mix(value(i + vec2i(0, 1)), value(i + vec2i(1, 1)), f.x), f.y);
  let near = m.dir.x;
  let far = m.dir.y;
  let w = max(m.radius, 1e-4);
  var v = 1.0;
  if (near > 0.0) { v *= smoothstep(near - w, near + w, d); }
  if (far < 1.0) { v *= 1.0 - smoothstep(far - w, far + w, d); }
  put(id.xy, v);
}

@compute @workgroup_size(8, 8)
fn curve(@builtin(global_invocation_id) id: vec3u) {
  let size = textureDimensions(dst);
  if (id.x >= size.x || id.y >= size.y) { return; }
  var v = clamp(value(vec2i(id.xy)), 0.0, 1.0);
  if (m.curve == 1u) { v = smoothstep(0.0, 1.0, v); }
  if (m.curve == 2u) { v = smoothstep(0.0, 1.0, smoothstep(0.2, 0.8, v)); }
  put(id.xy, v);
}
