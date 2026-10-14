// Linsenunschärfe (Gather): pro Pixel Abtastung innerhalb einer Scheibe bzw. eines Sechsecks mit
// Radius aus Fokuskarte; Lichter werden stärker gewichtet (Bokeh). Große Radien auf verkleinerter Stufe.

const SAMPLES: u32 = 112u;
const GOLDEN: f32 = 2.39996323;

@compute @workgroup_size(8, 8)
fn down(@builtin(global_invocation_id) id: vec3u) {
  let size = textureDimensions(dst);
  if (id.x >= size.x || id.y >= size.y) { return; }
  let p = vec2i(id.xy) * 2;
  let c = load_src(p) + load_src(p + vec2i(1, 0)) + load_src(p + vec2i(0, 1)) + load_src(p + vec2i(1, 1));
  textureStore(dst, id.xy, c * 0.25);
}

fn radius_at(p: vec2i, factor: f32) -> f32 {
  let s = focus_sharpness(p, params.focusSoftness / 100.0);
  return mix(params.radius, params.radius * params.focusBlur / 100.0, s) / factor;
}

// Sechseck: Polarkoordinaten-Verzerrung der Scheibe
fn hex_scale(theta: f32) -> f32 {
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
  let r = radius_at(p, pass_data.v0.x);
  if (r < 0.5) {
    textureStore(dst, p, load_src(p));
    return;
  }
  let inv = 1.0 / vec2f(src_size());
  let center = (vec2f(p) + 0.5) * inv;
  let boost = params.highlights / 100.0 * 6.0;
  let th = params.threshold / 100.0;
  var sum = vec4f(0.0);
  var wsum = 0.0;
  for (var i = 0u; i < SAMPLES; i++) {
    let t = (f32(i) + 0.5) / f32(SAMPLES);
    let theta = f32(i) * GOLDEN;
    var rr = sqrt(t) * r;
    if (params.shape == 1u) { rr *= hex_scale(theta); }
    let uv = center + vec2f(cos(theta), sin(theta)) * rr * inv;
    let c = sample_src(uv);
    var w = 1.0;
    if (boost > 0.0 && c.a > 0.0) {
      let l = linear_to_srgb(vec3f(luminance(c.rgb / c.a))).r;
      w += boost * smoothstep(th, 1.0, l);
    }
    sum += c * w;
    wsum += w;
  }
  textureStore(dst, p, sum / wsum);
}

// Hochskalieren und mit dem Original mischen, wo der Radius klein ist. src = Stufe, src_b = Original
@compute @workgroup_size(8, 8)
fn compose(@builtin(global_invocation_id) id: vec3u) {
  let size = textureDimensions(dst);
  if (id.x >= size.x || id.y >= size.y) { return; }
  let p = vec2i(id.xy);
  let f = pass_data.v0.x;
  let uv = (vec2f(p) + 0.5) / vec2f(size);
  let blurred = textureSampleLevel(src, linear_sampler, uv, 0.0);
  let original = textureLoad(src_b, p, 0);
  // Radius in voller Auflösung; unter ~1,5 Stufen-Pixeln zum Original überblenden
  let s = focus_sharpness_full(p, size);
  let r = mix(params.radius, params.radius * params.focusBlur / 100.0, s);
  let t = clamp(r / (1.5 * f), 0.0, 1.0);
  textureStore(dst, p, mix(original, blurred, t));
}

fn focus_sharpness_full(p: vec2i, size: vec2u) -> f32 {
  if (!has_focus()) { return 0.0; }
  let fs = vec2f(textureDimensions(focus_tex));
  let uv = (vec2f(p) + 0.5) / vec2f(size);
  let v = textureLoad(focus_tex, vec2i(clamp(uv * fs, vec2f(0.0), fs - 1.0)), 0).r;
  return smoothstep(0.0, max(params.focusSoftness / 100.0, 1e-3), v);
}
