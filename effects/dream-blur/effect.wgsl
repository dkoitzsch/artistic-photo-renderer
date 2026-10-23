// Analoger Traum. Mehrstufig (effect.ts): Unschärfe (Kern-Gauß) von Hintergrund und Motiv → Mischen nach Motiv →
// Leuchten aus hellen Flächen → Komposition (Bewegungsspur, Geisterbild, Leuchten, Lichtleck, Farbstich, Sättigung,
// Kontrast, Schwärze, Vignette, Körnung). Zufall und Rauschen nur aus Leinwandkoordinaten und Seed.

fn longest() -> f32 { return max(params.canvas_size.x, params.canvas_size.y); }

fn subject_at(p: vec2i) -> f32 {
  var v = max(load_saliency(p), load_faces(p));
  if (has_focus()) { v = max(v, load_focus(p)); }
  return clamp(v, 0.0, 1.0);
}

fn subject_w(p: vec2i) -> f32 { return smoothstep(0.05, 0.55, subject_at(p)); }

@compute @workgroup_size(8, 8)
fn mix_focus(@builtin(global_invocation_id) id: vec3u) {
  let size = textureDimensions(dst);
  if (id.x >= size.x || id.y >= size.y) { return; }
  let p = vec2i(id.xy);
  let w = subject_w(p) * params.subjectKeep / 100.0;
  textureStore(dst, p, mix(textureLoad(src, p, 0), textureLoad(src_b, p, 0), w));
}

@compute @workgroup_size(8, 8)
fn highlights(@builtin(global_invocation_id) id: vec3u) {
  let size = textureDimensions(dst);
  if (id.x >= size.x || id.y >= size.y) { return; }
  let p = vec2i(id.xy);
  let c = textureLoad(src, p, 0);
  let l = pow(max(luminance(unpremultiply(c).rgb), 0.0), 0.45);
  let t = params.glowThreshold / 100.0;
  // Licht (vormultipliziert), Alpha 1: bleibt beim Weichzeichnen und Lesen stabil
  textureStore(dst, p, vec4f(c.rgb * smoothstep(t, t + 0.3, l), 1.0));
}

fn screen(a: vec3f, b: vec3f) -> vec3f { return vec3f(1.0) - (vec3f(1.0) - a) * (vec3f(1.0) - b); }

@compute @workgroup_size(8, 8)
fn compose(@builtin(global_invocation_id) id: vec3u) {
  let size = textureDimensions(dst);
  if (id.x >= size.x || id.y >= size.y) { return; }
  let p = vec2i(id.xy);
  let cp = canvas_px(p);
  let L = longest();
  let sz = vec2f(size);
  let uv = (vec2f(p) + 0.5) / sz;
  let drift = vec2f(cos(params.driftAngle), sin(params.driftAngle));
  let a0 = textureLoad(src, p, 0);
  var c = unpremultiply(a0).rgb;
  let s = subject_w(p);

  // Bewegungsspur: Motiv verwischt entlang der Richtung
  if (params.motion > 0.0) {
    let len = params.motionLength / 100.0 * L;
    var sum = vec3f(0.0);
    var ws = 0.0;
    for (var i = 0; i < 16; i++) {
      let t = f32(i) / 15.0;
      let w = 1.0 - 0.75 * t;
      sum += unpremultiply(textureSampleLevel(src, linear_sampler, uv - drift * len * t / sz, 0.0)).rgb * w;
      ws += w;
    }
    c = mix(c, sum / ws, params.motion / 100.0 * smoothstep(0.1, 0.5, s));
  }
  // Geisterbild: blasses, kühles Abbild des Motivs, versetzt
  if (params.ghost > 0.0) {
    let off = drift * params.ghostDistance / 100.0 * L;
    let q = vec2i(clamp(vec2f(p) - off, vec2f(0.0), sz - 1.0));
    let sg = subject_w(q);
    let g = unpremultiply(textureSampleLevel(src, linear_sampler, uv - off / sz, 0.0)).rgb;
    let gl = luminance(g);
    let gc = mix(g, vec3f(gl) * vec3f(0.85, 1.0, 1.15) * 1.5, 0.6);
    c = screen(c, gc * params.ghost / 100.0 * sg * 0.9);
  }
  // Leuchten (Halation) in der Farbe des Leuchtens
  if (params.glow > 0.0) {
    let g = textureLoad(src_b, p, 0).rgb;
    let gl = luminance(g);
    c = c + mix(vec3f(gl), g * params.glowColor / max(luminance(params.glowColor), 0.1), 0.55) * params.glow / 100.0 * 0.8;
    c = c + params.glowColor * gl * params.glow / 100.0 * 0.3;
  }
  // Lichtleck
  if (params.leak > 0.0) {
    let ld = vec2f(cos(params.leakAngle), sin(params.leakAngle));
    let d = dot((cp - 0.5 * params.canvas_size) / L, ld) + 0.5;
    var k = smoothstep(0.5, 1.15, d);
    k = k * k;
    k = k * (0.5 + 1.0 * rand_fbm(cp, 0.3 * L, 3u, params.seed + 17u));
    c = c + params.leakColor * k * params.leak / 100.0 * 1.2;
  }

  // Farbstich (Splittoning), Sättigung
  let lum = luminance(c);
  let lt = smoothstep(0.0, 0.5, pow(max(lum, 0.0), 0.5));
  let tone = params.tone / 100.0;
  c = c * mix(vec3f(1.0), mix(vec3f(1.0), params.highlightTone / max(luminance(params.highlightTone), 0.1) * 0.9, lt), tone);
  c = c + params.shadowTone * (1.0 - lt) * tone * 0.35;
  let l2 = luminance(c);
  c = mix(vec3f(l2), c, params.saturation / 100.0);

  // Kontrast und Schwärze in sRGB
  var sr = clamp(linear_to_srgb(max(c, vec3f(0.0))), vec3f(0.0), vec3f(1.5));
  let k = params.contrast / 100.0;
  sr = mix(sr, sr * sr * (3.0 - 2.0 * sr), k);
  let cr = params.crush / 100.0 * 0.12;
  sr = max(sr - cr, vec3f(0.0)) / (1.0 - cr);
  // Vignette
  if (params.vignette > 0.0) {
    let v = (cp - 0.5 * params.canvas_size) / (0.5 * L);
    sr = sr * (1.0 - params.vignette / 100.0 * smoothstep(0.4, 1.25, length(v)));
  }
  // Körnung: weiches Rauschen + Zellrauschen, Helligkeit und Farbe getrennt
  if (params.grain > 0.0) {
    let gc = max(params.grainSize / 100.0 * L, 1.0);
    let cell = vec2i(floor(cp / gc));
    let nl = 0.55 * (rand_cell(cell, params.seed + 3u, 1u) - 0.5) + 0.45 * (rand_noise(cp, gc * 1.6, params.seed + 4u) - 0.5);
    let nc = vec3f(
      rand_cell(cell, params.seed + 5u, 2u) - 0.5,
      rand_cell(cell, params.seed + 5u, 3u) - 0.5,
      rand_cell(cell, params.seed + 5u, 4u) - 0.5,
    );
    let mid = 0.45 + 0.55 * (1.0 - abs(luminance(sr) * 2.0 - 1.0));
    sr = sr + (vec3f(nl) * 2.0 + nc * params.grainColor / 100.0 * 1.4) * params.grain / 100.0 * 0.22 * mid;
  }
  let out = srgb_to_linear(clamp(sr, vec3f(0.0), vec3f(1.0)));
  textureStore(dst, p, premultiply(vec4f(out, a0.a)));
}
