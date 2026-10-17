// Test-Effekt: gibt Kantenstärke bzw. Helligkeit als Grauwert aus, oder das Richtungsfeld (rgb = Rohkanäle)
// (tests/e2e/analysis.spec.ts)
fn effect(p: vec2i) -> vec4f {
  if (params.show == 2u) {
    return vec4f(srgb_to_linear(flow_raw(p).rgb), 1.0);
  }
  let v = select(edge_strength(p), load_luminance(p), params.show == 1u);
  return vec4f(srgb_to_linear(vec3f(v)), 1.0);
}
