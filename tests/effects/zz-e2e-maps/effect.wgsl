// Test-Effekt: gibt Kantenstärke bzw. Helligkeit als Grauwert aus (tests/e2e/analysis.spec.ts)
fn effect(p: vec2i) -> vec4f {
  let v = select(edge_strength(p), load_luminance(p), params.show == 1u);
  return vec4f(srgb_to_linear(vec3f(v)), 1.0);
}
