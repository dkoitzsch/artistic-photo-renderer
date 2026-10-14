// Zoom-Unschärfe: Mittelwert entlang der Linie zum Zentrum; Spurlänge = Stärke × Abstand (Fokuskarte mindert).
// Positionen in Leinwand-Koordinaten, damit Export-Kacheln und Vorschau übereinstimmen.

const SAMPLES: i32 = 48;

@compute @workgroup_size(8, 8)
fn down(@builtin(global_invocation_id) id: vec3u) {
  let size = textureDimensions(dst);
  if (id.x >= size.x || id.y >= size.y) { return; }
  let p = vec2i(id.xy) * 2;
  let c = load_src(p) + load_src(p + vec2i(1, 0)) + load_src(p + vec2i(0, 1)) + load_src(p + vec2i(1, 1));
  textureStore(dst, id.xy, c * 0.25);
}

fn amount_at(p: vec2i) -> f32 {
  let s = focus_sharpness(p, params.focusSoftness / 100.0);
  return mix(params.amount, params.amount * params.focusBlur / 100.0, s) / 100.0;
}

// pass_data.v0.x = Verkleinerungsfaktor
@compute @workgroup_size(8, 8)
fn smear(@builtin(global_invocation_id) id: vec3u) {
  let size = textureDimensions(dst);
  if (id.x >= size.x || id.y >= size.y) { return; }
  let p = vec2i(id.xy);
  let f = pass_data.v0.x;
  // Render-px dieser Stufe → Render-px voller Stufe → Leinwand (bei scale)
  let full = (vec2f(p) + 0.5) * f + params.origin;
  let c = vec2f(params.centerX, params.centerY) / 100.0 * params.canvas_size;
  let delta = (c - full) * amount_at(p);
  if (length(delta) / f < 0.5) {
    textureStore(dst, p, load_src(p));
    return;
  }
  let inv = 1.0 / vec2f(src_size());
  let start = (vec2f(p) + 0.5) * inv;
  var sum = vec4f(0.0);
  for (var i = 0; i < SAMPLES; i++) {
    let t = (f32(i) + 0.5) / f32(SAMPLES);
    sum += sample_src(start + delta / f * t * inv);
  }
  textureStore(dst, p, sum / f32(SAMPLES));
}

// src = Stufe, src_b = Original
@compute @workgroup_size(8, 8)
fn compose(@builtin(global_invocation_id) id: vec3u) {
  let size = textureDimensions(dst);
  if (id.x >= size.x || id.y >= size.y) { return; }
  let p = vec2i(id.xy);
  let f = pass_data.v0.x;
  let uv = (vec2f(p) + 0.5) / vec2f(size);
  let blurred = textureSampleLevel(src, linear_sampler, uv, 0.0);
  let full = vec2f(p) + 0.5 + params.origin;
  let c = vec2f(params.centerX, params.centerY) / 100.0 * params.canvas_size;
  var s = 0.0;
  if (has_focus()) {
    let fs = vec2f(textureDimensions(focus_tex));
    s = smoothstep(0.0, max(params.focusSoftness / 100.0, 1e-3), textureLoad(focus_tex, vec2i(clamp(uv * fs, vec2f(0.0), fs - 1.0)), 0).r);
  }
  let len = length(c - full) * mix(params.amount, params.amount * params.focusBlur / 100.0, s) / 100.0;
  let t = clamp(len / (1.5 * f), 0.0, 1.0);
  textureStore(dst, p, mix(textureLoad(src_b, p, 0), blurred, t));
}
