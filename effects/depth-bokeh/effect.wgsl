// Tiefenschärfe (Spec „Effekte“ 5.7): Zerstreuungskreis je Pixel aus dem Abstand der Tiefe zur Fokusebene. Gather mit
// Blendenform; eine Probe zählt nur, wenn ihr eigener Zerstreuungskreis bis zum Pixel reicht (scharfe Bereiche bluten
// nicht in unscharfe aus). Große Radien auf verkleinerter Stufe (wie lens-blur).

const SAMPLES: u32 = 128u;
const GOLDEN: f32 = 2.39996323;

@compute @workgroup_size(8, 8)
fn down(@builtin(global_invocation_id) id: vec3u) {
  let size = textureDimensions(dst);
  if (id.x >= size.x || id.y >= size.y) { return; }
  let p = vec2i(id.xy) * 2;
  let c = load_src(p) + load_src(p + vec2i(1, 0)) + load_src(p + vec2i(0, 1)) + load_src(p + vec2i(1, 1));
  textureStore(dst, id.xy, c * 0.25);
}

/** Tiefe an einer Stelle uv (0..1) der Ausgabe */
fn depth_uv(uv: vec2f) -> f32 {
  return textureSampleLevel(depth_tex, linear_sampler, uv, 0.0).r;
}

/** Zerstreuungskreis in Render-px aus der Tiefe */
fn coc(d: f32) -> f32 {
  let f = params.focus / 100.0;
  let half_range = params.range / 200.0;
  let delta = d - f;
  let a = max(abs(delta) - half_range, 0.0);
  var r = params.radius * smoothstep(0.0, 0.35, a);
  if (delta < 0.0) { r *= params.nearBlur / 100.0; }
  return r;
}

fn shape_scale(theta: f32) -> f32 {
  if (params.shape != 1u) { return 1.0; }
  let seg = 1.04719755; // π/3
  let a = theta - params.rotation;
  let m = a - seg * floor(a / seg) - seg * 0.5;
  return 0.8660254 / cos(m);
}

// pass_data.v0.x = Verkleinerungsfaktor dieser Stufe
@compute @workgroup_size(8, 8)
fn gather(@builtin(global_invocation_id) id: vec3u) {
  let size = textureDimensions(dst);
  if (id.x >= size.x || id.y >= size.y) { return; }
  let p = vec2i(id.xy);
  let f = pass_data.v0.x;
  let inv = 1.0 / vec2f(src_size());
  let center = (vec2f(p) + 0.5) * inv;
  let r = coc(depth_uv(center)) / f;
  if (r < 0.5) {
    textureStore(dst, p, load_src(p));
    return;
  }
  let boost = params.highlights / 100.0 * 6.0;
  let th = params.threshold / 100.0;
  var sum = load_src(p) * 0.05;
  var wsum = 0.05;
  for (var i = 0u; i < SAMPLES; i++) {
    let t = (f32(i) + 0.5) / f32(SAMPLES);
    let theta = f32(i) * GOLDEN;
    var rr = sqrt(t) * r;
    if (params.shape == 2u) { rr = r * (0.72 + 0.28 * sqrt(t)); }
    rr *= shape_scale(theta);
    let uv = center + vec2f(cos(theta), sin(theta)) * rr * inv;
    // Probe zählt, wenn ihr eigener Zerstreuungskreis den Abstand überdeckt
    let rs = coc(depth_uv(uv)) / f;
    var w = smoothstep(rr - 1.0, rr + 0.5, rs);
    let c = sample_src(uv);
    if (boost > 0.0 && c.a > 0.0) {
      let l = linear_to_srgb(vec3f(luminance(c.rgb / c.a))).r;
      w *= 1.0 + boost * smoothstep(th, 1.0, l);
    }
    sum += c * w;
    wsum += w;
  }
  textureStore(dst, p, sum / wsum);
}

// Hochskalieren und mit dem Original mischen, wo der Zerstreuungskreis klein ist. src = Stufe, src_b = Original
@compute @workgroup_size(8, 8)
fn compose(@builtin(global_invocation_id) id: vec3u) {
  let size = textureDimensions(dst);
  if (id.x >= size.x || id.y >= size.y) { return; }
  let p = vec2i(id.xy);
  let f = pass_data.v0.x;
  let uv = (vec2f(p) + 0.5) / vec2f(size);
  let blurred = textureSampleLevel(src, linear_sampler, uv, 0.0);
  let original = textureLoad(src_b, p, 0);
  let t = clamp(coc(depth_uv(uv)) / (1.5 * f), 0.0, 1.0);
  textureStore(dst, p, mix(original, blurred, t));
}
