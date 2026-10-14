// Guided Filter (He et al.) zum kantenbewussten Hochskalieren einer Maske mit dem Bild als Führung.
// pack: (I, p, I², I·p) → box → coeffs: (a, b) → box → apply: q = mean_a · I + mean_b

struct GF {
  dir: vec2f,
  radius: f32,
  eps: f32,
}

@group(0) @binding(0) var<uniform> gf: GF;
@group(0) @binding(1) var src_a: texture_2d<f32>;   // pack: Bild (linear, vormultipliziert); sonst Eingang
@group(0) @binding(2) var src_b: texture_2d<f32>;   // pack: grobe Maske; apply: Bild
@group(0) @binding(3) var samp: sampler;
@group(0) @binding(4) var dst: texture_storage_2d<rgba16float, write>;

fn guide(c: vec4f) -> f32 {
  // Führungsgröße: wahrnehmungsnahe Helligkeit
  let l = dot(c.rgb, vec3f(0.2126, 0.7152, 0.0722));
  return pow(max(l, 0.0), 1.0 / 2.2);
}

@compute @workgroup_size(8, 8)
fn pack(@builtin(global_invocation_id) id: vec3u) {
  let size = textureDimensions(dst);
  if (id.x >= size.x || id.y >= size.y) { return; }
  let I = guide(textureLoad(src_a, vec2i(id.xy), 0));
  let uv = (vec2f(id.xy) + 0.5) / vec2f(size);
  let p = textureSampleLevel(src_b, samp, uv, 0.0).r;
  textureStore(dst, id.xy, vec4f(I, p, I * I, I * p));
}

@compute @workgroup_size(8, 8)
fn box(@builtin(global_invocation_id) id: vec3u) {
  let size = textureDimensions(dst);
  if (id.x >= size.x || id.y >= size.y) { return; }
  let r = i32(gf.radius);
  let dir = vec2i(gf.dir);
  let p = vec2i(id.xy);
  let smax = vec2i(size) - vec2i(1);
  var sum = vec4f(0.0);
  for (var i = -r; i <= r; i++) {
    sum += textureLoad(src_a, clamp(p + dir * i, vec2i(0), smax), 0);
  }
  textureStore(dst, id.xy, sum / f32(2 * r + 1));
}

@compute @workgroup_size(8, 8)
fn coeffs(@builtin(global_invocation_id) id: vec3u) {
  let size = textureDimensions(dst);
  if (id.x >= size.x || id.y >= size.y) { return; }
  let m = textureLoad(src_a, vec2i(id.xy), 0);
  let var_i = m.z - m.x * m.x;
  let cov = m.w - m.x * m.y;
  let a = cov / (var_i + gf.eps);
  let b = m.y - a * m.x;
  textureStore(dst, id.xy, vec4f(a, b, 0.0, 1.0));
}

@compute @workgroup_size(8, 8)
fn apply(@builtin(global_invocation_id) id: vec3u) {
  let size = textureDimensions(dst);
  if (id.x >= size.x || id.y >= size.y) { return; }
  let ab = textureLoad(src_a, vec2i(id.xy), 0);
  let I = guide(textureLoad(src_b, vec2i(id.xy), 0));
  let q = clamp(ab.x * I + ab.y, 0.0, 1.0);
  textureStore(dst, id.xy, vec4f(q, q, q, 1.0));
}
