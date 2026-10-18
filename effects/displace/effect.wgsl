// Verschiebung & Slit-Scan: Rückwärtsabbildung – jedes Pixel liest den Eingang an p − Versatz. Der Versatz ist der Wert der
// Steuerkarte (0..1) entlang der Richtung (bei „Richtungsfeld“ entlang der lokalen Strichrichtung). Slit-Scan: die Karte
// wird nur an der Mittellinie des Streifens gelesen, so verschiebt sich jeder Streifen als Ganzes. Kachelgenau: Positionen
// in Leinwand-Koordinaten, Zufall nach Leinwandposition.

/** Zweitbild (src_b) füllt die Leinwand wie bei der Doppelbelichtung; Helligkeit 0..1. */
fn second_value(cp: vec2f) -> f32 {
  let isz = vec2f(textureDimensions(src_b));
  let canvas = params.canvas_size / params.scale;
  let cover = max(canvas.x / isz.x, canvas.y / isz.y);
  let t = (cp - canvas * 0.5) / cover + isz * 0.5 - 0.5;
  let i = vec2i(floor(t));
  let f = t - floor(t);
  let mx = vec2i(isz) - vec2i(1);
  let a = textureLoad(src_b, clamp(i, vec2i(0), mx), 0);
  let b = textureLoad(src_b, clamp(i + vec2i(1, 0), vec2i(0), mx), 0);
  let c = textureLoad(src_b, clamp(i + vec2i(0, 1), vec2i(0), mx), 0);
  let d = textureLoad(src_b, clamp(i + vec2i(1, 1), vec2i(0), mx), 0);
  let s = unpremultiply(mix(mix(a, b, f.x), mix(c, d, f.x), f.y));
  return luminance(clamp(linear_to_srgb(s.rgb), vec3f(0.0), vec3f(1.0)));
}

/** Kartenwert 0..1 an einer Leinwandposition (volle Auflösung); Karten in Ausgabe-px gelesen. */
fn map_value(cp: vec2f) -> f32 {
  let q = vec2i(floor(cp * params.scale - params.origin));
  switch params.source {
    case 0u: { return load_luminance(q); }
    case 1u: { return edge_strength(q); }
    case 2u: { return load_depth(q); }
    case 3u: { return flow_coherence(q); }
    case 4u: { return rand_fbm(cp, params.noiseSize / params.scale, 3u, params.seed); }
    default: {
      if (params.image == 0u) { return 0.5; }
      return second_value(cp);
    }
  }
}

fn effect(p: vec2i) -> vec4f {
  let cp = canvas_pos(p);
  var dir = vec2f(cos(params.angle), sin(params.angle));
  if (params.source == 3u) {
    dir = flow_tangent(p);
  }
  var at = cp;
  if (params.mode == 1u) {
    // Streifen senkrecht zur Verschiebungsrichtung: Karte an der Mittellinie des Streifens
    let n = vec2f(-dir.y, dir.x);
    let w = max(params.stripeWidth / params.scale, 1.0);
    let s = dot(cp, n);
    let center = (floor(s / w) + 0.5) * w;
    at = cp + n * (center - s);
  }
  var v = map_value(at);
  if (params.invert != 0u) { v = 1.0 - v; }
  if (params.centered != 0u) { v = v * 2.0 - 1.0; }
  let offset = dir * v * params.strength; // Render-px
  return sample_src_canvas(canvas_px(p) - offset);
}
