// Test-Effekt: Shader-Zufall als Grauwert (tests/e2e/seed.spec.ts)
fn effect(p: vec2i) -> vec4f {
  let r = rand_at(canvas_pos(p), params.seed, 0u);
  return vec4f(vec3f(r), 1.0);
}
