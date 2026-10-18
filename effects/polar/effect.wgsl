// Polarkoordinaten: „Kleiner Planet“ – Winkel um das Zentrum = x der Quelle, Abstand = y (Unterkante in der Mitte,
// Oberkante außen); „Tunnel“ umgekehrt; „Abrollen“ ist die Umkehrabbildung (Kreis → Streifen). Globale Abbildung:
// Reichweite = Leinwand, der Export rendert am Stück. Waagerecht wird nahtlos umlaufend gelesen.

const PI = 3.14159265;

fn effect(p: vec2i) -> vec4f {
  let size = params.canvas_size;
  let c = select(params.center, size * 0.5, params.centerInMiddle != 0u);
  let q = canvas_px(p);
  // Radius bis in die Ecken: der Planet füllt das Bild
  let rmax = 0.5 * length(size) * params.radius / 100.0;
  var src: vec2f;
  if (params.direction == 2u) {
    // Abrollen: x = Winkel, y = Abstand (oben außen)
    let a = q.x / size.x * 2.0 * PI + params.rotation + PI * 0.5;
    let r = (1.0 - q.y / size.y) * rmax;
    src = c + vec2f(cos(a), sin(a)) * r;
  } else {
    let d = q - c;
    var a = atan2(d.y, d.x) - params.rotation - PI * 0.5;
    a = a - floor(a / (2.0 * PI)) * 2.0 * PI;
    let t = clamp(length(d) / rmax, 0.0, 1.0);
    let y = select(1.0 - t, t, params.direction == 1u);
    src = vec2f(a / (2.0 * PI) * size.x, y * size.y);
  }
  // waagerecht umlaufend, senkrecht geklemmt
  src.x = src.x - floor(src.x / size.x) * size.x;
  src = clamp(src, vec2f(0.5), size - 0.5);
  return sample_src_canvas(src);
}
