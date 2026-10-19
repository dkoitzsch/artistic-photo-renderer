// Analysekarten (Spec „Effekte“, Abschnitt 4): Kanten aus der Helligkeit.
//   tensor: Sobel-Gradient der Helligkeit (r) → Strukturtensor (E, F, G) in rgb
//   edges:  aus geglättetem Tensor (src) und Helligkeit (src_b):
//           r = Kantenstärke (|∇L| je Original-px · 8, begrenzt auf 1)
//           g, b = Kantentangente (Richtung entlang der Kante) als 0.5 + 0.5·t
//           a = Kohärenz (λ1 − λ2) / (λ1 + λ2): 0 = keine Vorzugsrichtung, 1 = klare Kante
// Gradienten werden je Original-px angegeben (px_scale = Texel pro Original-px), damit Vorschau und Export gleich skalieren.

struct A {
  px_scale: f32,
  _p0: f32,
  _p1: f32,
  _p2: f32,
}

@group(0) @binding(0) var<uniform> a: A;
@group(0) @binding(1) var src: texture_2d<f32>;
@group(0) @binding(2) var src_b: texture_2d<f32>;
@group(0) @binding(3) var dst: texture_storage_2d<rgba16float, write>;

fn lum(t: texture_2d<f32>, p: vec2i) -> f32 {
  let size = vec2i(textureDimensions(t));
  return textureLoad(t, clamp(p, vec2i(0), size - vec2i(1)), 0).r;
}

/** Sobel-Gradient je Original-px */
fn sobel(t: texture_2d<f32>, p: vec2i) -> vec2f {
  let tl = lum(t, p + vec2i(-1, -1));
  let tc = lum(t, p + vec2i(0, -1));
  let tr = lum(t, p + vec2i(1, -1));
  let ml = lum(t, p + vec2i(-1, 0));
  let mr = lum(t, p + vec2i(1, 0));
  let bl = lum(t, p + vec2i(-1, 1));
  let bc = lum(t, p + vec2i(0, 1));
  let br = lum(t, p + vec2i(1, 1));
  let gx = (tr + 2.0 * mr + br - tl - 2.0 * ml - bl) / 8.0;
  let gy = (bl + 2.0 * bc + br - tl - 2.0 * tc - tr) / 8.0;
  return vec2f(gx, gy) * a.px_scale;
}

@compute @workgroup_size(8, 8)
fn tensor(@builtin(global_invocation_id) id: vec3u) {
  let size = textureDimensions(dst);
  if (id.x >= size.x || id.y >= size.y) { return; }
  let g = sobel(src, vec2i(id.xy));
  textureStore(dst, id.xy, vec4f(g.x * g.x, g.x * g.y, g.y * g.y, 1.0));
}

@compute @workgroup_size(8, 8)
fn edges(@builtin(global_invocation_id) id: vec3u) {
  let size = textureDimensions(dst);
  if (id.x >= size.x || id.y >= size.y) { return; }
  let p = vec2i(id.xy);
  let j = textureLoad(src, p, 0);
  let e = j.r;
  let f = j.g;
  let g = j.b;
  let d = sqrt(max((e - g) * (e - g) + 4.0 * f * f, 0.0));
  let l1 = 0.5 * (e + g + d);
  let l2 = 0.5 * (e + g - d);
  var t = vec2f(l1 - e, -f);
  let tl = length(t);
  if (tl > 1e-12) {
    t = t / tl;
  } else {
    t = vec2f(0.0, 1.0);
  }
  let coherence = select(0.0, (l1 - l2) / (l1 + l2), l1 + l2 > 1e-12);
  let strength = clamp(length(sobel(src_b, p)) * 8.0, 0.0, 1.0);
  textureStore(dst, id.xy, vec4f(strength, 0.5 + 0.5 * t.x, 0.5 + 0.5 * t.y, coherence));
}

// flow: Richtungsfeld für Striche (Spec „Effekte“ 4, Edge Tangent Flow über geglättete Strukturtensoren).
//   src = Tensor geglättet mit σ = 6, src_b = Tensor geglättet mit σ = 24 (Original-px); J = J6 + ¼·J24:
//   nah an Kanten folgt die Richtung der Kante, in ruhigen Flächen setzt sich die großräumige Richtung fort.
//   r = Feldstärke (√λ1 · 8, begrenzt), gb = Tangente (0.5 + 0.5·t), a = Kohärenz
@compute @workgroup_size(8, 8)
fn flow(@builtin(global_invocation_id) id: vec3u) {
  let size = textureDimensions(dst);
  if (id.x >= size.x || id.y >= size.y) { return; }
  let p = vec2i(id.xy);
  let j = textureLoad(src, p, 0).rgb + 0.25 * textureLoad(src_b, p, 0).rgb;
  let e = j.r;
  let f = j.g;
  let g = j.b;
  let d = sqrt(max((e - g) * (e - g) + 4.0 * f * f, 0.0));
  let l1 = 0.5 * (e + g + d);
  let l2 = 0.5 * (e + g - d);
  var t = vec2f(l1 - e, -f);
  let tl = length(t);
  if (tl > 1e-12) {
    t = t / tl;
  } else {
    t = vec2f(0.0, 1.0);
  }
  let coherence = select(0.0, (l1 - l2) / (l1 + l2), l1 + l2 > 1e-12);
  let strength = clamp(sqrt(max(l1, 0.0)) * 8.0, 0.0, 1.0);
  textureStore(dst, id.xy, vec4f(strength, 0.5 + 0.5 * t.x, 0.5 + 0.5 * t.y, coherence));
}

// normals: Oberflächennormale aus der (geglätteten) Tiefe in src (r: 0 = nah, 1 = fern).
//   Höhe = 1 − Tiefe; a.px_scale = Reliefmaßstab in Texeln (Tiefe 0…1 entspricht so vielen Texeln).
//   rgb = Normale (x rechts, y unten, z zum Betrachter), a = 1.
@compute @workgroup_size(8, 8)
fn normals(@builtin(global_invocation_id) id: vec3u) {
  let size = textureDimensions(dst);
  if (id.x >= size.x || id.y >= size.y) { return; }
  let p = vec2i(id.xy);
  let g = sobel(src, p) / a.px_scale; // sobel skaliert mit px_scale – hier ungewünscht
  let n = normalize(vec3f(g.x * a.px_scale, g.y * a.px_scale, 1.0));
  textureStore(dst, id.xy, vec4f(n, 1.0));
}

// pack: r aus src, g aus src_b (Salienz und Gesichter in einer Textur)
@compute @workgroup_size(8, 8)
fn pack(@builtin(global_invocation_id) id: vec3u) {
  let size = textureDimensions(dst);
  if (id.x >= size.x || id.y >= size.y) { return; }
  let p = vec2i(id.xy);
  textureStore(dst, id.xy, vec4f(lum(src, p), lum(src_b, p), 0.0, 1.0));
}
