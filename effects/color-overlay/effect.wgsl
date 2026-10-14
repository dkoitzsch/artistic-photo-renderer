// Farb-Overlay. Gemischt wird auf sRGB-kodierten Werten (wahrnehmungsnah, wie in Bildprogrammen üblich);
// Ein- und Ausgang bleiben linear und vormultipliziert. Mischformeln nach W3C Compositing Level 1.

fn lum(c: vec3f) -> f32 {
  return dot(c, vec3f(0.3, 0.59, 0.11));
}

fn clip_color(c: vec3f) -> vec3f {
  let l = lum(c);
  let n = min(c.r, min(c.g, c.b));
  let x = max(c.r, max(c.g, c.b));
  var r = c;
  if (n < 0.0) { r = l + (r - l) * l / max(l - n, 1e-6); }
  if (x > 1.0) { r = l + (r - l) * (1.0 - l) / max(x - l, 1e-6); }
  return r;
}

fn set_lum(c: vec3f, l: f32) -> vec3f {
  return clip_color(c + (l - lum(c)));
}

fn sat(c: vec3f) -> f32 {
  return max(c.r, max(c.g, c.b)) - min(c.r, min(c.g, c.b));
}

fn set_sat(c: vec3f, s: f32) -> vec3f {
  let mx = max(c.r, max(c.g, c.b));
  let mn = min(c.r, min(c.g, c.b));
  let range = mx - mn;
  if (range <= 1e-6) { return vec3f(0.0); }
  return (c - mn) * s / range;
}

fn soft_light_ch(b: f32, s: f32) -> f32 {
  if (s <= 0.5) { return b - (1.0 - 2.0 * s) * b * (1.0 - b); }
  var d = sqrt(b);
  if (b <= 0.25) { d = ((16.0 * b - 12.0) * b + 4.0) * b; }
  return b + (2.0 * s - 1.0) * (d - b);
}

fn overlay_ch(b: f32, s: f32) -> f32 {
  if (b <= 0.5) { return 2.0 * b * s; }
  return 1.0 - 2.0 * (1.0 - b) * (1.0 - s);
}

fn blend(b: vec3f, s: vec3f, mode: u32) -> vec3f {
  switch mode {
    case 1u: { return b * s; }
    case 2u: { return b + s - b * s; }
    case 3u: { return vec3f(overlay_ch(b.r, s.r), overlay_ch(b.g, s.g), overlay_ch(b.b, s.b)); }
    case 4u: { return vec3f(soft_light_ch(b.r, s.r), soft_light_ch(b.g, s.g), soft_light_ch(b.b, s.b)); }
    case 5u: { return set_lum(s, lum(b)); }
    case 6u: { return set_lum(set_sat(s, sat(b)), lum(b)); }
    default: { return s; }
  }
}

fn apply_contrast(c: vec3f, amount: f32) -> vec3f {
  // −100 … +100 → Faktor 0 … 3 um Mittelgrau
  let k = select(1.0 + amount / 100.0, 1.0 + 2.0 * amount / 100.0, amount > 0.0);
  return clamp((c - 0.5) * k + 0.5, vec3f(0.0), vec3f(1.0));
}

fn effect(p: vec2i) -> vec4f {
  let src_px = unpremultiply(load_src(p));
  let base = linear_to_srgb(src_px.rgb);
  var over = linear_to_srgb(params.color);
  if (params.duotone != 0u) {
    let l = dot(base, vec3f(0.2126, 0.7152, 0.0722));
    over = mix(linear_to_srgb(params.shadowColor), linear_to_srgb(params.highlightColor), l);
  }
  var result = mix(base, clamp(blend(base, over, params.mode), vec3f(0.0), vec3f(1.0)), params.opacity / 100.0);
  if (params.contrast != 0.0) {
    result = apply_contrast(result, params.contrast);
  }
  return premultiply(vec4f(srgb_to_linear(result), src_px.a));
}
