// Neu beleuchten (Spec „Effekte“ 5.7): Oberfläche aus Tiefe (Höhe = 1 − Tiefe, Relief ¼ der langen Kante wie die
// Normalenkarte) und Normale; Punktlicht an params.light (Render-px) in der gewählten Höhe vor dem Bild.
// Licht = Umgebungslicht + Lambert · Farbe · Abfall, dazu Glanz (Blinn-Phong); „Altes Licht ausgleichen“ nähert die
// Albedo, indem es die Helligkeit des Fotos Richtung Mittelgrau zieht.

fn effect(p: vec2i) -> vec4f {
  let c = load_src(p);
  if (c.a <= 0.0) { return c; }
  let rgb = c.rgb / c.a;
  let long = max(params.canvas_size.x, params.canvas_size.y);
  let relief = 0.25 * long;
  let pos = vec3f(canvas_px(p), (1.0 - load_depth(p)) * relief);
  let lp = vec3f(params.light, relief + params.height / 100.0 * long);
  let d = lp - pos;
  let dist = length(d);
  let l = d / max(dist, 1e-3);
  let n = load_normal(p);
  let lambert = max(dot(n, l), 0.0);
  let range = params.falloff / 100.0 * long * 1.5;
  let att = 1.0 / (1.0 + (dist / range) * (dist / range));
  let h = normalize(l + vec3f(0.0, 0.0, 1.0));
  let spec = pow(max(dot(n, h), 0.0), 32.0) * params.gloss / 100.0;
  // Albedo: altes Licht teilweise herausrechnen (Helligkeit Richtung 0,18 linear)
  let y = max(luminance(rgb), 1e-4);
  let albedo = rgb * mix(1.0, 0.18 / y, params.flatten / 100.0 * 0.6);
  let light = params.ambient / 100.0 + params.color * (params.intensity / 100.0) * lambert * att * 2.0;
  let out = albedo * light + params.color * spec * att * params.intensity / 100.0;
  return vec4f(max(out, vec3f(0.0)) * c.a, c.a);
}
