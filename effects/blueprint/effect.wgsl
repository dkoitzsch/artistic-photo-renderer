// Blaupause: src = fein geglättet, src_b = gröber geglättet. Linien dort, wo die feine Fassung dunkler ist als die
// grobe (Differenz zweier Gauß-Filter, nur die dunkle Seite – ergibt Linien statt Doppelkanten). Raster und Struktur in
// Leinwand-Koordinaten (kachelgenau).

fn lum(c: vec4f) -> f32 {
  let u = unpremultiply(c);
  return luminance(clamp(linear_to_srgb(u.rgb), vec3f(0.0), vec3f(1.0)));
}

@compute @workgroup_size(8, 8)
fn blueprint(@builtin(global_invocation_id) id: vec3u) {
  let size = textureDimensions(dst);
  if (id.x >= size.x || id.y >= size.y) { return; }
  let p = vec2i(id.xy);
  let a = lum(textureLoad(src, p, 0));
  let b = lum(textureLoad(src_b, p, 0));
  let d = b - a; // > 0: feine Stelle dunkler als Umgebung
  let thr = mix(0.06, 0.008, params.detail / 100.0);
  var line = smoothstep(thr, thr * 2.5, d);
  let cp = canvas_pos(p);
  // Schattierung: dunkle Bildteile etwas heller (wie durchscheinendes Lichtpausenpapier)
  let shade = (1.0 - a) * params.shading / 100.0 * 0.35;
  var rgb = mix(params.blue, params.lineColor, shade);
  // Raster: feine Linien, jede fünfte kräftiger
  if (params.grid != 0u) {
    let g = params.gridSize / params.scale;
    let px = 1.0 / params.scale;
    let f = abs(fract(cp / g + 0.5) - 0.5) * g;
    let major = abs(fract(cp / (g * 5.0) + 0.5) - 0.5) * g * 5.0;
    let minor_line = 1.0 - smoothstep(0.35 * px, 0.35 * px + 0.8, min(f.x, f.y));
    let major_line = 1.0 - smoothstep(0.7 * px, 0.7 * px + 0.8, min(major.x, major.y));
    rgb = mix(rgb, params.lineColor, max(minor_line * 0.12, major_line * 0.25));
  }
  rgb = mix(rgb, params.lineColor, line);
  // Papierstruktur
  let t = rand_fbm(cp, 3.0, 3u, params.seed) - 0.5;
  rgb *= 1.0 + t * params.texture / 100.0 * 0.25;
  textureStore(dst, id.xy, premultiply(vec4f(clamp(rgb, vec3f(0.0), vec3f(1.0)), textureLoad(src, p, 0).a)));
}
