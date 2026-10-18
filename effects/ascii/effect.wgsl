// ASCII- & Text-Art: Raster aus Zeichenzellen in Leinwand-Koordinaten (Höhe = Zeichengröße, Breite = 60 %). Je Zelle
// mittlere Farbe (4 Proben), Helligkeit wählt die Glyphe (dichtere Zeichen für dunklere Stellen bzw. beim Invertieren für
// hellere) oder der eigene Text läuft fortlaufend durch die Zellen. Glyphen aus dem Atlas in src_b (r = Deckung).

fn cell_color(origin: vec2f, size: vec2f) -> vec4f {
  var sum = vec4f(0.0);
  for (var j = 0; j < 2; j++) {
    for (var i = 0; i < 2; i++) {
      let x = origin + (vec2f(f32(i), f32(j)) * 0.5 + 0.25) * size;
      sum += sample_src_canvas(x * params.scale);
    }
  }
  return sum * 0.25;
}

@compute @workgroup_size(8, 8)
fn ascii(@builtin(global_invocation_id) id: vec3u) {
  let out_size = textureDimensions(dst);
  if (id.x >= out_size.x || id.y >= out_size.y) { return; }
  let p = vec2i(id.xy);
  let count = i32(pass_data.v0.x);
  let columns = i32(pass_data.v0.y);
  let text_mode = pass_data.v0.z > 0.5;
  let atlas_cell = pass_data.v1.xy;
  let atlas_size = pass_data.v1.zw;

  // Zellen in Leinwand-px bei voller Auflösung
  let h = max(params.cellSize / params.scale, 2.0);
  let size = vec2f(h * 0.6, h);
  let cp = canvas_pos(p);
  let cell = floor(cp / size);
  let local = (cp - cell * size) / size;
  let c = unpremultiply(cell_color(cell * size, size));
  let srgb = clamp(linear_to_srgb(c.rgb), vec3f(0.0), vec3f(1.0));
  var l = luminance(srgb);
  let k = params.contrast / 100.0;
  l = clamp((l - 0.5) * select(1.0 + k * 2.0, 1.0 + k, k < 0.0) + 0.5, 0.0, 1.0);
  let density = select(1.0 - l, l, params.invert != 0u);

  var g = 0;
  var ink_amount = 1.0;
  if (text_mode) {
    let canvas = params.canvas_size / params.scale;
    let cols = i32(ceil(canvas.x / size.x));
    let n = i32(cell.y) * cols + i32(cell.x);
    g = ((n % count) + count) % count;
    ink_amount = clamp(density * 1.4, 0.0, 1.0);
  } else {
    g = clamp(i32(round(density * f32(count - 1))), 0, count - 1);
  }
  let atlas_xy = vec2f(f32(g % columns), f32(g / columns)) * atlas_cell + local * atlas_cell;
  let cover = textureSampleLevel(src_b, linear_sampler, atlas_xy / atlas_size, 0.0).r * ink_amount;

  var rgb: vec3f;
  if (params.colorMode == 0u) {
    rgb = mix(params.paper, params.ink, cover);
  } else {
    // Bildfarbe, etwas aufgehellt, damit kleine Zeichen tragen
    let col = srgb_to_linear(clamp(srgb * 1.15 + 0.05, vec3f(0.0), vec3f(1.0)));
    rgb = mix(params.paper, col, cover);
  }
  let a = load_src(p).a;
  textureStore(dst, id.xy, premultiply(vec4f(rgb, a)));
}
