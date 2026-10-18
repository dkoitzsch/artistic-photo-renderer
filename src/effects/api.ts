// Öffentliche API für mehrstufige Effekte (effects/<id>/effect.ts).
// Einstufige Effekte brauchen kein effect.ts – dort genügt fn effect(p: vec2i) -> vec4f in effect.wgsl.

import type { ParamValue } from './manifest';

export type PassOptions = {
  /** Eingangstextur dieses Passes (Bindung "src"). */
  src: GPUTexture;
  /** Ausgabetextur; ihre Größe bestimmt die Anzahl der Threads (8 × 8 pro Gruppe). */
  dst: GPUTexture;
  /** bis zu 8 Zahlen, im Shader als pass_data.v0 / pass_data.v1 */
  data?: number[];
  /** zweiter Eingang (Bindung "src_b"); Standard: src */
  srcB?: GPUTexture;
};

export type GlyphFont = 'mono' | 'sans' | 'serif';

/** Glyphen-Atlas: Zeichen in festen Zellen (Zeile für Zeile, `columns` je Zeile); r = Deckung 0..1. */
export type GlyphAtlas = {
  texture: GPUTexture;
  count: number;
  columns: number;
  /** Zellgröße einer Glyphe im Atlas in px (Breite, Höhe) */
  cell: readonly [number, number];
  /** mittlere Deckung je Glyphe 0..1 (zum Sortieren nach Dichte) */
  coverage: number[];
};

export interface EffectContext {
  /** Größe der Ausgabe in px */
  readonly width: number;
  readonly height: number;
  /** Pixel-Skalierung: Vorschau < 1, Export = 1 */
  readonly scale: number;
  /** Leinwandgröße in Render-px (bei Export-Kacheln größer als width/height) */
  readonly canvasSize: readonly [number, number];
  /** Lage der Ausgabe auf der Leinwand in Render-px (≠ 0 bei Export-Kacheln) */
  readonly origin: readonly [number, number];
  /** Shaderwerte der Parameter (px bereits skaliert, Winkel in Radiant, Farben linear, enum als Index) */
  readonly params: Readonly<Record<string, number | number[]>>;
  /** Rohwerte wie im Projekt gespeichert */
  readonly raw: Readonly<Record<string, ParamValue>>;
  /** Eingang des Effekts (linear, vormultipliziert, rgba16float) */
  readonly source: GPUTexture;
  /** Hierhin muss der letzte Pass schreiben */
  readonly output: GPUTexture;
  /** true, wenn die Ebene eine Fokuskarte hat (im Shader: has_focus()) */
  readonly hasFocus: boolean;
  /** Zweitbild eines Parameters vom Typ "image" (Original in passender Auflösung) oder null */
  readonly image: GPUTexture | null;
  /** Temporäre Textur (rgba16float); wird nach dem Effekt automatisch freigegeben. */
  texture(width: number, height: number): GPUTexture;
  /** Kern-Gauß (σ = radius / 3, Pyramide für große Radien); dst gleich groß wie src. */
  gaussian(src: GPUTexture, dst: GPUTexture, radius: number, edge?: 'mirror' | 'clamp' | 'transparent'): void;
  /**
   * Glyphen-Atlas für Text- und ASCII-Effekte (gecacht). Im Pass als `srcB` übergeben und mit
   * textureSampleLevel(src_b, linear_sampler, uv, 0.0).r lesen.
   */
  glyphs(chars: string, font?: GlyphFont, weight?: number): GlyphAtlas;
  /** Führt einen Compute-Einstiegspunkt aus effect.wgsl aus. */
  run(entryPoint: string, options: PassOptions): void;
}

export type EffectModule = { run(ctx: EffectContext): void };

export function defineEffect(module: EffectModule): EffectModule {
  return module;
}
