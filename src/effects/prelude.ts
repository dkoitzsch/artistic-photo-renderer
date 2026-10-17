// WGSL, das der Kern jedem Effekt-Shader voranstellt bzw. anhängt.

import colorWgsl from '../render/shaders/color.wgsl?raw';
import type { UniformLayout } from './layout';

/** Feste Bindungen aller Effekt-Pipelines (explizites Layout, siehe effectRunner). */
export const BINDINGS = {
  params: 0,
  pass: 1,
  src: 2,
  mask: 3,
  focus: 4,
  depth: 5,
  sampler: 6,
  dst: 7,
  srcB: 8,
  luminance: 9,
  edges: 10,
} as const;

const HELPERS = /* wgsl */ `
struct PassData {
  v0: vec4f, // frei belegbar pro Pass (effect.ts: ctx.run(..., { data }))
  v1: vec4f,
}

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<uniform> pass_data: PassData;
@group(0) @binding(2) var src: texture_2d<f32>;        // linear, vormultipliziert
@group(0) @binding(3) var mask_tex: texture_2d<f32>;   // r: 0..1 (Standard 1)
@group(0) @binding(4) var focus_tex: texture_2d<f32>;  // r: 1 = scharf (ohne Fokuskarte: 0)
@group(0) @binding(5) var depth_tex: texture_2d<f32>;  // r: 0 = nah, 1 = fern (Standard 0)
@group(0) @binding(6) var linear_sampler: sampler;     // linear, clamp-to-edge
@group(0) @binding(7) var dst: texture_storage_2d<rgba16float, write>;
@group(0) @binding(8) var src_b: texture_2d<f32>;      // zweiter Eingang (effect.ts: ctx.run(..., { srcB })), sonst = src
@group(0) @binding(9) var map_luminance: texture_2d<f32>; // Analysekarte "luminance" (r, 0..1); nur mit requires
@group(0) @binding(10) var map_edges: texture_2d<f32>;    // Analysekarte "edges" (r Stärke, gb Tangente, a Kohärenz)

fn src_size() -> vec2i {
  return vec2i(textureDimensions(src));
}

/** Quellpixel mit Klemmung an den Rand. */
fn load_src(p: vec2i) -> vec4f {
  return textureLoad(src, clamp(p, vec2i(0), src_size() - vec2i(1)), 0);
}

/** Bilinear abgetastete Quelle; uv in 0..1 bezogen auf src. */
fn sample_src(uv: vec2f) -> vec4f {
  return textureSampleLevel(src, linear_sampler, uv, 0.0);
}

fn aux_load(t: texture_2d<f32>, p: vec2i) -> f32 {
  let s = vec2f(textureDimensions(t));
  let uv = (vec2f(p) + 0.5) / vec2f(src_size());
  return textureLoad(t, vec2i(clamp(uv * s, vec2f(0.0), s - 1.0)), 0).r;
}

fn load_mask(p: vec2i) -> f32 { return aux_load(mask_tex, p); }

/** true, wenn die Ebene eine Fokuskarte hat */
fn has_focus() -> bool { return (params.flags & 1u) != 0u; }

/**
 * Schärfe an einem Pixel aus der Fokuskarte: 1 = scharf, 0 = volle Wirkung.
 * softness (0…1): 0 = harter Rand um die Fokuspunkte, 1 = weicher Verlauf über den ganzen Radius.
 */
fn focus_sharpness(p: vec2i, softness: f32) -> f32 {
  if (!has_focus()) { return 0.0; }
  return smoothstep(0.0, max(softness, 1e-3), load_focus(p));
}
fn load_focus(p: vec2i) -> f32 { return aux_load(focus_tex, p); }
fn load_depth(p: vec2i) -> f32 { return aux_load(depth_tex, p); }

/** Helligkeit (wahrgenommen, 0..1) aus der Analysekarte "luminance" ("requires": ["luminance"]). */
fn load_luminance(p: vec2i) -> f32 { return aux_load(map_luminance, p); }

fn edges_raw(p: vec2i) -> vec4f {
  let s = vec2f(textureDimensions(map_edges));
  let uv = (vec2f(p) + 0.5) / vec2f(src_size());
  return textureLoad(map_edges, vec2i(clamp(uv * s, vec2f(0.0), s - 1.0)), 0);
}
/** Kantenstärke 0..1 ("requires": ["edges"]). */
fn edge_strength(p: vec2i) -> f32 { return edges_raw(p).r; }
/** Einheitsvektor entlang der Kante (Tangente des geglätteten Strukturtensors). */
fn edge_tangent(p: vec2i) -> vec2f {
  let t = edges_raw(p).gb * 2.0 - 1.0;
  let l = length(t);
  return select(vec2f(0.0, 1.0), t / l, l > 1e-4);
}
/** Kohärenz 0..1 (1 = klare Vorzugsrichtung). */
fn edge_coherence(p: vec2i) -> f32 { return edges_raw(p).a; }

/** Position eines Pixels auf der Leinwand in px bei voller Auflösung (für ortsfeste Muster wie Korn). */
fn canvas_pos(p: vec2i) -> vec2f {
  return (vec2f(p) + 0.5 + params.origin) / params.scale;
}

fn unpremultiply(c: vec4f) -> vec4f {
  if (c.a <= 0.0) { return vec4f(0.0); }
  return vec4f(c.rgb / c.a, c.a);
}

fn premultiply(c: vec4f) -> vec4f {
  return vec4f(c.rgb * c.a, c.a);
}

fn luminance(c: vec3f) -> f32 {
  return dot(c, vec3f(0.2126, 0.7152, 0.0722));
}

/** PCG3D-Hash (Jarzynski & Olano 2020); identisch zu src/effects/random.ts (pcg3). */
fn rand_pcg3(v0: vec3u) -> vec3u {
  var v = v0 * 1664525u + 1013904223u;
  v.x += v.y * v.z;
  v.y += v.z * v.x;
  v.z += v.x * v.y;
  v ^= v >> vec3u(16u);
  v.x += v.y * v.z;
  v.y += v.z * v.x;
  v.z += v.x * v.y;
  return v;
}

/**
 * Zufall 0..1 je Leinwandzelle (ganzzahlige Leinwand-px bei voller Auflösung), Seed und Kanal k.
 * Hängt nur von Leinwandposition und Seed ab → gleich in Vorschau, Export-Kacheln und Endrender.
 */
fn rand_cell(cell: vec2i, seed: u32, k: u32) -> f32 {
  let h = rand_pcg3(vec3u(bitcast<u32>(cell.x), bitcast<u32>(cell.y), seed * 747796405u + k));
  return f32(h.x >> 8u) / 16777216.0;
}

/** Zufall an einer Leinwandposition (z. B. canvas_pos(p)). */
fn rand_at(cp: vec2f, seed: u32, k: u32) -> f32 {
  return rand_cell(vec2i(floor(cp)), seed, k);
}

/** Weiches Wertrauschen 0..1 mit Zellgröße cell (Leinwand-px). */
fn rand_noise(cp: vec2f, cell: f32, seed: u32) -> f32 {
  let q = cp / max(cell, 1e-3);
  let i = vec2i(floor(q));
  let f = fract(q);
  let u = f * f * (3.0 - 2.0 * f);
  let a = rand_cell(i, seed, 0u);
  let b = rand_cell(i + vec2i(1, 0), seed, 0u);
  let c = rand_cell(i + vec2i(0, 1), seed, 0u);
  let d = rand_cell(i + vec2i(1, 1), seed, 0u);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

/** Fraktales Rauschen (Summe von Oktaven, je halbe Zellgröße), 0..1. */
fn rand_fbm(cp: vec2f, cell: f32, octaves: u32, seed: u32) -> f32 {
  var sum = 0.0;
  var amp = 0.5;
  var norm = 0.0;
  var c = cell;
  for (var o = 0u; o < octaves; o++) {
    sum += amp * rand_noise(cp, c, seed + o * 1013u);
    norm += amp;
    amp *= 0.5;
    c *= 0.5;
  }
  return sum / max(norm, 1e-6);
}

/** Oklab (Ottosson 2020) aus linearem sRGB – wahrnehmungsnaher Farbraum für Farbabstände und Paletten. */
fn oklab_from_linear(c: vec3f) -> vec3f {
  let l = 0.4122214708 * c.r + 0.5363325363 * c.g + 0.0514459929 * c.b;
  let m = 0.2119034982 * c.r + 0.6806995451 * c.g + 0.1073969566 * c.b;
  let s = 0.0883024619 * c.r + 0.2817188376 * c.g + 0.6299787005 * c.b;
  let l_ = pow(max(l, 0.0), 1.0 / 3.0);
  let m_ = pow(max(m, 0.0), 1.0 / 3.0);
  let s_ = pow(max(s, 0.0), 1.0 / 3.0);
  return vec3f(
    0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_,
    1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_,
    0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_,
  );
}

/** Lineares sRGB aus Oklab. */
fn linear_from_oklab(lab: vec3f) -> vec3f {
  let l_ = lab.x + 0.3963377774 * lab.y + 0.2158037573 * lab.z;
  let m_ = lab.x - 0.1055613458 * lab.y - 0.0638541728 * lab.z;
  let s_ = lab.x - 0.0894841775 * lab.y - 1.2914855480 * lab.z;
  let l = l_ * l_ * l_;
  let m = m_ * m_ * m_;
  let s = s_ * s_ * s_;
  return vec3f(
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
  );
}

/** Deterministisches Rauschen 0..1 (PCG-Hash). */
fn hash21(p: vec2u) -> f32 {
  var v = p.x * 747796405u + p.y * 2891336453u + 1u;
  v = ((v >> ((v >> 28u) + 4u)) ^ v) * 277803737u;
  v = (v >> 22u) ^ v;
  return f32(v) / 4294967295.0;
}
`;

/** Für Effekte ohne effect.ts: der Plugin-Shader definiert fn effect(p: vec2i) -> vec4f. */
export const SINGLE_PASS_MAIN = /* wgsl */ `
@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3u) {
  let size = textureDimensions(dst);
  if (id.x >= size.x || id.y >= size.y) { return; }
  textureStore(dst, id.xy, effect(vec2i(id.xy)));
}
`;

export function buildPrelude(layout: UniformLayout): string {
  return `${colorWgsl}\n${layout.struct}\n${HELPERS}`;
}

/** Anzahl Zeilen des Vorspanns, damit Fehlermeldungen auf Zeilen in effect.wgsl umgerechnet werden. */
export function lineCount(s: string): number {
  return s.split('\n').length - 1;
}
