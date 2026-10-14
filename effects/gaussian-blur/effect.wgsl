// Gauß-Blur: Verkleinern (2 × 2-Box) → separabler Gauß auf der kleinsten Stufe → bilinear hochskalieren.
// effect.ts wählt die Stufe und gleicht die Varianz von Box und bilinearer Interpolation aus.

// Liest src mit Kantenbehandlung (params.edge: 0 Spiegeln, 1 Klemmen, 2 Transparent).
fn edge_load(p: vec2i) -> vec4f {
  let size = src_size();
  if (all(p >= vec2i(0)) && all(p < size)) {
    return textureLoad(src, p, 0);
  }
  if (params.edge == 2u) {
    return vec4f(0.0);
  }
  var q = p;
  if (params.edge == 0u) {
    // Spiegeln ohne Wiederholung des Randpixels; mehrfach für sehr große Überstände
    let period = 2 * size;
    q = ((q % period) + period) % period;
    q = select(q, period - 1 - q, q >= size);
  }
  return textureLoad(src, clamp(q, vec2i(0), size - vec2i(1)), 0);
}

@compute @workgroup_size(8, 8)
fn copy(@builtin(global_invocation_id) id: vec3u) {
  let size = textureDimensions(dst);
  if (id.x >= size.x || id.y >= size.y) { return; }
  textureStore(dst, id.xy, textureLoad(src, vec2i(id.xy), 0));
}

@compute @workgroup_size(8, 8)
fn down(@builtin(global_invocation_id) id: vec3u) {
  let size = textureDimensions(dst);
  if (id.x >= size.x || id.y >= size.y) { return; }
  let p = vec2i(id.xy) * 2;
  let c = edge_load(p) + edge_load(p + vec2i(1, 0)) + edge_load(p + vec2i(0, 1)) + edge_load(p + vec2i(1, 1));
  textureStore(dst, id.xy, c * 0.25);
}

// pass_data.v0 = (Richtung x, Richtung y, sigma in Pixeln dieser Stufe, –)
@compute @workgroup_size(8, 8)
fn blur(@builtin(global_invocation_id) id: vec3u) {
  let size = textureDimensions(dst);
  if (id.x >= size.x || id.y >= size.y) { return; }
  let dir = vec2i(pass_data.v0.xy);
  let sigma = pass_data.v0.z;
  let r = i32(ceil(3.0 * sigma));
  let k = -0.5 / (sigma * sigma);
  let p = vec2i(id.xy);
  var sum = vec4f(0.0);
  var wsum = 0.0;
  for (var i = -r; i <= r; i++) {
    let w = exp(f32(i * i) * k);
    sum += edge_load(p + dir * i) * w;
    wsum += w;
  }
  textureStore(dst, id.xy, sum / wsum);
}

// pass_data.v0.x = Faktor (2^Stufen)
@compute @workgroup_size(8, 8)
fn up(@builtin(global_invocation_id) id: vec3u) {
  let size = textureDimensions(dst);
  if (id.x >= size.x || id.y >= size.y) { return; }
  let lp = (vec2f(id.xy) + 0.5) / pass_data.v0.x;
  textureStore(dst, id.xy, sample_src(lp / vec2f(src_size())));
}

// ---------- Ortsabhängige Unschärfe (Fokuskarte) ----------
// Stufenstapel B_k mit σ_k; pro Pixel wird zwischen den beiden passenden Stufen linear interpoliert.
// pass_data.v0 = (σ_{k-1}, σ_k, σ_{k+1}, erste Stufe?) · v1 = (Radius, Fokus-Radius, Weichheit, letzte Stufe?)
// src = B_k, src_b = bisherige Summe

fn pixel_sigma(p: vec2i) -> f32 {
  let s = focus_sharpness(p, pass_data.v1.z);
  return mix(pass_data.v1.x, pass_data.v1.y, s) / 3.0;
}

@compute @workgroup_size(8, 8)
fn accumulate(@builtin(global_invocation_id) id: vec3u) {
  let size = textureDimensions(dst);
  if (id.x >= size.x || id.y >= size.y) { return; }
  let p = vec2i(id.xy);
  let sigma = pixel_sigma(p);
  let lo = pass_data.v0.x;
  let mid = pass_data.v0.y;
  let hi = pass_data.v0.z;
  var w = 0.0;
  if (sigma <= mid) {
    w = select(clamp((sigma - lo) / max(mid - lo, 1e-6), 0.0, 1.0), 1.0, pass_data.v0.w > 0.5);
  } else {
    w = select(clamp((hi - sigma) / max(hi - mid, 1e-6), 0.0, 1.0), 1.0, pass_data.v1.w > 0.5);
  }
  var acc = vec4f(0.0);
  if (pass_data.v0.w < 0.5) {
    acc = textureLoad(src_b, p, 0);
  }
  textureStore(dst, p, acc + textureLoad(src, p, 0) * w);
}
