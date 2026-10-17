// Doppelbelichtung: Zweitbild (src_b) füllt die Leinwand (Zoom, Versatz); gemischt mit dem Mischmodus in sRGB und
// gewichtet nach Helligkeit des Grundbilds bzw. Ebenenmaske. Zweitbild per textureLoad in Leinwand-Koordinaten
// abgetastet (kachelgenau).

fn second_at(p: vec2i) -> vec4f {
  let isz = vec2f(textureDimensions(src_b));
  let canvas = params.canvas_size / params.scale;              // Leinwand in Original-px
  let cover = max(canvas.x / isz.x, canvas.y / isz.y) * params.zoom / 100.0;
  let center = canvas * (0.5 + vec2f(params.offsetX, params.offsetY) / 100.0);
  let t = (canvas_pos(p) - center) / cover + isz * 0.5 - 0.5;  // Texelkoordinaten (Pixelmitte = ganzzahlig)
  let i = vec2i(floor(t));
  let f = t - floor(t);
  let mx = vec2i(isz) - vec2i(1);
  let a = textureLoad(src_b, clamp(i, vec2i(0), mx), 0);
  let b = textureLoad(src_b, clamp(i + vec2i(1, 0), vec2i(0), mx), 0);
  let c = textureLoad(src_b, clamp(i + vec2i(0, 1), vec2i(0), mx), 0);
  let d = textureLoad(src_b, clamp(i + vec2i(1, 1), vec2i(0), mx), 0);
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

fn blend(b: vec3f, s: vec3f) -> vec3f {
  switch params.blend {
    case 0u: { return b + s - b * s; }
    case 1u: { return b * s; }
    case 2u: { return max(b, s); }
    case 3u: {
      return select(1.0 - 2.0 * (1.0 - b) * (1.0 - s), 2.0 * b * s, b <= vec3f(0.5));
    }
    default: { return s; }
  }
}

fn effect(p: vec2i) -> vec4f {
  let base = load_src(p);
  if (params.image == 0u || base.a <= 0.0) { return base; }
  let c = unpremultiply(base);
  let bs = linear_to_srgb(clamp(c.rgb, vec3f(0.0), vec3f(1.0)));
  let sec = unpremultiply(second_at(p));
  let ss = linear_to_srgb(clamp(sec.rgb, vec3f(0.0), vec3f(1.0)));
  let l = luminance(bs);
  let w = mix(0.5, 0.04, params.contrast / 100.0);
  var m = 1.0;
  switch params.mask {
    case 0u: { m = 1.0 - smoothstep(0.5 - w, 0.5 + w, l); }
    case 1u: { m = smoothstep(0.5 - w, 0.5 + w, l); }
    case 2u: { m = load_mask(p); }
    default: { m = 1.0; }
  }
  m *= sec.a * params.amount / 100.0;
  let mixed = mix(bs, clamp(blend(bs, ss), vec3f(0.0), vec3f(1.0)), m);
  return premultiply(vec4f(srgb_to_linear(mixed), c.a));
}
