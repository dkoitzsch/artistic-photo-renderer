// Erosion (vereinfachte hydraulische Erosion auf festem Raster über der Leinwand):
// Höhe h (aus Helligkeit oder Tiefe), Wasser w, Sediment s. Je Schritt: Regen, Fließgeschwindigkeit aus dem Gefälle der
// Wasseroberfläche, Aufnahme/Ablage nach Transportkapazität (Härte), Transport von Wasser und Sediment
// (semi-Lagrange), Verdunstung, Hangrutschung. Danach: Farbe von stromaufwärts dort, wo Material ab- oder aufgetragen
// wurde; Original in voller Auflösung mit Relieflicht aus der erodierten Höhe.

fn height_of(rgb: vec3f, d: f32) -> f32 {
  let l = linear_to_srgb(vec3f(luminance(rgb))).x;
  if (params.heightSource == 1u) { return 1.0 - l; }
  if (params.heightSource == 2u) { return 1.0 - d; }
  return l;
}

// src = Bild → Raster: rgb Farbe (nicht vormultipliziert), a = Ausgangshöhe
@compute @workgroup_size(8, 8)
fn init_color(@builtin(global_invocation_id) id: vec3u) {
  let size = textureDimensions(dst);
  if (id.x >= size.x || id.y >= size.y) { return; }
  let uv = (vec2f(id.xy) + 0.5) / vec2f(size);
  let c = sample_src(uv);
  let rgb = select(vec3f(0.0), c.rgb / c.a, c.a > 0.0);
  let d = textureSampleLevel(depth_tex, linear_sampler, uv, 0.0).r;
  textureStore(dst, id.xy, vec4f(rgb, height_of(rgb, d)));
}

@compute @workgroup_size(8, 8)
fn init_state(@builtin(global_invocation_id) id: vec3u) {
  let size = textureDimensions(dst);
  if (id.x >= size.x || id.y >= size.y) { return; }
  // feines Rauschen bricht Terrassen glatter Verläufe (8-Bit-Stufen würden sonst zu waagrechten Rinnen)
  let n = rand_noise(vec2f(id.xy), 3.0, params.seed) + 0.5 * rand_noise(vec2f(id.xy), 1.0, params.seed + 7u);
  let h = textureLoad(src, vec2i(id.xy), 0).a + (n - 0.75) * 0.003;
  textureStore(dst, id.xy, vec4f(h, 0.0, 0.0, 1.0));
}

fn at(t: texture_2d<f32>, p: vec2i, size: vec2i) -> vec4f {
  return textureLoad(t, clamp(p, vec2i(0), size - vec2i(1)), 0);
}

/** Fließgeschwindigkeit (Zellen je Schritt) aus dem Gefälle der Wasseroberfläche */
fn velocity(t: texture_2d<f32>, p: vec2i, size: vec2i) -> vec2f {
  let l = at(t, p - vec2i(1, 0), size);
  let r = at(t, p + vec2i(1, 0), size);
  let u = at(t, p - vec2i(0, 1), size);
  let d = at(t, p + vec2i(0, 1), size);
  let g = vec2f((r.r + r.g) - (l.r + l.g), (d.r + d.g) - (u.r + u.g)) * 0.5;
  // Gefälle in Höhe je Zelle; Faktor bezieht das Raster auf die Bildgröße
  let v = -g * f32(max(size.x, size.y)) * 0.6;
  let len = length(v);
  return select(v, v / len * 1.5, len > 1.5);
}

/** bilinear gelesener Zustand an einer gleitenden Rasterposition */
fn sample_cell(t: texture_2d<f32>, q: vec2f, size: vec2i) -> vec4f {
  return textureSampleLevel(t, linear_sampler, (q + 0.5) / vec2f(size), 0.0);
}

// pass_data.v0.x = Schritt
@compute @workgroup_size(8, 8)
fn step(@builtin(global_invocation_id) id: vec3u) {
  let size = vec2i(textureDimensions(dst));
  let p = vec2i(id.xy);
  if (p.x >= size.x || p.y >= size.y) { return; }
  let v = velocity(src, p, size);
  // Transport: Wasser und Sediment von stromaufwärts holen
  let up = sample_cell(src, vec2f(p) - v, size);
  let here = at(src, p, size);
  var h = here.r;
  var w = up.g;
  var s = up.b;
  // Regen: gleichmäßig mit großräumiger Schwankung (keine Zellrauschen → keine Streifen)
  let rain = params.rain / 100.0 * 0.003;
  w += rain;
  // Aufnahme bzw. Ablage nach Kapazität, je Schritt begrenzt
  let speed = length(v);
  let cap = speed * w * 1.5;
  let soft = 1.0 - params.hardness / 100.0;
  if (s < cap) {
    let d = min((cap - s) * 0.1 * soft, 0.0006);
    h -= d;
    s += d;
  } else {
    let d = min((s - cap) * 0.1, 0.0006);
    h += d;
    s -= d;
  }
  // Hangrutschung (thermische Erosion): zu steile Stufen glätten – hält die Simulation stabil
  let avg = (at(src, p + vec2i(1, 0), size).r + at(src, p - vec2i(1, 0), size).r +
             at(src, p + vec2i(0, 1), size).r + at(src, p - vec2i(0, 1), size).r) * 0.25;
  h = mix(h, avg, 0.04);
  // Verdunstung
  w *= 0.985;
  textureStore(dst, id.xy, vec4f(h, w, max(s, 0.0), 1.0));
}

// src = Endzustand, src_b = Ausgangsfarbe/-höhe → rgb = Farbe von stromaufwärts, a = Gewicht (Ab- bzw. Auftrag)
@compute @workgroup_size(8, 8)
fn carried(@builtin(global_invocation_id) id: vec3u) {
  let size = vec2i(textureDimensions(dst));
  let p = vec2i(id.xy);
  if (p.x >= size.x || p.y >= size.y) { return; }
  let st = textureLoad(src, p, 0);
  let h0 = textureLoad(src_b, p, 0).a;
  // Weg stromaufwärts (bis 12 Schritte) entlang der Fließrichtung des Endzustands
  var q = vec2f(p);
  for (var i = 0; i < 12; i++) {
    let v = velocity(src, vec2i(q), size);
    if (length(v) < 0.05) { break; }
    q -= v;
  }
  let up = textureSampleLevel(src_b, linear_sampler, (q + 0.5) / vec2f(size), 0.0).rgb;
  let moved = abs(st.r - h0);
  let w = clamp(moved * 60.0, 0.0, 1.0) * params.carry / 100.0;
  textureStore(dst, id.xy, vec4f(up, w));
}

// src = Bild, src_b = Zustand (r = Höhe) → Original in voller Auflösung mit Relieflicht der erodierten Höhe
@compute @workgroup_size(8, 8)
fn relief(@builtin(global_invocation_id) id: vec3u) {
  let size = textureDimensions(dst);
  if (id.x >= size.x || id.y >= size.y) { return; }
  let p = vec2i(id.xy);
  let uv = canvas_px(p) / params.canvas_size;
  let g = vec2f(textureDimensions(src_b));
  let hx = textureSampleLevel(src_b, linear_sampler, uv + vec2f(1.0 / g.x, 0.0), 0.0).r -
           textureSampleLevel(src_b, linear_sampler, uv - vec2f(1.0 / g.x, 0.0), 0.0).r;
  let hy = textureSampleLevel(src_b, linear_sampler, uv + vec2f(0.0, 1.0 / g.y), 0.0).r -
           textureSampleLevel(src_b, linear_sampler, uv - vec2f(0.0, 1.0 / g.y), 0.0).r;
  let n = normalize(vec3f(-hx * g.x * 0.25, -hy * g.y * 0.25, 1.0));
  let light = dot(n, normalize(vec3f(-0.6, -0.6, 1.0))) / 0.7625;
  let shade = mix(1.0, light, params.relief / 100.0);
  let c = load_src(p);
  textureStore(dst, id.xy, vec4f(c.rgb * shade, c.a));
}

// src = Bild mit Relief, src_b = mitgetragene Farbe → dort, wo Material gewandert ist, dessen Farbe
@compute @workgroup_size(8, 8)
fn blend(@builtin(global_invocation_id) id: vec3u) {
  let size = textureDimensions(dst);
  if (id.x >= size.x || id.y >= size.y) { return; }
  let p = vec2i(id.xy);
  let uv = canvas_px(p) / params.canvas_size;
  let m = textureSampleLevel(src_b, linear_sampler, uv, 0.0);
  let c = load_src(p);
  let rgb = select(vec3f(0.0), c.rgb / c.a, c.a > 0.0);
  textureStore(dst, id.xy, vec4f(mix(rgb, m.rgb, m.a) * c.a, c.a));
}
