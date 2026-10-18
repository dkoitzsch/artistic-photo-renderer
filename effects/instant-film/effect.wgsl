// Sofortbild: Farbkurven je Kanal in sRGB (Schatten nach Cyan/Grün, Lichter warm), angehobene Schwärzen, gedämpfte
// Lichter, Vignette, Entwicklerspuren am Bildrand (Rauschen über den Randabstand) und optional ein Rahmen (unten
// breiter). Rahmen und Spuren in Leinwand-Koordinaten (kachelgenau).

fn effect(p: vec2i) -> vec4f {
  let canvas = params.canvas_size / params.scale;
  let cp = canvas_pos(p);
  let src = unpremultiply(load_src(p));
  var s = clamp(linear_to_srgb(src.rgb), vec3f(0.0), vec3f(1.0));
  let l = luminance(s);
  // Farbverschiebung nach Tonwert
  let k = params.colorShift / 100.0;
  let shadow = vec3f(-0.03, 0.03, 0.05) * (1.0 - smoothstep(0.0, 0.5, l));
  let high = vec3f(0.05, 0.02, -0.05) * smoothstep(0.5, 1.0, l);
  s += (shadow + high) * k * 2.0;
  // Wärme
  let w = params.warmth / 100.0;
  s += vec3f(0.04, 0.01, -0.05) * w;
  // Ausbleichen: Schwarz anheben, Weiß senken, Sättigung etwas weg
  let f = params.fade / 100.0;
  s = mix(s, vec3f(luminance(s)), f * 0.25);
  s = s * (1.0 - 0.18 * f) + 0.1 * f;
  // Vignette und Entwicklerspuren im Bildfenster
  var window_min = vec2f(0.0);
  var window_max = canvas;
  if (params.frame != 0u) {
    let b = params.frameSize / 100.0 * min(canvas.x, canvas.y);
    window_min = vec2f(b, b);
    window_max = canvas - vec2f(b, b * 3.0);
  }
  let size = window_max - window_min;
  let u = ((cp - window_min) / size - 0.5) * 2.0;
  s *= 1.0 - params.vignette / 100.0 * 0.45 * smoothstep(0.5, 1.6, length(u));
  let d = min(min(cp.x - window_min.x, window_max.x - cp.x), min(cp.y - window_min.y, window_max.y - cp.y)) /
    min(size.x, size.y);
  let n = rand_fbm(cp, min(canvas.x, canvas.y) * 0.025, 4u, params.seed) - 0.5;
  let c = params.chemistry / 100.0;
  let edge = smoothstep(0.0, 0.06 * c + 0.001, d + n * 0.04 * c);
  // Entwicklerspuren: zum Rand hin heller und leicht farbig (ungleichmäßige Paste)
  s = mix(mix(vec3f(0.95, 0.88, 0.75), s, 0.35), s, mix(1.0, edge, c));
  var out = srgb_to_linear(clamp(s, vec3f(0.0), vec3f(1.0)));
  var a = src.a;
  if (params.frame != 0u) {
    let inside = all(cp >= window_min) && all(cp <= window_max);
    if (!inside) {
      // Rahmen mit leichter Papierstruktur
      let t = rand_fbm(cp, 4.0, 2u, params.seed + 3u) - 0.5;
      out = params.frameColor * (1.0 + t * 0.04);
      a = 1.0;
    }
  }
  return premultiply(vec4f(out, a));
}
