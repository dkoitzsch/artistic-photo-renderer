// Halbton: je Farbkanal ein gedrehtes Raster in Leinwand-px; jede Rasterzelle nimmt den Farbanteil an ihrem Mittelpunkt,
// der Punkt wird so groß, dass sein Flächenanteil dem Farbanteil entspricht (Rasterfunktion mit weicher Kante).
// Mischung subtraktiv auf dem Papier. Passerversatz: jede Farbe leicht verschoben.

const TAU: f32 = 6.2831853;

/** Druckfarben (linear) */
fn ink_color(k: u32) -> vec3f {
  switch k {
    case 0u: { return srgb_to_linear(vec3f(0.0, 0.62, 0.88)); }
    case 1u: { return srgb_to_linear(vec3f(0.89, 0.0, 0.48)); }
    case 2u: { return srgb_to_linear(vec3f(1.0, 0.93, 0.0)); }
    default: { return srgb_to_linear(vec3f(0.08, 0.08, 0.1)); }
  }
}

/** Rasterfunktion 0..1 in der Zelle (u, v ∈ [−0.5, 0.5]); Tinte, wo spot < Deckung */
fn spot(f: vec2f) -> f32 {
  switch params.shape {
    case 1u: { return 0.5 - (cos(TAU * f.x) + 0.55 * cos(TAU * f.y)) / 3.1; }
    case 2u: { return 0.5 - 0.5 * cos(TAU * f.y); }
    case 3u: { return max(abs(f.x), abs(f.y)) * 2.0; }
    default: { return 0.5 - 0.25 * (cos(TAU * f.x) + cos(TAU * f.y)); }
  }
}

/** Deckungsgrad eines Kanals (0..1) aus der Farbe am Zellmittelpunkt */
fn coverage(rgb: vec3f, k: u32) -> f32 {
  let s = clamp(linear_to_srgb(clamp(rgb, vec3f(0.0), vec3f(1.0))), vec3f(0.0), vec3f(1.0));
  if (params.mode == 1u) {
    return 1.0 - luminance(s);
  }
  let kk = (1.0 - max(max(s.r, s.g), s.b)) * params.black / 100.0;
  let d = max(1.0 - kk, 1e-4);
  switch k {
    case 0u: { return clamp((1.0 - s.r - kk) / d, 0.0, 1.0); }
    case 1u: { return clamp((1.0 - s.g - kk) / d, 0.0, 1.0); }
    case 2u: { return clamp((1.0 - s.b - kk) / d, 0.0, 1.0); }
    default: { return kk; }
  }
}

fn channel_angle(k: u32) -> f32 {
  switch k {
    case 0u: { return params.angleC; }
    case 1u: { return params.angleM; }
    case 2u: { return params.angleY; }
    default: { return params.angleK; }
  }
}

/** Tintenanteil (0..1) eines Kanals am Pixel p */
fn ink_at(p: vec2i, k: u32) -> f32 {
  let cell = max(params.cellSize, 1e-3);                       // Render-px
  // Passerversatz je Farbe in eine eigene Richtung
  let off = vec2f(cos(f32(k) * 2.1), sin(f32(k) * 2.1)) * params.misregistration * select(1.0, 0.0, params.mode == 1u);
  let q = canvas_px(p) - off;                                  // Render-px auf der Leinwand
  let a = channel_angle(k);
  let cs = vec2f(cos(a), sin(a));
  let r = vec2f(cs.x * q.x + cs.y * q.y, -cs.y * q.x + cs.x * q.y) / cell;
  let center_r = floor(r) + 0.5;
  let f = r - center_r;
  // Zellmittelpunkt zurück in Bildkoordinaten (Ausschnitt) und Farbe dort abtasten
  let cr = center_r * cell;
  let center = vec2f(cs.x * cr.x - cs.y * cr.y, cs.y * cr.x + cs.x * cr.y) + off;
  let c = unpremultiply(sample_src_canvas(center));
  let cov = coverage(c.rgb, k) * c.a;
  let aa = 1.2 / cell;
  return 1.0 - smoothstep(cov - aa, cov + aa, spot(f));
}

fn effect(p: vec2i) -> vec4f {
  let src_c = load_src(p);
  var rgb = params.paper;
  if (params.mode == 1u) {
    rgb = mix(params.paper, params.monoInk, ink_at(p, 3u));
  } else {
    for (var k = 0u; k < 4u; k++) {
      rgb = rgb * mix(vec3f(1.0), ink_color(k), ink_at(p, k));
    }
  }
  return vec4f(rgb * src_c.a, src_c.a);
}
