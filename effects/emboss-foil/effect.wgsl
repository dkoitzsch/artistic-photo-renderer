// Prägung & Metallfolie: src = Eingang, src_b = geglättete Fassung. Höhe = wahrgenommene Helligkeit der geglätteten
// Fassung; Normale aus dem Gradienten (Höhe in Leinwand-px skaliert, damit Vorschau und Export gleich hell wirken).
// Metall: farbige Reflexion mit Glanzlicht (Blinn-Phong) und einem weichen Umgebungsverlauf; Blindprägung: Papierweiß.

fn h_at(p: vec2i) -> f32 {
  let s = vec2i(textureDimensions(src_b)) - vec2i(1);
  let c = unpremultiply(textureLoad(src_b, clamp(p, vec2i(0), s), 0));
  let l = luminance(clamp(linear_to_srgb(c.rgb), vec3f(0.0), vec3f(1.0)));
  return select(l, 1.0 - l, params.invert != 0u);
}

fn metal_color() -> vec3f {
  switch params.metal {
    case 1u: { return srgb_to_linear(vec3f(0.95, 0.76, 0.33)); }
    case 2u: { return srgb_to_linear(vec3f(0.85, 0.86, 0.88)); }
    case 3u: { return srgb_to_linear(vec3f(0.88, 0.5, 0.3)); }
    case 4u: { return srgb_to_linear(vec3f(0.92, 0.66, 0.6)); }
    default: { return srgb_to_linear(vec3f(0.96, 0.95, 0.92)); }
  }
}

@compute @workgroup_size(8, 8)
fn emboss(@builtin(global_invocation_id) id: vec3u) {
  let size = textureDimensions(dst);
  if (id.x >= size.x || id.y >= size.y) { return; }
  let p = vec2i(id.xy);
  // Gradient je Leinwand-px (Render-px · scale), Höhe 0..1 mal Prägetiefe in px
  let depth = params.height / 100.0 * 6.0;
  let gx = (h_at(p + vec2i(1, 0)) - h_at(p - vec2i(1, 0))) * 0.5 * params.scale * depth;
  let gy = (h_at(p + vec2i(0, 1)) - h_at(p - vec2i(0, 1))) * 0.5 * params.scale * depth;
  let n = normalize(vec3f(-gx, -gy, 1.0));
  let l = normalize(vec3f(cos(params.lightAngle), sin(params.lightAngle), 0.9));
  let v = vec3f(0.0, 0.0, 1.0);
  let hv = normalize(l + v);
  let diff = max(dot(n, l), 0.0);
  let g = params.gloss / 100.0;
  let spec = pow(max(dot(n, hv), 0.0), mix(8.0, 90.0, g)) * g * 1.6;
  let base = metal_color();
  var col: vec3f;
  if (params.metal == 0u) {
    col = base * (0.45 + 0.6 * diff) + vec3f(spec * 0.3);
  } else {
    // Metall: kaum diffus, Reflexion farbig; Umgebungsverlauf über die Normale
    let env = 0.35 + 0.45 * (0.5 + 0.5 * n.y) + 0.2 * (0.5 + 0.5 * n.x);
    col = base * (0.25 + 0.55 * diff + 0.35 * env) + base * spec;
  }
  let srcc = unpremultiply(textureLoad(src, p, 0));
  col = mix(col, col * srcc.rgb * 1.6, params.keepColor / 100.0);
  textureStore(dst, id.xy, premultiply(vec4f(max(col, vec3f(0.0)), srcc.a)));
}
