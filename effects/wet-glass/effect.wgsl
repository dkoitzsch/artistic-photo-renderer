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

/** weiches Bild (Bindung src_b) an einer Leinwandposition; nur in compose verwendet */
fn soft_at(q: vec2f) -> vec3f {
  let sz = vec2f(textureDimensions(src_b));
  let qc = clamp(mirror_canvas(q) - params.origin, vec2f(0.5), sz - 0.5);
  return unpremultiply(textureSampleLevel(src_b, linear_sampler, qc / sz, 0.0)).rgb;
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

  // Tropfen (drei Größen: viele kleine, wenige große, in Nestern) und Laufspuren
  if (params.drops > 0.0) {
    let nest = 0.35 + 0.65 * smoothstep(0.3, 0.7, rand_fbm(cp, 0.12 * L, 2u, params.seed + 9u));
    for (var g = 0; g < 3; g++) {
      let big = g == 0;
      let S = max(params.dropSize / 100.0 * L * select(select(1.3, 2.6, g == 1), 5.2, big), 4.0);
      let cell0 = vec2i(floor(cp / S));
      let salt = params.seed + 1200u + u32(g) * 40u;
      for (var k = 0; k < 4; k++) {
        if (k > 0 && (!big || params.trails <= 0.0)) { break; }
        let cell = vec2i(cell0.x, cell0.y - k);
        let jit = vec2f(rand_cell(cell, salt, 1u), rand_cell(cell, salt, 2u));
        let r = S * (0.15 + 0.12 * rand_cell(cell, salt, 3u) * (0.4 + 0.6 * rand_cell(cell, salt, 9u)));
        let centre = (vec2f(cell) + vec2f(0.5) + (jit - 0.5) * 0.24) * S;
        let chance = params.drops / 100.0 * select(select(0.2, 0.3, g == 1), 0.14, big) * nest;
        if (rand_cell(cell, salt, 4u) >= chance) { continue; }
        if (rand_cell(cell, salt, 5u) >= 0.3 + 0.7 * fog_at(centre)) { continue; }
        let l = cp - centre;
        if (k == 0) {
          // unregelmäßiger Umriss, unten schwerer (Eiform), große Tropfen etwas länglich
          let ang = atan2(l.y, l.x);
          let ph = rand_cell(cell, salt, 10u) * 6.2831853;
          let wob = 1.0 + 0.1 * sin(ang * 3.0 + ph) + 0.06 * sin(ang * 5.0 + ph * 1.7);
          let sag = select(1.0, 1.0 + 0.14 + select(0.0, 0.12, big), l.y > 0.0);
          let rv = vec2f(r * wob, r * wob * sag * select(1.0, 1.12, big));
          let u = l / rv;
          let d = length(u);
          if (d < 1.08) {
            // Linse: umgekehrte, am Rand stark gestauchte Abbildung, halb scharf, halb weich (Schärfeebene dahinter)
            let q = centre - u * r * (1.2 + 2.6 * d * d);
            let ca = vec2f(0.012 * r * d, 0.0);
            var dc = vec3f(
              mix(sharp_at(q + ca).r, soft_at(q + ca).r, 0.55),
              mix(sharp_at(q).g, soft_at(q).g, 0.55),
              mix(sharp_at(q - ca).b, soft_at(q - ca).b, 0.55),
            );
            // Licht: unten gebündelt (heller), oben Schatten; weicher dunkler Rand, helle Kaustik unten rechts
            let nrm = normalize(u + vec2f(1e-4));
            let lightSide = dot(nrm, vec2f(0.55, 0.8));
            dc = dc * (1.0 + 0.22 * u.y * d + 0.1 * smoothstep(0.2, 1.0, d) * lightSide);
            dc = dc * (1.0 - 0.38 * smoothstep(0.6, 1.0, d) * (0.5 - 0.5 * lightSide));
            dc = dc + vec3f(1.0, 0.97, 0.92) * 0.22 * smoothstep(0.55, 0.95, d) * max(lightSide, 0.0) * (1.0 - smoothstep(0.95, 1.05, d));
            // weicher Glanz oben links
            let hp = (u - vec2f(-0.38, -0.44)) / vec2f(0.34, 0.2);
            dc = dc + vec3f(1.0, 0.98, 0.95) * 0.32 * exp(-dot(hp, hp) * 2.2);
            let edgeSoft = 0.06 + 0.1 * F;
            c = mix(c, dc, (1.0 - smoothstep(1.0 - edgeSoft, 1.0 + edgeSoft, d)) * 0.92);
          }
        } else if (rand_cell(cell, salt, 6u) < params.trails / 100.0) {
          let tl = S * (1.0 + 2.8 * rand_cell(cell, salt, 7u));
          let wob = sin(l.y / (0.03 * L) + rand_cell(cell, salt, 8u) * 6.0) * r * 0.1;
          let w = max(r * 0.2, 0.8);
          let dx = abs(l.x - wob) / w;
          if (l.y > 0.0 && l.y < tl && dx < 1.0) {
            let along = 1.0 - smoothstep(0.55, 1.0, l.y / tl);
            let edge = smoothstep(0.45, 1.0, dx);
            var tc = mix(sharp, soft, 0.25) * (0.94 - 0.28 * edge);
            tc = tc + vec3f(0.05) * (1.0 - edge) * along;
            c = mix(c, tc, along * (1.0 - smoothstep(0.8, 1.0, dx)) * 0.85);
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
