// Öffentliche API für Effekte, die auf der CPU im Browser laufen (effects/<id>/effect.worker.ts, Ausführung "browser-cpu").
// Sie bekommen die ganze Ebene (bzw. den Leinwand-Ausschnitt) am Stück – geeignet für globale/sequenzielle Verfahren
// wie Fehlerdiffusion, Pixel-Sorting oder Triangulierung.

import type { ParamValue } from './manifest';

export interface CpuEffectContext {
  /** Breite/Höhe des Bildes in px */
  readonly width: number;
  readonly height: number;
  /** Projektwerte der Parameter (mit Standardwerten ergänzt; px-Werte unskaliert in Leinwand-px) */
  readonly params: Readonly<Record<string, ParamValue>>;
  /** Seed (0, wenn der Effekt keinen hat) */
  readonly seed: number;
  /** Render-px pro Leinwand-px (Vorschau < 1, Export = 1) */
  readonly scale: number;
  /** Lage des Bildes auf der Leinwand (Render-px) und Leinwandgröße (Render-px) */
  readonly origin: readonly [number, number];
  readonly canvasSize: readonly [number, number];
  /** Fortschritt 0..1 melden (Abbruch beendet den Worker) */
  progress(p: number): void;
  /** Zufall 0..1 an Pixel (x, y) für Kanal k – gleich wie rand_at(canvas_pos(p), seed, k) im Shader */
  rand(x: number, y: number, k?: number): number;
  /** Analysekarten wie im Browser/Dienst: Helligkeit (w·h) und Kanten (w·h·4: Stärke, Tangente, Kohärenz) */
  luminance(): Float32Array;
  edges(): Float32Array;
  /** Richtungsfeld (w·h·4: Feldstärke, Tangente, Kohärenz) */
  flow(): Float32Array;
  /** Zweitbild (Parameter vom Typ "image", z. B. Stilbild): RGBA float32 linear, vormultipliziert, oder null */
  imageB(): { data: Float32Array; width: number; height: number } | null;
}

export type CpuEffectModule = {
  /** image: RGBA float32, linear, vormultipliziert (w·h·4); Rückgabe im selben Format und gleicher Größe */
  render(image: Float32Array, ctx: CpuEffectContext): Float32Array | Promise<Float32Array>;
};

export function defineCpuEffect(module: CpuEffectModule): CpuEffectModule {
  return module;
}
