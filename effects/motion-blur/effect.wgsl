// Bewegungsunschärfe: Mittelwert entlang einer Linie (Länge aus Fokuskarte), große Längen auf verkleinerter Stufe.

const SAMPLES: i32 = 48;

@compute @workgroup_size(8, 8)
fn down(@builtin(global_invocation_id) id: vec3u) {
  let size = textureDimensions(dst);
  if (id.x >= size.x || id.y >= size.y) { return; }
  let p = vec2i(id.xy) * 2;
  let c = load_src(p) + load_src(p + vec2i(1, 0)) + load_src(p + vec2i(0, 1)) + load_src(p + vec2i(1, 1));
  textureStore(dst, id.xy, c * 0.25);
}

fn length_at(p: vec2i) -> f32 {
  let s = focus_sharpness(p, params.focusSoftness / 100.0);
  return mix(params.length, params.length * params.focusBlur / 100.0, s);
}

// pass_data.v0.x = Verkleinerungsfaktor
@compute @workgroup_size(8, 8)
fn smear(@builtin(global_invocation_id) id: vec3u) {
  let size = textureDimensions(dst);
  if (id.x >= size.x || id.y >= size.y) { return; }
  let p = vec2i(id.xy);
  let len = length_at(p) / pass_data.v0.x;
  if (len < 0.5) {
    textureStore(dst, p, load_src(p));
    return;
  }
  let inv = 1.0 / vec2f(src_size());
  let center = (vec2f(p) + 0.5) * inv;
  let dir = vec2f(cos(params.angle), sin(params.angle)) * len * inv;
  var sum = vec4f(0.0);
  for (var i = 0; i < SAMPLES; i++) {
    let t = (f32(i) + 0.5) / f32(SAMPLES) - 0.5;
    sum += sample_src(center + dir * t);
  }
  textureStore(dst, p, sum / f32(SAMPLES));
}

// src = Stufe, src_b = Original
@compute @workgroup_size(8, 8)
fn compose(@builtin(global_invocation_id) id: vec3u) {
  let size = textureDimensions(dst);
  if (id.x >= size.x || id.y >= size.y) { return; }
  let p = vec2i(id.xy);
  let uv = (vec2f(p) + 0.5) / vec2f(size);
  let blurred = textureSampleLevel(src, linear_sampler, uv, 0.0);
  var s = 0.0;
  if (has_focus()) {
    let fs = vec2f(textureDimensions(focus_tex));
    s = smoothstep(0.0, max(params.focusSoftness / 100.0, 1e-3), textureLoad(focus_tex, vec2i(clamp(uv * fs, vec2f(0.0), fs - 1.0)), 0).r);
  }
  let len = mix(params.length, params.length * params.focusBlur / 100.0, s);
  let t = clamp(len / (1.5 * pass_data.v0.x), 0.0, 1.0);
  textureStore(dst, p, mix(textureLoad(src_b, p, 0), blurred, t));
}
