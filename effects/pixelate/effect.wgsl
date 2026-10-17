// Pixel / Mosaik in zwei Pässen. Das Zellraster liegt in Leinwand-Koordinaten (gleich in Vorschau und Export):
//   cells: je Zelle (ein Texel) die Zellfarbe aus allen Pixeln der Zelle im Ausschnitt
//   apply: jedes Pixel bekommt die Farbe seiner Zelle
// pass_data.v0.xy = Index der ersten Zelle (Spalte, Zeile) der Zelltextur.
// Sechsecke: Zeilen im Abstand size·√3/2, ungerade Zeilen um size/2 versetzt; Zelle = nächster Mittelpunkt.

const HEX_ROW: f32 = 0.8660254;

/** Mittelpunkt einer Zelle (Render-px auf der Leinwand) */
fn cell_center(cell: vec2i) -> vec2f {
  let s = params.size;
  if (params.shape == 0u) {
    return (vec2f(cell) + 0.5) * s;
  }
  let shift = select(0.0, 0.5, (cell.y & 1) == 1);
  return vec2f((f32(cell.x) + 0.5 + shift) * s, (f32(cell.y) + 0.5) * s * HEX_ROW);
}

/** Zelle eines Punkts (Render-px auf der Leinwand) */
fn cell_of(q: vec2f) -> vec2i {
  let s = params.size;
  if (params.shape == 0u) {
    return vec2i(floor(q / s));
  }
  let row = i32(floor(q.y / (s * HEX_ROW)));
  var best = vec2i(0);
  var bd = 1e30;
  for (var dy = -1; dy <= 1; dy++) {
    let r = row + dy;
    let shift = select(0.0, 0.5, (r & 1) == 1);
    let col = i32(floor(q.x / s - shift));
    for (var dx = -1; dx <= 1; dx++) {
      let c = vec2i(col + dx, r);
      let d = distance(q, cell_center(c));
      if (d < bd) {
        bd = d;
        best = c;
      }
    }
  }
  return best;
}

fn median_bin(h: ptr<function, array<u32, 64>>, n: u32) -> f32 {
  var acc = 0u;
  for (var i = 0u; i < 64u; i++) {
    acc += (*h)[i];
    if (acc * 2u >= n) { return (f32(i) + 0.5) / 64.0; }
  }
  return 1.0;
}

@compute @workgroup_size(8, 8)
fn cells(@builtin(global_invocation_id) id: vec3u) {
  let csize = textureDimensions(dst);
  if (id.x >= csize.x || id.y >= csize.y) { return; }
  let cell = vec2i(id.xy) + vec2i(pass_data.v0.xy);
  let center = cell_center(cell);
  let size = src_size();
  if (params.color == 2u) {
    textureStore(dst, id.xy, load_src(vec2i(floor(center - params.origin))));
    return;
  }
  // Pixelbereich der Zelle im Ausschnitt (Sechseck: umschließendes Rechteck, Zugehörigkeit per cell_of)
  let half = params.size * select(0.5, 0.6, params.shape == 1u);
  let lo = max(vec2i(floor(center - half - params.origin)), vec2i(0));
  let hi = min(vec2i(ceil(center + half - params.origin)), size);
  var sum = vec4f(0.0);
  var n = 0u;
  var hr: array<u32, 64>;
  var hg: array<u32, 64>;
  var hb: array<u32, 64>;
  var ha: array<u32, 64>;
  for (var y = lo.y; y < hi.y; y++) {
    for (var x = lo.x; x < hi.x; x++) {
      let q = vec2f(f32(x), f32(y)) + 0.5 + params.origin;
      if (params.shape == 1u && any(cell_of(q) != cell)) { continue; }
      let c = textureLoad(src, vec2i(x, y), 0);
      n++;
      if (params.color == 0u) {
        sum += c;
      } else {
        // Median je Kanal (64 Stufen) auf den gerade-Alpha-Farben in sRGB, Alpha getrennt
        let u = linear_to_srgb(clamp(unpremultiply(c).rgb, vec3f(0.0), vec3f(1.0)));
        hr[u32(min(u.r * 64.0, 63.0))]++;
        hg[u32(min(u.g * 64.0, 63.0))]++;
        hb[u32(min(u.b * 64.0, 63.0))]++;
        ha[u32(min(c.a * 64.0, 63.0))]++;
      }
    }
  }
  if (n == 0u) {
    textureStore(dst, id.xy, vec4f(0.0));
    return;
  }
  if (params.color == 0u) {
    textureStore(dst, id.xy, sum / f32(n));
    return;
  }
  let rgb = srgb_to_linear(vec3f(median_bin(&hr, n), median_bin(&hg, n), median_bin(&hb, n)));
  textureStore(dst, id.xy, premultiply(vec4f(rgb, median_bin(&ha, n))));
}

@compute @workgroup_size(8, 8)
fn apply(@builtin(global_invocation_id) id: vec3u) {
  let size = textureDimensions(dst);
  if (id.x >= size.x || id.y >= size.y) { return; }
  let q = vec2f(id.xy) + 0.5 + params.origin;
  let cell = cell_of(q) - vec2i(pass_data.v0.xy);
  let csize = vec2i(textureDimensions(src_b));
  textureStore(dst, id.xy, textureLoad(src_b, clamp(cell, vec2i(0), csize - vec2i(1)), 0));
}
