// Anzeige der Leinwand: Vorschau-Textur mit Zoom/Pan über Schachbrett, optional Vorher/Nachher-Teilung.
// Ausgabe sRGB-kodiert.

struct View {
  offset: vec2f,      // Bildursprung in CSS-Pixeln
  zoom: f32,          // CSS-Pixel pro Leinwand-Pixel
  dpr: f32,           // Geräte-Pixel pro CSS-Pixel
  image_size: vec2f,  // Leinwand in px (volle Auflösung)
  has_image: f32,
  checker_size: f32,  // CSS-Pixel
  background: vec4f,  // linear
  checker_a: vec4f,   // linear
  checker_b: vec4f,   // linear
  split_x: f32,       // CSS-Pixel; < 0 = keine Teilung (links „vorher“)
  overlay: f32,       // 0 aus, 1 Maske (rot = ausgeblendet), 2 Fokuskarte, 3 Tiefe (Farbskala),
                      // 4 Analysekarte grau (r), 5 Kantenkarte (Farbe = Richtung, Helligkeit = Stärke)
  overlay_opacity: f32, // nur 4/5: Deckkraft der Karte über dem Bild
  _p2: f32,
  detail_origin: vec2f, // Ausschnitt in voller Auflösung: Ursprung der Textur in Leinwand-px
  has_detail: f32,
  _p3: f32,
  detail_rect: vec4f,   // gültiger Bereich (x0, y0, x1, y1) in Leinwand-px
}

@group(0) @binding(0) var<uniform> view: View;
@group(0) @binding(1) var after_tex: texture_2d<f32>;
@group(0) @binding(2) var before_tex: texture_2d<f32>;
@group(0) @binding(3) var samp: sampler;
@group(0) @binding(4) var overlay_tex: texture_2d<f32>;
@group(0) @binding(5) var detail_after: texture_2d<f32>;
@group(0) @binding(6) var detail_before: texture_2d<f32>;
@group(0) @binding(7) var detail_samp: sampler;

@vertex
fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  var p = array(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  return vec4f(p[i], 0.0, 1.0);
}

// Beim Verkleinern mehrere Abtastungen pro Geräte-Pixel gegen Aliasing (max. 6 x 6).
fn sample_image(t: texture_2d<f32>, px: vec2f) -> vec4f {
  let tex_size = vec2f(textureDimensions(t));
  let footprint = (1.0 / (view.zoom * view.dpr)) * (tex_size.x / view.image_size.x);
  let uv = px / view.image_size;
  if (footprint <= 1.0) {
    return textureSampleLevel(t, samp, uv, 0.0);
  }
  let n = u32(min(ceil(footprint), 6.0));
  let step_uv = (footprint / f32(n)) / tex_size;
  let start = uv - step_uv * (f32(n) - 1.0) * 0.5;
  var sum = vec4f(0.0);
  for (var y = 0u; y < n; y++) {
    for (var x = 0u; x < n; x++) {
      sum += textureSampleLevel(t, samp, start + vec2f(f32(x), f32(y)) * step_uv, 0.0);
    }
  }
  return sum / f32(n * n);
}

// Ausschnitt in Leinwandauflösung (1 Textur-px = 1 Leinwand-px); verkleinert mit Mehrfachabtastung wie oben.
fn sample_detail(t: texture_2d<f32>, px: vec2f) -> vec4f {
  let tex_size = vec2f(textureDimensions(t));
  let footprint = 1.0 / (view.zoom * view.dpr);
  let uv = (px - view.detail_origin) / tex_size;
  if (footprint <= 1.0) {
    return textureSampleLevel(t, detail_samp, uv, 0.0);
  }
  let n = u32(min(ceil(footprint), 6.0));
  let step_uv = (footprint / f32(n)) / tex_size;
  let start = uv - step_uv * (f32(n) - 1.0) * 0.5;
  var sum = vec4f(0.0);
  for (var y = 0u; y < n; y++) {
    for (var x = 0u; x < n; x++) {
      sum += textureSampleLevel(t, detail_samp, start + vec2f(f32(x), f32(y)) * step_uv, 0.0);
    }
  }
  return sum / f32(n * n);
}

// Farbskala nah (warm) → fern (kühl), angelehnt an „turbo“
fn depth_colormap(t: f32) -> vec3f {
  let x = clamp(1.0 - t, 0.0, 1.0);
  let r = clamp(0.13 + x * (4.6 - x * 4.0), 0.0, 1.0);
  let g = clamp(sin(x * 3.14159), 0.0, 1.0);
  let b = clamp(0.95 - x * 1.3 + x * x * 0.4, 0.0, 1.0);
  return vec3f(r, g, b);
}

@fragment
fn fs(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let css = pos.xy / view.dpr;
  let rel = css - view.offset;
  let px = rel / view.zoom;
  var color = view.background.rgb;
  if (view.has_image > 0.5 && all(px >= vec2f(0.0)) && all(px < view.image_size)) {
    let cell = vec2i(floor(rel / view.checker_size));
    let checker = select(view.checker_a.rgb, view.checker_b.rgb, ((cell.x + cell.y) & 1) == 1);
    var s: vec4f;
    let left = view.split_x >= 0.0 && css.x < view.split_x;
    // textureSampleLevel braucht keine einheitliche Kontrollflussbedingung; alle Abtastungen bleiben gültig
    let in_detail = view.has_detail > 0.5 && all(px >= view.detail_rect.xy) && all(px < view.detail_rect.zw);
    if (in_detail) {
      s = select(sample_detail(detail_after, px), sample_detail(detail_before, px), left);
    } else if (left) {
      s = sample_image(before_tex, px);
    } else {
      s = sample_image(after_tex, px);
    }
    color = s.rgb + checker * (1.0 - s.a);
    if (view.overlay > 0.5) {
      let o = textureSampleLevel(overlay_tex, samp, px / view.image_size, 0.0).r;
      if (view.overlay < 1.5) {
        color = mix(color, vec3f(0.8, 0.05, 0.05), 0.6 * (1.0 - o));
      } else if (view.overlay < 2.5) {
        color = mix(color * 0.45, vec3f(1.0, 0.75, 0.1), 0.75 * o);
      } else if (view.overlay < 3.5) {
        color = mix(color, srgb_to_linear(depth_colormap(o)), 0.8);
      } else if (view.overlay < 4.5) {
        color = mix(color, srgb_to_linear(vec3f(o)), view.overlay_opacity);
      } else {
        let e = textureSampleLevel(overlay_tex, samp, px / view.image_size, 0.0);
        let t = e.gb * 2.0 - 1.0;
        // Richtung (ohne Vorzeichen) als Farbton: Winkel 0..π → Farbkreis
        let h = atan2(t.y, t.x) * 2.0;
        let hue = 0.5 + 0.5 * vec3f(cos(h), cos(h - 2.094), cos(h + 2.094));
        color = mix(color, srgb_to_linear(hue * e.r), view.overlay_opacity);
      }
    }
  }
  return vec4f(linear_to_srgb(color), 1.0);
}
