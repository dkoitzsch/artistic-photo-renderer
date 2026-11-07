// Stil übertragen (FLUX): zeigt das gespeicherte Ergebnis des Modells (Parameter „result“, Bild in src_b), das das
// Leinwandbild der Ebene in Modellauflösung ist. Bilinear auf die Leinwand abgetastet (Leinwand-Koordinaten, kachelgenau);
// optional wird feine Struktur des Eingangs (Differenz zu seiner Tiefpassfassung in Ergebnisauflösung) wieder eingeblendet.
// Ohne Ergebnis bleibt der Eingang unverändert. Die Deckkraft kommt vom Eingang (Ebenenform bleibt erhalten).

fn effect(p: vec2i) -> vec4f {
  let base = load_src(p);
  if (params.result == 0u || base.a <= 0.0) { return base; }
  let canvas = params.canvas_size / params.scale;          // Leinwand in Original-px
  let uv = canvas_pos(p) / canvas;
  var rgb = textureSampleLevel(src_b, linear_sampler, uv, 0.0).rgb;
  if (params.keepDetail > 0.0) {
    let texel = canvas / vec2f(textureDimensions(src_b)) * params.scale;   // ein Ergebnis-Texel in Render-px
    let q = canvas_px(p);
    var low = vec3f(0.0);
    low += unpremultiply(sample_src_canvas(q + vec2f(texel.x, 0.0) * 0.5)).rgb;
    low += unpremultiply(sample_src_canvas(q - vec2f(texel.x, 0.0) * 0.5)).rgb;
    low += unpremultiply(sample_src_canvas(q + vec2f(0.0, texel.y) * 0.5)).rgb;
    low += unpremultiply(sample_src_canvas(q - vec2f(0.0, texel.y) * 0.5)).rgb;
    low = low * 0.25;
    let detail = unpremultiply(base).rgb - low;
    rgb = max(rgb + detail * params.keepDetail / 100.0, vec3f(0.0));
  }
  return premultiply(vec4f(rgb, base.a));
}
