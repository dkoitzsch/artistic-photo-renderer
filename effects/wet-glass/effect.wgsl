// Beschlagene Scheibe. Mehrstufig (effect.ts): zwei Unschärfen (Kern-Gauß) → je nach Beschlagfeld mischen → Komposition
// (senkrechte Schlieren, Schleier, Tropfen als Linsen mit umgekehrter Abbildung, Laufspuren, Farbe, Körnung).
// Beschlagfeld, Tropfen und Spuren hängen nur von Leinwandkoordinaten und Seed ab: Vorschau, Kacheln, Endrender gleich.

fn longest() -> f32 { return max(params.canvas_size.x, params.canvas_size.y); }

fn mirror_canvas(q: vec2f) -> vec2f {
  let cs = params.canvas_size;
  return cs - abs(cs - abs(q));
}

/** scharfes Bild an einer Leinwandposition (Bindung src) */
fn sharp_at(q: vec2f) -> vec3f {
  return unpremultiply(sample_src_canvas(clamp(mirror_canvas(q), vec2f(0.5), params.canvas_size - 0.5))).rgb;
}

fn subject_p(p: vec2i) -> f32 {
  var v = max(load_saliency(p), load_faces(p));
  if (has_focus()) { v = max(v, load_focus(p)); }
  return clamp(v, 0.0, 1.0);
}

fn subject_c(q: vec2f) -> f32 {
  let size = vec2i(src_size());
  return subject_p(clamp(vec2i(floor(q - params.origin)), vec2i(0), size - vec2i(1)));
}

/** Beschlag 0..1 an einer Leinwandposition */
fn fog_at(cp: vec2f) -> f32 {
  let L = longest();
  let fs = params.fogSize / 100.0 * L;
  let q = cp + (vec2f(rand_fbm(cp, 0.2 * L, 2u, params.seed + 5u), rand_fbm(cp + vec2f(41.0, 77.0), 0.2 * L, 2u, params.seed + 6u)) - 0.5) * 0.25 * L;
  let n = rand_fbm(q, fs, 3u, params.seed + 11u);
  let runs = rand_fbm(vec2f(q.x * 5.0, q.y), fs * 0.6, 3u, params.seed + 12u);
  let f0 = mix(n, runs, 0.35);
  let a = params.fog / 100.0;
  var f = smoothstep(1.0 - a * 1.1 - 0.15, 1.0 - a * 1.1 + 0.2, f0);
  let wn = rand_fbm(vec2f(q.x * 3.0, q.y), fs * 0.8, 2u, params.seed + 21u);
  f = f * (1.0 - params.wipe / 100.0 * smoothstep(0.55, 0.68, wn));
  f = f * (1.0 - params.subjectClear / 100.0 * smoothstep(0.05, 0.5, subject_c(cp)));
  return clamp(f, 0.0, 1.0);
}

@compute @workgroup_size(8, 8)
fn copy_src(@builtin(global_invocation_id) id: vec3u) {
  let size = textureDimensions(dst);
  if (id.x >= size.x || id.y >= size.y) { return; }
  textureStore(dst, id.xy, textureLoad(src, vec2i(id.xy), 0));
}

@compute @workgroup_size(8, 8)
fn blend_blur(@builtin(global_invocation_id) id: vec3u) {
  let size = textureDimensions(dst);
  if (id.x >= size.x || id.y >= size.y) { return; }
  let p = vec2i(id.xy);
  let f = fog_at(canvas_px(p));
  textureStore(dst, p, mix(textureLoad(src, p, 0), textureLoad(src_b, p, 0), f));
}

fn screen_lum(c: vec3f) -> f32 { return luminance(c); }

@compute @workgroup_size(8, 8)
fn compose(@builtin(global_invocation_id) id: vec3u) {
  let size = textureDimensions(dst);
  if (id.x >= size.x || id.y >= size.y) { return; }
  let p = vec2i(id.xy);
  let cp = canvas_px(p);
  let L = longest();
  let sz = vec2f(size);
  let uv = (vec2f(p) + 0.5) / sz;
  let a0 = textureLoad(src, p, 0);
  let sharp = unpremultiply(a0).rgb;
  let F = fog_at(cp);

  // weicher Anteil mit senkrechten Schlieren
  var soft = unpremultiply(textureLoad(src_b, p, 0)).rgb;
  if (params.smearV > 0.0 && F > 0.01) {
    let len = params.smearLength / 100.0 * L * F * (0.5 + rand_noise(cp, 0.05 * L, params.seed + 31u));
    var sum = vec3f(0.0);
    for (var i = 0; i < 12; i++) {
      let t = f32(i) / 11.0 - 0.5;
      sum += unpremultiply(textureSampleLevel(src_b, linear_sampler, uv + vec2f(0.0, t * len) / sz, 0.0)).rgb;
    }
    soft = mix(soft, sum / 12.0, params.smearV / 100.0);
  }
  var c = mix(sharp, soft, clamp(F * 1.5, 0.0, 1.0));
  // milchiger Schleier
  c = mix(c, params.fogColor * (0.55 + 0.9 * luminance(c)), F * params.haze / 100.0 * 0.6);

  // Tropfen (zwei Größen) und Laufspuren
  if (params.drops > 0.0) {
    for (var g = 0; g < 2; g++) {
      let big = g == 0;
      let S = max(params.dropSize / 100.0 * L * select(1.0, 3.2, big), 5.0);
      let cell0 = vec2i(floor(cp / S));
      let salt = params.seed + 1200u + u32(g) * 40u;
      for (var k = 0; k < 4; k++) {
        if (k > 0 && (!big || params.trails <= 0.0)) { break; }
        let cell = vec2i(cell0.x, cell0.y - k);
        let jit = vec2f(rand_cell(cell, salt, 1u), rand_cell(cell, salt, 2u));
        let r = S * (0.2 + 0.2 * rand_cell(cell, salt, 3u));
        let centre = (vec2f(cell) + vec2f(0.5) + (jit - 0.5) * 0.5) * S;
        let chance = params.drops / 100.0 * select(0.5, 0.28, big);
        if (rand_cell(cell, salt, 4u) >= chance) { continue; }
        if (rand_cell(cell, salt, 5u) >= 0.35 + 0.65 * fog_at(centre)) { continue; }
        let l = cp - centre;
        if (k == 0) {
          let d = length(l / vec2f(r * 0.92, r * 1.08));
          if (d < 1.0) {
            var dc = sharp_at(centre - l * 2.4) * 1.05;
            dc = dc * (1.0 - 0.3 * smoothstep(0.75, 1.0, d));
            let hl = 1.0 - smoothstep(0.1, 0.22, length(l + vec2f(0.35, 0.4) * r) / r);
            let rimv = smoothstep(0.78, 0.97, d) * max(dot(normalize(l + vec2f(1e-3)), vec2f(0.7, 0.7)), 0.0);
            dc = dc + vec3f(1.0, 0.97, 0.92) * (hl * 0.7 + rimv * 0.3);
            c = mix(c, dc, 1.0 - smoothstep(0.93, 1.0, d));
          }
        } else if (rand_cell(cell, salt, 6u) < params.trails / 100.0) {
          let tl = S * (1.0 + 2.8 * rand_cell(cell, salt, 7u));
          let wob = sin(l.y / (0.03 * L) + rand_cell(cell, salt, 8u) * 6.0) * r * 0.08;
          let w = max(r * 0.16, 0.8);
          let dx = abs(l.x - wob) / w;
          if (l.y > 0.0 && l.y < tl && dx < 1.0) {
            let along = 1.0 - smoothstep(0.6, 1.0, l.y / tl);
            let edge = smoothstep(0.55, 1.0, dx);
            var tc = sharp * (0.92 - 0.35 * edge);
            tc = tc + vec3f(0.08) * (1.0 - edge) * along;
            c = mix(c, tc, along * (1.0 - smoothstep(0.85, 1.0, dx)) * 0.9);
          }
        }
      }
    }
  }

  // Farbe, Kontrast, Körnung, Vignette
  let lum = luminance(c);
  c = mix(vec3f(lum), c, params.saturation / 100.0);
  var s = clamp(linear_to_srgb(max(c, vec3f(0.0))), vec3f(0.0), vec3f(1.0));
  s = mix(s, s * s * (3.0 - 2.0 * s), params.contrast / 100.0);
  if (params.grain > 0.0) {
    let gc = max(0.0008 * L, 1.0);
    let cell = vec2i(floor(cp / gc));
    let nl = rand_cell(cell, params.seed + 3u, 1u) - 0.5;
    s = s + vec3f(nl) * params.grain / 100.0 * 0.18;
  }
  if (params.vignette > 0.0) {
    let v = (cp - 0.5 * params.canvas_size) / (0.5 * L);
    s = s * (1.0 - params.vignette / 100.0 * smoothstep(0.45, 1.25, length(v)));
  }
  textureStore(dst, p, premultiply(vec4f(srgb_to_linear(clamp(s, vec3f(0.0), vec3f(1.0))), a0.a)));
}
