// Reaktions-Diffusion (Gray-Scott): U + 2V → 3V, Zufuhr F, Abbau k. Simulation auf einem festen Raster über der ganzen
// Leinwand (r = 1 − U, damit fp16 nahe U = 1 genau bleibt; g = V; b = Steuerwert 0…1). Die Steuerkarte verschiebt k: helle bzw. kantige Bereiche bekommen
// ein dichteres, dunkle ein offeneres Muster. compose legt das Muster in voller Auflösung über das Bild.

fn rates() -> vec2f {
  switch (params.pattern) {
    case 0u: { return vec2f(0.0545, 0.062); }
    case 1u: { return vec2f(0.035, 0.065); }
    case 2u: { return vec2f(0.029, 0.057); }
    case 3u: { return vec2f(0.078, 0.061); }
    default: { return vec2f(params.feed, params.kill); }
  }
}

// src = Bild (Leinwand), dst = Raster
@compute @workgroup_size(8, 8)
fn init(@builtin(global_invocation_id) id: vec3u) {
  let size = textureDimensions(dst);
  if (id.x >= size.x || id.y >= size.y) { return; }
  let uv = (vec2f(id.xy) + 0.5) / vec2f(size);
  let ps = vec2i(uv * vec2f(src_size()));
  // Steuerwert: hoch = viel Muster (dunkle Bereiche bzw. Kanten)
  var s = 0.5;
  if (params.steer == 0u) { s = 1.0 - load_luminance(ps); }
  if (params.steer == 1u) { s = clamp(edge_strength(ps) * 2.0, 0.0, 1.0); }
  // Keime: Flecken aus weichem Rauschen (Rasterzellen, Seed) – groß genug, dass das Muster anwächst
  let n = rand_noise(vec2f(id.xy), 6.0, params.seed);
  let v = select(0.0, 1.0, n > 0.78 - 0.08 * s * params.steerAmount / 100.0);
  textureStore(dst, id.xy, vec4f(v * 0.5, v * 0.25, s, 1.0));
}

fn cell(t: texture_2d<f32>, p: vec2i, size: vec2i) -> vec4f {
  return textureLoad(t, clamp(p, vec2i(0), size - vec2i(1)), 0);
}

@compute @workgroup_size(8, 8)
fn step(@builtin(global_invocation_id) id: vec3u) {
  let size = vec2i(textureDimensions(dst));
  let p = vec2i(id.xy);
  if (p.x >= size.x || p.y >= size.y) { return; }
  let c = cell(src, p, size);
  var lap = -c.rg;
  lap += 0.2 * (cell(src, p + vec2i(1, 0), size).rg + cell(src, p - vec2i(1, 0), size).rg +
                cell(src, p + vec2i(0, 1), size).rg + cell(src, p - vec2i(0, 1), size).rg);
  lap += 0.05 * (cell(src, p + vec2i(1, 1), size).rg + cell(src, p - vec2i(1, 1), size).rg +
                 cell(src, p + vec2i(1, -1), size).rg + cell(src, p + vec2i(-1, 1), size).rg);
  let fk = rates();
  // wenig Steuerwert → höherer Abbau: das Muster stirbt dort ab, viel → dichter
  let k = fk.y - (c.b - 0.5) * params.steerAmount / 100.0 * 0.012;
  // r = w = 1 − U: dw = −dU, Laplace von w = −Laplace von U
  let w = c.r;
  let u = 1.0 - w;
  let v = c.g;
  let uvv = u * v * v;
  let nw = w - (-1.0 * lap.x - uvv + fk.x * w);
  let nv = v + (0.5 * lap.y + uvv - (fk.x + k) * v);
  textureStore(dst, id.xy, vec4f(clamp(nw, 0.0, 1.0), clamp(nv, 0.0, 1.0), c.b, 1.0));
}

// src = Bild, src_b = Raster → Ausgabe
@compute @workgroup_size(8, 8)
fn compose(@builtin(global_invocation_id) id: vec3u) {
  let size = textureDimensions(dst);
  if (id.x >= size.x || id.y >= size.y) { return; }
  let p = vec2i(id.xy);
  // Lage auf der Leinwand → Rasterkoordinate (das Raster überdeckt die ganze Leinwand)
  let uv = canvas_px(p) / params.canvas_size;
  let v = textureSampleLevel(src_b, linear_sampler, uv, 0.0).g;
  // Kante des Musters in voller Auflösung weich, aber scharf
  let gsize = vec2f(textureDimensions(src_b));
  let aa = 0.06 * max(1.0, params.canvas_size.x / gsize.x * 0.25);
  // Schwelle nach Helligkeit: dunkle Stellen → kräftigeres Muster (wie ein Raster), helle → feiner
  let m = smoothstep(0.2 - aa, 0.2 + aa, v);
  let c = load_src(p);
  let rgb = select(vec3f(0.0), c.rgb / c.a, c.a > 0.0);
  var out = rgb;
  if (params.render == 0u) { out = mix(params.paper, rgb, m); }
  if (params.render == 1u) { out = mix(rgb, rgb * params.ink * 2.0, m * 0.85); }
  if (params.render == 2u) { out = mix(params.paper, params.ink, m); }
  textureStore(dst, id.xy, vec4f(out * c.a, c.a));
}
