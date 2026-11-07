// Echo-Versatz: das Bild wiederholt sich n-mal, jeweils um distance in Richtung angle verschoben, mit abklingender
// Helligkeit, optionalem Farbtonversatz und Vergrößerung je Echo. Alles in Leinwand-Koordinaten (kachelgenau);
// Echos außerhalb der Leinwand tragen nichts bei.

fn echo_at(cp: vec2f, i: f32) -> vec4f {
  let cs = params.canvas_size;
  let L = max(cs.x, cs.y);
  let dir = vec2f(cos(params.angle), sin(params.angle));
  let z = 1.0 + params.zoom / 100.0 * i;
  let centre = 0.5 * cs;
  // Echo i liegt um i·distance hinter dem Bild: Pixel p zeigt dort das Bild an der zurückverschobenen Position
  let q = centre + (cp - dir * params.distance / 100.0 * L * i - centre) / z;
  if (any(q < vec2f(0.5)) || any(q > cs - 0.5)) { return vec4f(0.0); }
  return sample_src_canvas(q);
}

fn hue_shift(c: vec3f, deg: f32) -> vec3f {
  if (abs(deg) < 0.01) { return c; }
  let lab = oklab_from_linear(c);
  let a = radians(deg);
  let ca = cos(a);
  let sa = sin(a);
  return max(linear_from_oklab(vec3f(lab.x, lab.y * ca - lab.z * sa, lab.y * sa + lab.z * ca)), vec3f(0.0));
}

fn effect(p: vec2i) -> vec4f {
  let cp = canvas_px(p);
  let orig = unpremultiply(load_src(p));
  var rgb = orig.rgb;
  var alpha = orig.a;
  let keep = 1.0 - params.decay / 100.0;
  let n = params.count;
  var w = 1.0;
  for (var k = 1; k <= 16; k++) {
    if (k > n) { break; }
    w = w * keep;
    let e = unpremultiply(echo_at(cp, f32(k)));
    if (e.a <= 0.0) { continue; }
    let ec = hue_shift(e.rgb, params.hueShift * f32(k)) * w;
    switch params.mode {
      case 0u: { rgb = max(rgb, ec); alpha = max(alpha, e.a * w); }
      case 1u: { rgb = vec3f(1.0) - (vec3f(1.0) - rgb) * (vec3f(1.0) - ec); alpha = max(alpha, e.a); }
      case 2u: { rgb = rgb + (ec - rgb) * (w / (1.0 + f32(k))) ; alpha = max(alpha, e.a); }
      default: {
        // hinter dem Original: wo das Original durchscheint, gilt es; sonst das Echo
        let t = (1.0 - alpha);
        rgb = rgb * alpha + ec * t;
        alpha = alpha + t * e.a * w;
      }
    }
  }
  return premultiply(vec4f(rgb, alpha));
}
