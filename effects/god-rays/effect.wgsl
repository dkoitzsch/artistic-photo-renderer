// Lichtstrahlen (radiale Streuung): von jedem Pixel aus in Richtung Lichtquelle 48 Proben der „Lichtquelle-Karte“
// (helle Anteile über der Schwelle, ohne Verdecker) aufsummieren, mit Abklingen nach Entfernung. Startversatz je Pixel
// aus ortsfestem Zufall gegen Streifen. Globale Abtastung: Reichweite = Leinwand, Export am Stück.

const STEPS = 48;

fn light_px() -> vec2f {
  let s = params.canvas_size;
  switch params.lightPosition {
    case 0u: { return vec2f(0.5 * s.x, -0.05 * s.y); }
    case 1u: { return vec2f(0.1 * s.x, -0.05 * s.y); }
    case 2u: { return vec2f(0.9 * s.x, -0.05 * s.y); }
    case 3u: { return 0.5 * s; }
    default: { return params.light; }
  }
}

/** Leuchtende Anteile an einer Leinwandposition (Render-px). */
fn emission(q: vec2f) -> vec3f {
  let c = unpremultiply(sample_src_canvas(q));
  let s = clamp(linear_to_srgb(c.rgb), vec3f(0.0), vec3f(1.0));
  let l = luminance(s);
  let t = params.threshold / 100.0;
  var e = smoothstep(t, min(t + 0.25, 1.0), l) * c.a;
  if (params.occlusion == 1u) {
    // Ebenenmaske verdeckt: wo die Ebene sichtbar ist (Maske 1), kommt kein Licht durch
    let mp = vec2i(floor(q - params.origin));
    e *= 1.0 - load_mask(mp);
    e = max(e, (1.0 - load_mask(mp)) * smoothstep(0.2, 0.9, l) * 0.6);
  } else if (params.occlusion == 2u) {
    e = max(e, 0.35 * l);
  }
  return mix(vec3f(1.0), params.color, 0.7) * e;
}

fn effect(p: vec2i) -> vec4f {
  let q = canvas_px(p);
  let lp = light_px();
  let span = (lp - q) * params.length / 100.0;
  let step = span / f32(STEPS);
  let jitter = rand_at(canvas_pos(p), params.seed, 0u);
  let decay = mix(1.0, 0.94, params.decay / 100.0);
  var x = q + step * jitter;
  var w = 1.0;
  var sum = vec3f(0.0);
  var wsum = 0.0;
  for (var i = 0; i < STEPS; i++) {
    sum += emission(x) * w;
    wsum += w;
    w *= decay;
    x += step;
  }
  // Strahlen = Licht entlang der Strecke minus Licht am Pixel selbst: gleichmäßig helle Flächen (Himmel) strahlen
  // nicht flächig, sondern nur dort, wo Licht in dunklere Bereiche fällt
  let own = emission(q);
  let rays = max(sum / max(wsum, 1e-6) - own * 0.6, vec3f(0.0)) * params.intensity / 100.0;
  let base = load_src(p);
  let c = unpremultiply(base).rgb;
  // „Negativ multiplizieren“ in sRGB: hellt auf, ohne zu überstrahlen
  let s = clamp(linear_to_srgb(c), vec3f(0.0), vec3f(1.0));
  let r = clamp(linear_to_srgb(rays * params.color), vec3f(0.0), vec3f(1.0));
  let rgb = srgb_to_linear(1.0 - (1.0 - s) * (1.0 - r));
  return premultiply(vec4f(rgb, max(base.a, min(luminance(rays), 1.0))));
}
