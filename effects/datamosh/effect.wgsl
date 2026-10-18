// Datamosh: JPEG-artige 8×8-DCT mit Quantisierung (Tabellen aus ITU-T T.81, Anhang K) auf einem Blockgitter in
// Leinwand-Koordinaten. Betroffene Blöcke (Zufall je Block): Inhalt von verschobener Stelle (Bewegungsvektor aus weichem
// Rauschen, wie fehlende Schlüsselbilder), sehr grobe Quantisierung, Farbfehler. pass_data.v0 = (bx0, by0, B, –).

const QL = array<f32, 64>(
  16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55, 14, 13, 16, 24, 40, 57, 69, 56,
  14, 17, 22, 29, 51, 87, 80, 62, 18, 22, 37, 56, 68, 109, 103, 77, 24, 35, 55, 64, 81, 104, 113, 92,
  49, 64, 78, 87, 103, 121, 120, 101, 72, 92, 95, 98, 112, 100, 103, 99,
);
const QC = array<f32, 64>(
  17, 18, 24, 47, 99, 99, 99, 99, 18, 21, 26, 66, 99, 99, 99, 99, 24, 26, 56, 99, 99, 99, 99, 99,
  47, 66, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99,
  99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99,
);
const PI = 3.14159265;

fn block_size() -> f32 { return pass_data.v0.z; }

fn affected(b: vec2i) -> bool {
  return rand_cell(b, params.seed, 1u) < params.amount / 100.0;
}

/** Bewegungsvektor eines Blocks in Leinwand-px: weiches Rauschen über das Blockgitter (benachbarte Blöcke ähnlich). */
fn motion(b: vec2i) -> vec2f {
  if (!affected(b) || params.smear <= 0.0) { return vec2f(0.0); }
  let q = vec2f(b) + 0.5;
  let v = vec2f(rand_noise(q, 3.0, params.seed + 17u), rand_noise(q, 3.0, params.seed + 29u)) - 0.5;
  return round(v * 2.0 * params.smear / params.scale);
}

/** YCbCr (JPEG, 0..255) an einer Leinwandposition (volle Auflösung). */
fn ycc_at(x: vec2f) -> vec3f {
  let c = unpremultiply(sample_src_canvas(x * params.scale));
  let s = clamp(linear_to_srgb(c.rgb), vec3f(0.0), vec3f(1.0)) * 255.0;
  return vec3f(
    0.299 * s.r + 0.587 * s.g + 0.114 * s.b - 128.0,
    -0.168736 * s.r - 0.331264 * s.g + 0.5 * s.b,
    0.5 * s.r - 0.418688 * s.g - 0.081312 * s.b,
  );
}

fn cu(u: i32) -> f32 { return select(1.0, 0.70710678, u == 0); }

/** Blockkoordinate (global) und Index im Block (0..7) eines Koeffizienten-Texels. */
fn texel_block(id: vec2u) -> vec2i {
  return vec2i(id.xy) / 8 + vec2i(pass_data.v0.xy);
}

// 1-D-DCT entlang x: Texel (bx·8 + u, by·8 + j) = Σᵢ f(i, j) · cos((2i + 1)uπ/16)
@compute @workgroup_size(8, 8)
fn rows(@builtin(global_invocation_id) id: vec3u) {
  let size = textureDimensions(dst);
  if (id.x >= size.x || id.y >= size.y) { return; }
  let b = texel_block(id.xy);
  let u = i32(id.x % 8u);
  let j = f32(id.y % 8u);
  let B = block_size();
  // verschobene Blöcke lesen nur innerhalb der Leinwand (sonst entstünden durch die Randklemmung Streifen)
  let canvas = params.canvas_size / params.scale;
  let origin = clamp(vec2f(b) * B + motion(b), vec2f(0.0), max(canvas - B, vec2f(0.0)));
  var sum = vec3f(0.0);
  // Jede der 8 × 8 Proben mittelt ihre Teilzelle (B/8 px) mit 2 × 2 bilinearen Abtastungen – wie echtes Verkleinern;
  // ohne diesen Vorfilter falten sich feine Details in hohe Frequenzen und werden durch die Quantisierung zu Karos.
  let sub = B / 8.0;
  for (var i = 0; i < 8; i++) {
    let x = origin + vec2f(f32(i), j) * sub;
    let v = ycc_at(x + vec2f(0.25, 0.25) * sub) + ycc_at(x + vec2f(0.75, 0.25) * sub) +
      ycc_at(x + vec2f(0.25, 0.75) * sub) + ycc_at(x + vec2f(0.75, 0.75) * sub);
    sum += v * 0.25 * cos((2.0 * f32(i) + 1.0) * f32(u) * PI / 16.0);
  }
  textureStore(dst, id.xy, vec4f(sum * 0.5 * cu(u), 1.0));
}

// 1-D-DCT entlang y und Quantisierung
@compute @workgroup_size(8, 8)
fn cols(@builtin(global_invocation_id) id: vec3u) {
  let size = textureDimensions(dst);
  if (id.x >= size.x || id.y >= size.y) { return; }
  let b = texel_block(id.xy);
  let u = i32(id.x % 8u);
  let v = i32(id.y % 8u);
  let base = vec2i(id.xy) - vec2i(0, v);
  var sum = vec3f(0.0);
  for (var j = 0; j < 8; j++) {
    sum += textureLoad(src, base + vec2i(0, j), 0).rgb * cos((2.0 * f32(j) + 1.0) * f32(v) * PI / 16.0);
  }
  var c = sum * 0.5 * cu(v);
  // Quantisierung nach IJG-Skalierung; betroffene Blöcke deutlich gröber
  var q = clamp(params.quality, 1.0, 100.0);
  let hit = affected(b);
  if (hit) { q = mix(q, 1.0, params.crush / 100.0); }
  let sc = select(200.0 - 2.0 * q, 5000.0 / q, q < 50.0);
  let k = v * 8 + u;
  let ql = clamp(floor((QL[k] * sc + 50.0) / 100.0), 1.0, 255.0);
  let qc = clamp(floor((QC[k] * sc + 50.0) / 100.0), 1.0, 255.0);
  c = vec3f(round(c.x / ql) * ql, round(c.y / qc) * qc, round(c.z / qc) * qc);
  // Farbfehler: Farbanteil eines betroffenen Blocks versetzt (nur Gleichanteil) oder vertauscht
  if (hit && k == 0 && params.colorGlitch > 0.0) {
    let r = vec2f(rand_cell(b, params.seed, 7u), rand_cell(b, params.seed, 8u)) - 0.5;
    let g = params.colorGlitch / 100.0;
    c = vec3f(c.x, c.y + r.x * 800.0 * g, c.z + r.y * 800.0 * g);
    if (rand_cell(b, params.seed, 9u) < 0.3 * g) { c = vec3f(c.x, c.z, c.y); }
  }
  textureStore(dst, id.xy, vec4f(c, 1.0));
}

// Rücktransformation je Pixel: stetige Lage im Block (Probenabstand 1/8 Block), Gitter in Leinwand-px
@compute @workgroup_size(8, 8)
fn idct(@builtin(global_invocation_id) id: vec3u) {
  let size = textureDimensions(dst);
  if (id.x >= size.x || id.y >= size.y) { return; }
  let p = vec2i(id.xy);
  let B = block_size();
  let cp = canvas_pos(p);
  let b = vec2i(floor(cp / B));
  let t = (cp - vec2f(b) * B) / B * 8.0 - 0.5; // −0.5 … 7.5 in Probeneinheiten
  let base = (b - vec2i(pass_data.v0.xy)) * 8;
  var cx: array<f32, 8>;
  var cy: array<f32, 8>;
  for (var u = 0; u < 8; u++) {
    cx[u] = cu(u) * cos((2.0 * t.x + 1.0) * f32(u) * PI / 16.0);
    cy[u] = cu(u) * cos((2.0 * t.y + 1.0) * f32(u) * PI / 16.0);
  }
  var ycc = vec3f(0.0);
  for (var v = 0; v < 8; v++) {
    for (var u = 0; u < 8; u++) {
      ycc += textureLoad(src_b, base + vec2i(u, v), 0).rgb * (cx[u] * cy[v]);
    }
  }
  ycc *= 0.25;
  let y = ycc.x + 128.0;
  let rgb = vec3f(y + 1.402 * ycc.z, y - 0.344136 * ycc.y - 0.714136 * ycc.z, y + 1.772 * ycc.y) / 255.0;
  let a = load_src(p).a;
  return_store(id.xy, rgb, a);
}

fn return_store(at: vec2u, rgb: vec3f, a: f32) {
  textureStore(dst, at, premultiply(vec4f(srgb_to_linear(clamp(rgb, vec3f(0.0), vec3f(1.0))), a)));
}
