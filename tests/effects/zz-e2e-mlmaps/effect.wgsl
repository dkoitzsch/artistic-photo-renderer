// Test-Effekt: gibt eine Analysekarte aus Modellen roh aus (Tiefe/Salienz/Gesichter als Grauwert in r, Normalen als
// 0.5 + 0.5·n in rgb) – linear, damit Tests die Werte direkt lesen können (tests/e2e/analysisMaps.spec.ts).
fn effect(p: vec2i) -> vec4f {
  if (params.show == 1u) {
    return vec4f(load_normal(p) * 0.5 + 0.5, 1.0);
  }
  var v = load_depth(p);
  if (params.show == 2u) { v = load_saliency(p); }
  if (params.show == 3u) { v = load_faces(p); }
  return vec4f(vec3f(v), 1.0);
}
