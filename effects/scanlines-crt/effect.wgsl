// Röhrenbild & VHS. Alle Muster in Leinwand-Koordinaten bei voller Auflösung (canvas_pos), damit Vorschau, Export-Kacheln
// und Endrender übereinstimmen. Reihenfolge: Wölbung (Rückwärtsabbildung) → Spurfehler → Farbbluten (YIQ: Helligkeit scharf,
// Farbe waagerecht gemittelt) → Leuchten → Zeilen und Lochmaske → Rauschen → Vignette.

fn sample_full(x: vec2f) -> vec4f {
  // x: Leinwand-px bei voller Auflösung (Pixelmitte bei +0.5)
  return sample_src_canvas(x * params.scale);
}

fn rgb_to_yiq(c: vec3f) -> vec3f {
  return vec3f(
    dot(c, vec3f(0.299, 0.587, 0.114)),
    dot(c, vec3f(0.596, -0.274, -0.322)),
    dot(c, vec3f(0.211, -0.523, 0.312)),
  );
}

fn yiq_to_rgb(c: vec3f) -> vec3f {
  return vec3f(
    c.x + 0.956 * c.y + 0.621 * c.z,
    c.x - 0.272 * c.y - 0.647 * c.z,
    c.x - 1.106 * c.y + 1.703 * c.z,
  );
}

fn effect(p: vec2i) -> vec4f {
  let canvas = params.canvas_size / params.scale; // Leinwand in px bei voller Auflösung
  let cp = canvas_pos(p);
  let s = params.scale;

  // Wölbung: Bildschirmkoordinate u ∈ [-1, 1]; nach außen hin weiter weg gelesen (Tonnenverzeichnung)
  let half = canvas * 0.5;
  var u = (cp - half) / half;
  let k = params.curvature / 100.0 * 0.25;
  let aspect = vec2f(canvas.x / max(canvas.x, canvas.y), canvas.y / max(canvas.x, canvas.y));
  let r2 = dot(u * aspect, u * aspect);
  u = u * (1.0 + k * r2) / (1.0 + k * 0.5);
  if (any(abs(u) > vec2f(1.0))) {
    return vec4f(0.0, 0.0, 0.0, 1.0);
  }
  var x = u * half + half;

  // Spurfehler: Bänder unterschiedlicher Höhe, ein Teil davon waagerecht verschoben
  if (params.tracking > 0.0) {
    let band_h = 6.0 + 50.0 * rand_cell(vec2i(0, i32(floor(x.y / 40.0))), params.seed, 3u);
    let band = i32(floor(x.y / band_h));
    let hit = rand_cell(vec2i(band, 7), params.seed, 4u) < params.tracking / 100.0 * 0.35;
    if (hit) {
      let shift = (rand_cell(vec2i(band, 11), params.seed, 5u) - 0.5) * 2.0 * params.tracking / 100.0 * 0.04 * canvas.x;
      x.x += shift;
    }
  }

  // Farbbluten: Helligkeit an x, Farbanteile über eine waagerechte Strecke gemittelt (5 Proben, nach rechts verlaufend)
  let center = sample_full(x);
  var c = unpremultiply(center);
  if (params.bleed > 0.0) {
    let b = params.bleed / s;
    var iq = vec2f(0.0);
    var wsum = 0.0;
    for (var i = 0; i < 5; i++) {
      let t = f32(i) / 4.0;
      let w = 1.0 - 0.6 * t;
      let q = unpremultiply(sample_full(x - vec2f(b * t * 3.0, 0.0)));
      iq += rgb_to_yiq(q.rgb).yz * w;
      wsum += w;
    }
    let yiq = rgb_to_yiq(c.rgb);
    c = vec4f(max(yiq_to_rgb(vec3f(yiq.x, iq / wsum)), vec3f(0.0)), c.a);
  }

  // Leuchten: helle Bereiche strahlen leicht in die Nachbarzeilen
  if (params.glow > 0.0) {
    let g = params.lineSpacing / s;
    let n = unpremultiply(sample_full(x + vec2f(0.0, g))).rgb + unpremultiply(sample_full(x - vec2f(0.0, g))).rgb;
    c = vec4f(c.rgb + max(n * 0.5 - 0.45, vec3f(0.0)) * params.glow / 100.0, c.a);
  }

  // Zeilen: Abstand in Leinwand-px; Zeilenmitte hell, Lücke dunkel (helle Bildteile verbreitern die Zeile)
  let spacing = params.lineSpacing / s;
  let phase = fract(x.y / spacing);
  let beam = 0.5 + 0.5 * cos(phase * 6.2831853);
  let bright = luminance(min(c.rgb, vec3f(1.0)));
  let width = mix(0.35, 0.9, bright);
  let line = smoothstep(1.0 - width, 1.0, beam + (1.0 - width) * 0.6);
  var col = c.rgb * mix(1.0, mix(0.15, 1.15, line), params.lineStrength / 100.0);

  // Lochmaske: senkrechte RGB-Streifen mit einem Drittel des Zeilenabstands je Farbe
  if (params.maskStrength > 0.0) {
    let m = fract(x.x / max(spacing, 1.5));
    let tri = vec3f(
      smoothstep(0.0, 0.15, m) * (1.0 - smoothstep(0.33, 0.48, m)),
      smoothstep(0.33, 0.48, m) * (1.0 - smoothstep(0.66, 0.81, m)),
      max(smoothstep(0.66, 0.81, m), 1.0 - smoothstep(0.0, 0.15, m)),
    );
    col *= mix(vec3f(1.0), 0.45 + 1.35 * tri, params.maskStrength / 100.0);
  }

  // Rauschen: helligkeitsneutral, etwas stärker in dunklen Bereichen
  if (params.noise > 0.0) {
    let n = rand_at(x, params.seed, 0u) - 0.5;
    col += vec3f(n) * params.noise / 100.0 * 0.25 * (1.0 - 0.5 * bright);
  }

  // Vignette am Rand der (gewölbten) Scheibe
  let v = 1.0 - params.vignette / 100.0 * smoothstep(0.35, 1.45, length(u * vec2f(1.0, 0.9)));
  col *= v;
  // weicher Rand der Scheibe
  let edge = 1.0 - smoothstep(0.985, 1.0, max(abs(u.x), abs(u.y)));
  col *= select(1.0, edge, params.curvature > 0.0);
  return premultiply(vec4f(max(col, vec3f(0.0)), max(c.a, select(0.0, 1.0, params.curvature > 0.0))));
}
