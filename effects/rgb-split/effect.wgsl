// RGB-Versatz: Rot an p + d, Blau an p − d, Grün an p (bilinear). Radial: d zeigt von der Leinwandmitte nach außen und
// wächst mit dem Abstand (falloff). Alle Längen in Render-px (params.amount ist bereits skaliert).

fn effect(p: vec2i) -> vec4f {
  let size = vec2f(src_size());
  var d: vec2f;
  if (params.mode == 1u) {
    d = vec2f(cos(params.angle), sin(params.angle)) * params.amount;
  } else {
    let c = params.canvas_size * 0.5;
    let q = vec2f(p) + 0.5 + params.origin - c;
    let r = length(q) / max(length(c), 1.0);
    let f = mix(1.0, r, params.falloff / 100.0);
    d = select(vec2f(0.0), q / max(length(q), 1e-6), length(q) > 1e-3) * params.amount * f;
  }
  let uv = (vec2f(p) + 0.5) / size;
  let du = d / size;
  let red = sample_src(uv + du);
  let green = load_src(p);
  let blue = sample_src(uv - du);
  return vec4f(red.r, green.g, blue.b, max(max(red.a, green.a), blue.a));
}
