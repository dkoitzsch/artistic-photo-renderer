// Kaleidoskop, Spiegelung und Droste: Rückwärtsabbildung jedes Pixels auf eine Quellposition in Leinwand-Koordinaten.
// Kaleidoskop: Winkel in ein Segment falten (jedes zweite gespiegelt). Droste: logarithmische Polarkoordinaten,
// gedreht um die Verkleinerung je Umlauf (Escher/Lenstra) – das Bild wiederholt sich als Spirale nach innen.
// Globale Abbildung: Reichweite = Leinwand, der Export rendert am Stück.

const PI = 3.14159265;

fn center_px() -> vec2f {
  // Render-px auf der Leinwand
  return select(params.center, params.canvas_size * 0.5, params.centerInMiddle != 0u);
}

/** Spiegelt eine Leinwandposition in den gültigen Bereich (keine Ränder, keine Wiederholung). */
fn fold_into(q: vec2f) -> vec2f {
  let c = params.canvas_size;
  let period = 2.0 * c;
  var m = q - floor(q / period) * period;
  m = select(m, period - m, m > c);
  return clamp(m, vec2f(0.5), c - 0.5);
}

fn effect(p: vec2i) -> vec4f {
  let c = center_px();
  let q = canvas_px(p) - c;
  let zoom = params.zoom / 100.0;
  var src = vec2f(0.0);
  switch params.mode {
    case 0u: {
      let n = f32(params.segments);
      let r = length(q) / zoom;
      var a = atan2(q.y, q.x) - params.rotation;
      let seg = 2.0 * PI / n;
      a = a - floor(a / seg) * seg;
      if (a > seg * 0.5) { a = seg - a; }
      a += params.rotation - PI * 0.5;
      src = c + vec2f(cos(a), sin(a)) * r;
    }
    case 1u: {
      var v = q;
      let rot = mat2x2f(cos(params.rotation), sin(params.rotation), -sin(params.rotation), cos(params.rotation));
      v = transpose(rot) * v;
      if (params.mirrorAxes != 1u) { v.x = -abs(v.x); }
      if (params.mirrorAxes != 0u) { v.y = -abs(v.y); }
      src = c + rot * v / zoom;
    }
    default: {
      // Droste: log-polare Koordinaten z = (ln r, θ), komplexe Drehung um α = atan(ln s / 2π) mit Faktor cos α,
      // danach periodisch in ln r (Periode ln s): das Bild liegt im Ring [r1/s, r1) und wiederholt sich nach innen.
      let r1 = 0.5 * max(params.canvas_size.x, params.canvas_size.y) / zoom;
      let k = log(params.drosteScale);
      let alpha = atan(k / (2.0 * PI));
      let f = cos(alpha);
      let z = vec2f(log(max(length(q), 1e-3) / r1), atan2(q.y, q.x) - params.rotation);
      var w = vec2f(z.x * cos(alpha) - z.y * sin(alpha), z.x * sin(alpha) + z.y * cos(alpha)) * f;
      w.x = w.x - floor(w.x / k) * k - k; // [−ln s, 0)
      let r = exp(w.x) * r1;
      src = c + vec2f(cos(w.y + params.rotation), sin(w.y + params.rotation)) * r;
    }
  }
  return sample_src_canvas(fold_into(src));
}
