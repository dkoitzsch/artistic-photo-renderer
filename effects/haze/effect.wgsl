// Dunst (Luftperspektive): Entsättigung, Aufhellung und Mischung zur Dunstfarbe, in linearem Licht.

fn effect(p: vec2i) -> vec4f {
  let c = unpremultiply(load_src(p));
  var a = params.amount / 100.0;
  if (params.byDepth != 0u) {
    a *= load_depth(p);
  }
  let g = luminance(c.rgb);
  var rgb = mix(c.rgb, vec3f(g), a * params.desaturate / 100.0);
  // Aufhellen: Schwarzpunkt anheben
  rgb = mix(rgb, vec3f(1.0), a * params.lift / 100.0 * 0.5);
  rgb = mix(rgb, params.color, a * 0.6);
  return premultiply(vec4f(rgb, c.a));
}
