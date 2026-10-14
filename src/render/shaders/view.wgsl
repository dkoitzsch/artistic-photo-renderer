// Anzeige der Leinwand: Bild mit Zoom/Pan über Schachbrett, Ausgabe sRGB-kodiert.

struct View {
  offset: vec2f,      // Bildursprung in CSS-Pixeln
  zoom: f32,          // CSS-Pixel pro Bildpixel
  dpr: f32,           // Geräte-Pixel pro CSS-Pixel
  image_size: vec2f,  // Bildpixel
  has_image: f32,
  checker_size: f32,  // CSS-Pixel
  background: vec4f,  // linear
  checker_a: vec4f,   // linear
  checker_b: vec4f,   // linear
}

@group(0) @binding(0) var<uniform> view: View;
@group(0) @binding(1) var img: texture_2d<f32>;
@group(0) @binding(2) var samp: sampler;

@vertex
fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  var p = array(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  return vec4f(p[i], 0.0, 1.0);
}

// Beim Verkleinern mehrere Abtastungen pro Geräte-Pixel gegen Aliasing (max. 6 x 6).
fn sample_image(px: vec2f) -> vec4f {
  let footprint = 1.0 / (view.zoom * view.dpr);
  if (footprint <= 1.0) {
    return textureSampleLevel(img, samp, px / view.image_size, 0.0);
  }
  let n = u32(min(ceil(footprint), 6.0));
  let step = footprint / f32(n);
  let start = px - vec2f(footprint * 0.5) + vec2f(step * 0.5);
  var sum = vec4f(0.0);
  for (var y = 0u; y < n; y++) {
    for (var x = 0u; x < n; x++) {
      let q = start + vec2f(f32(x), f32(y)) * step;
      sum += textureSampleLevel(img, samp, q / view.image_size, 0.0);
    }
  }
  return sum / f32(n * n);
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
    let s = sample_image(px);
    color = s.rgb + checker * (1.0 - s.a);
  }
  return vec4f(linear_to_srgb(color), 1.0);
}
