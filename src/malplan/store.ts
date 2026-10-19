// Zustand und Ablauf des Malplans im Hauptthread: Ergebnis im Zuschnitt rendern (Engine), im Worker analysieren,
// Werte/Notan ableiten. Neu gerechnet wird nur, was sich geändert hat (Schlüssel aus Projekt-Render und Einstellungen).

import { create } from 'zustand';
import { getEngine } from '../render/runtime';
import type { Project } from '../state/project';
import type { Region } from './analysis';
import type { EdgeMeasures } from './edges';
import type { PaletteEntry } from './palette';
import type { PlanStep } from './plan';
import type { StrokeGuide } from './strokeGuide';
import { defaultParams } from '../effects/manifest';
import { getPlugin } from '../effects/pluginStore';
import { walk } from '../state/project';
import type { StrokeOptions } from '../../effects/stroke-paint/strokes';
import { normalizeMalplan, type MalplanSettings } from './model';
import type { MalplanRequest, MalplanResponse } from './worker';

/** Lange Kante der Analyse (px): fein genug für A3-Ausdrucke der Flächenhilfen, schnell genug für den Worker. */
export const ANALYSIS_EDGE = 1600;

export type MalplanResult = {
  /** Endbild im Zuschnitt (Analysegröße) */
  image: ImageData;
  width: number;
  height: number;
  labels: Int32Array;
  regions: Region[];
  contours: Float32Array[];
  median: number;
};

export type MalplanDerived = { values: Uint8Array; tones: number[]; notan: Uint8Array; threshold: number };

/** Reduzierte Palette mit Mischrezepten (aus „Meine Farben“) */
export type MalplanPalette = { entries: PaletteEntry[]; regionEntry: Int32Array; labelPoints: Float32Array };

type State = {
  /** pending: Änderung erkannt, Neuberechnung steht an */
  status: 'idle' | 'pending' | 'rendering' | 'analyzing' | 'ready' | 'error';
  progress: number;
  error: string | null;
  result: MalplanResult | null;
  derived: MalplanDerived | null;
  palette: MalplanPalette | null;
  /** Kontrast und Übergangsbreite je Grenzpixel (Kanten-Karte) */
  edges: EdgeMeasures | null;
  /** Schichtplan: Schritte und Schritt je Fläche */
  plan: { steps: PlanStep[]; regionStep: Int8Array } | null;
  /** Strichführung */
  guide: StrokeGuide | null;
};

export const useMalplanStore = create<State>()(() => ({
  status: 'idle',
  progress: 0,
  error: null,
  result: null,
  derived: null,
  palette: null,
  edges: null,
  plan: null,
  guide: null,
}));

let worker: Worker | null = null;
let nextId = 1;
const waiting = new Map<number, { resolve: (m: MalplanResponse) => void; reject: (e: Error) => void }>();

function ensureWorker(): Worker {
  if (worker) return worker;
  const w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  w.onmessage = (e: MessageEvent<MalplanResponse>) => {
    const msg = e.data;
    if (msg.type === 'progress') {
      useMalplanStore.setState({ progress: msg.progress });
      return;
    }
    const p = waiting.get(msg.id);
    if (!p) return;
    waiting.delete(msg.id);
    if (msg.type === 'error') p.reject(new Error(msg.message));
    else p.resolve(msg);
  };
  worker = w;
  return w;
}

type RequestBody = MalplanRequest extends infer R
  ? R extends MalplanRequest
    ? Omit<R, 'id'>
    : never
  : never;

function request(body: RequestBody, transfer: Transferable[] = []): Promise<MalplanResponse> {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    waiting.set(id, { resolve, reject });
    const msg: MalplanRequest = { ...body, id };
    ensureWorker().postMessage(msg, transfer);
  });
}

let analysisKey = '';
let deriveKey = '';
let paletteKey = '';
let planKey = '';
let guideKey = '';
let running: Promise<void> | null = null;
let pending: { project: Project; settings: MalplanSettings } | null = null;

/** Schlüssel der Analyse: alles, was das Bild im Zuschnitt oder die Flächen ändert. */
function keyOf(project: Project, s: MalplanSettings): string {
  return JSON.stringify([project.root, project.originals, project.canvas, s.crop, s.shapes, s.colors]);
}

/** Aktualisiert Analyse und Ableitungen für das Projekt (zusammengefasst; läuft höchstens einmal gleichzeitig). */
export function updateMalplan(project: Project): Promise<void> {
  const settings = normalizeMalplan(project.malplan, project.canvas);
  pending = { project, settings };
  running ??= (async () => {
    try {
      while (pending) {
        const job = pending;
        pending = null;
        await step(job.project, job.settings);
      }
    } finally {
      running = null;
    }
  })();
  return running;
}

async function step(project: Project, s: MalplanSettings): Promise<void> {
  const key = keyOf(project, s);
  try {
    if (key !== analysisKey) {
      const engine = getEngine();
      if (!engine) throw new Error('Keine GPU-Engine');
      useMalplanStore.setState({ status: 'rendering', progress: 0, error: null });
      const image = await engine.renderRegionImage(project, s.crop, ANALYSIS_EDGE);
      useMalplanStore.setState({ status: 'analyzing', progress: 0 });
      const rgba = image.data.slice();
      const res = await request(
        {
          type: 'analyze',
          rgba,
          width: image.width,
          height: image.height,
          shapes: s.shapes,
          colors: s.colors,
        },
        [rgba.buffer],
      );
      if (res.type !== 'analysis') throw new Error('Unerwartete Antwort der Analyse');
      analysisKey = key;
      deriveKey = '';
      paletteKey = '';
      planKey = '';
      guideKey = '';
      const er = await request({ type: 'edges' });
      if (er.type !== 'edges') throw new Error('Unerwartete Antwort der Analyse');
      useMalplanStore.setState({
        edges: { contrast: er.contrast, width: er.width },
        result: {
          image,
          width: res.width,
          height: res.height,
          labels: res.labels,
          regions: res.regions,
          contours: res.contours,
          median: res.median,
        },
      });
    }
    const dKey = JSON.stringify([analysisKey, s.values, s.notan]);
    if (dKey !== deriveKey) {
      const res = await request({
        type: 'derive',
        levels: s.values.levels,
        minArea: s.values.minArea,
        threshold: s.notan.threshold,
      });
      if (res.type !== 'derived') throw new Error('Unerwartete Antwort der Analyse');
      deriveKey = dKey;
      useMalplanStore.setState({
        derived: { values: res.values, tones: res.tones, notan: res.notan, threshold: res.threshold },
      });
    }
    const pKey = JSON.stringify([analysisKey, s.colors, s.myColors]);
    if (pKey !== paletteKey) {
      const res = await request({ type: 'palette', count: s.colors, myColors: s.myColors });
      if (res.type !== 'palette') throw new Error('Unerwartete Antwort der Analyse');
      paletteKey = pKey;
      useMalplanStore.setState({
        palette: { entries: res.entries, regionEntry: res.regionEntry, labelPoints: res.labelPoints },
      });
    }
    const plKey = JSON.stringify([analysisKey, s.technique]);
    if (plKey !== planKey) {
      const res = await request({ type: 'plan', technique: s.technique });
      if (res.type !== 'plan') throw new Error('Unerwartete Antwort der Analyse');
      planKey = plKey;
      useMalplanStore.setState({ plan: { steps: res.steps, regionStep: res.regionStep } });
    }
    const strokePaint = strokePaintOptions(project, s, useMalplanStore.getState().result?.width ?? 1);
    const gKey = JSON.stringify([analysisKey, strokePaint]);
    if (gKey !== guideKey) {
      const res = await request({ type: 'strokes', strokePaint });
      if (res.type !== 'strokes') throw new Error('Unerwartete Antwort der Analyse');
      guideKey = gKey;
      useMalplanStore.setState({ guide: res.guide });
    }
    useMalplanStore.setState({ status: 'ready', progress: 1 });
  } catch (err) {
    useMalplanStore.setState({ status: 'error', error: err instanceof Error ? err.message : String(err) });
  }
}

/**
 * Parameter des ersten sichtbaren, eingeschalteten `stroke-paint`-Effekts, umgerechnet auf den Malplan-Ausschnitt
 * (Analysegröße); null = keiner im Projekt (Strichführung aus dem Richtungsfeld).
 */
export function strokePaintOptions(
  project: Project,
  s: MalplanSettings,
  analysisWidth: number,
): StrokeOptions | null {
  const manifest = getPlugin('stroke-paint')?.manifest;
  if (!manifest) return null;
  for (const n of walk(project.root)) {
    if (!n.visible) continue;
    const fx = n.effects.find((e) => e.effectId === 'stroke-paint' && e.enabled);
    if (!fx) continue;
    const p = { ...defaultParams(manifest), ...fx.params };
    const scale = analysisWidth / Math.max(1, s.crop.width * project.canvas.width);
    return {
      brushSize: Number(p.brushSize),
      levels: Number(p.levels),
      detail: Number(p.detail) / 100,
      length: Number(p.length),
      curvature: Number(p.curvature) / 100,
      direction: p.direction === 'gradient' ? 'gradient' : 'flow',
      jitter: Number(p.jitter) / 100,
      seed: Number(p.seed) || 0,
      scale,
      origin: [s.crop.x * project.canvas.width * scale, s.crop.y * project.canvas.height * scale],
    };
  }
  return null;
}

/** Beim Projektwechsel vergessen. */
export function resetMalplan(): void {
  analysisKey = '';
  deriveKey = '';
  paletteKey = '';
  planKey = '';
  guideKey = '';
  useMalplanStore.setState({
    status: 'idle',
    progress: 0,
    error: null,
    result: null,
    derived: null,
    palette: null,
    edges: null,
    plan: null,
    guide: null,
  });
}
