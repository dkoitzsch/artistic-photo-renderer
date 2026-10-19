// Web Worker der Malplan-Analyse: hält die letzte Flächenanalyse und leitet daraus Werte, Notan und Konturen ab.

import {
  analyze,
  contours,
  levelMap,
  medianLightness,
  notanOfRegions,
  valueLevels,
  type Analysis,
  type Region,
} from './analysis';
import { buildPalette, type PaletteEntry } from './palette';

export type MalplanRequest =
  | {
      type: 'analyze';
      id: number;
      rgba: Uint8ClampedArray;
      width: number;
      height: number;
      shapes: number;
      colors: number;
    }
  | { type: 'derive'; id: number; levels: number; minArea: number; threshold: number | null }
  | { type: 'palette'; id: number; count: number; myColors: string[] };

export type MalplanResponse =
  | { type: 'progress'; id: number; progress: number }
  | {
      type: 'analysis';
      id: number;
      width: number;
      height: number;
      labels: Int32Array;
      regions: Region[];
      contours: Float32Array[];
      median: number;
    }
  | { type: 'derived'; id: number; values: Uint8Array; tones: number[]; notan: Uint8Array; threshold: number }
  | {
      type: 'palette';
      id: number;
      entries: PaletteEntry[];
      regionEntry: Int32Array;
      labelPoints: Float32Array;
    }
  | { type: 'error'; id: number; message: string };

let current: Analysis | null = null;

const post = (msg: MalplanResponse, transfer: Transferable[] = []) => {
  (self as unknown as Worker).postMessage(msg, transfer);
};

self.onmessage = (e: MessageEvent<MalplanRequest>) => {
  const req = e.data;
  try {
    if (req.type === 'analyze') {
      const a = analyze(req.rgba, req.width, req.height, { shapes: req.shapes, colors: req.colors }, (p) => {
        post({ type: 'progress', id: req.id, progress: p });
      });
      current = a;
      const lines = contours(a.labels, a.width, a.height);
      const labels = a.labels.slice();
      post(
        {
          type: 'analysis',
          id: req.id,
          width: a.width,
          height: a.height,
          labels,
          regions: a.regions,
          contours: lines,
          median: medianLightness(a),
        },
        [labels.buffer, ...lines.map((l) => l.buffer)],
      );
      return;
    }
    if (!current) throw new Error('Noch keine Analyse vorhanden.');
    const a = current;
    if (req.type === 'palette') {
      const pal = buildPalette(a, req.count, req.myColors);
      post({ type: 'palette', id: req.id, ...pal }, [pal.regionEntry.buffer, pal.labelPoints.buffer]);
      return;
    }
    // Mindestfläche in % der Bildfläche
    const minPixels = Math.round((a.width * a.height * req.minArea) / 100);
    const { level, tones } = valueLevels(a, req.levels);
    const values = levelMap(a, level, minPixels);
    const threshold = req.threshold ?? medianLightness(a);
    const notan = levelMap(a, notanOfRegions(a, threshold), minPixels);
    post({ type: 'derived', id: req.id, values, tones, notan, threshold }, [values.buffer, notan.buffer]);
  } catch (err) {
    post({ type: 'error', id: req.id, message: err instanceof Error ? err.message : String(err) });
  }
};
