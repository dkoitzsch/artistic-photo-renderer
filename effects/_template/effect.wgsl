// Vorlage für einen einstufigen Effekt. Der Kern stellt dieser Datei voran:
//   struct Params { resolution, origin, canvas_size, scale, <deine Parameter> }   → params.<key>
//   src (linear, vormultipliziert), mask_tex, focus_tex, depth_tex, linear_sampler, dst
//   Hilfen: load_src(p), sample_src(uv), load_mask/focus/depth(p), canvas_pos(p),
//           unpremultiply(c), premultiply(c), luminance(rgb), hash21(vec2u),
//           srgb_to_linear(rgb), linear_to_srgb(rgb)
// Einheiten: px-Parameter sind bereits skaliert, Winkel in Radiant, Farben linear, enum/bool als u32.

fn effect(p: vec2i) -> vec4f {
  let dir = vec2f(cos(params.angle), sin(params.angle));
  let shifted = load_src(p - vec2i(round(dir * params.offset)));
  let c = unpremultiply(load_src(p));
  var rgb = c.rgb * params.tint;
  if (params.invert != 0u) {
    rgb = vec3f(1.0) - rgb;
  }
  let fx = premultiply(vec4f(rgb, c.a));
  // Ergebnis: Mischung aus verschobener Kopie und eingefärbtem Original
  return mix(fx, max(fx, shifted), params.amount / 100.0);
}
