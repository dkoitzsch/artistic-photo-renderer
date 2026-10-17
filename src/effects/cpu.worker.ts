// Web Worker für CPU-Effekte (Ausführung "browser-cpu"): lädt effects/<id>/effect.worker.ts und rechnet auf
// der ganzen Ebene. Ein- und Ausgabe im Arbeitsformat (RGBA float16, linear, vormultipliziert).

import type { ParamValue } from './manifest';
import type { CpuEffectModule } from './cpuApi';
import { edges, flow, luminance } from './cpuAnalysis';
import { float32ToHalf, halfToFloat32 } from './half';
import { randCell } from './random';

type Loader = () => Promise<{ default?: CpuEffectModule }>;

const modules: Record<string, Loader> = {
  ...import.meta.glob<{ default?: CpuEffectModule }>('/effects/*/effect.worker.ts'),
  ...(import.meta.env.DEV
    ? import.meta.glob<{ default?: CpuEffectModule }>('/tests/effects/*/effect.worker.ts')
    : {}),
};

export type CpuRequest = {
  type: 'render';
  id: number;
  effectId: string;
  data: Uint16Array;
  width: number;
  height: number;
  params: Record<string, ParamValue>;
  seed: number;
  scale: number;
  origin: [number, number];
  canvasSize: [number, number];
};

export type CpuResponse =
  | { type: 'progress'; id: number; progress: number }
  | { type: 'done'; id: number; data: Uint16Array }
  | { type: 'error'; id: number; message: string };

const post = (msg: CpuResponse, transfer: Transferable[] = []) => {
  (self as unknown as Worker).postMessage(msg, transfer);
};

async function run(req: CpuRequest): Promise<void> {
  const entry = Object.entries(modules).find(([path]) => path.split('/').at(-2) === req.effectId);
  if (!entry) throw new Error(`effect.worker.ts von ${req.effectId} nicht gefunden.`);
  const mod = (await entry[1]()).default;
  if (typeof mod?.render !== 'function')
    throw new Error('effect.worker.ts muss "export default defineCpuEffect({ render })" exportieren.');
  const { width: w, height: h } = req;
  const img = halfToFloat32(req.data);
  let lum: Float32Array | null = null;
  let edg: Float32Array | null = null;
  let flw: Float32Array | null = null;
  let last = 0;
  const out = await mod.render(img, {
    width: w,
    height: h,
    params: req.params,
    seed: req.seed,
    scale: req.scale,
    origin: req.origin,
    canvasSize: req.canvasSize,
    progress: (p) => {
      const now = performance.now();
      if (now - last < 50 && p < 1) return;
      last = now;
      post({ type: 'progress', id: req.id, progress: Math.max(0, Math.min(1, p)) });
    },
    rand: (x, y, k = 0) =>
      randCell(
        Math.floor((x + 0.5 + req.origin[0]) / req.scale),
        Math.floor((y + 0.5 + req.origin[1]) / req.scale),
        req.seed,
        k,
      ),
    luminance: () => (lum ??= luminance(img, w, h)),
    edges: () => (edg ??= edges(img, w, h, req.scale)),
    flow: () => (flw ??= flow(img, w, h, req.scale)),
  });
  if (out.length !== w * h * 4) throw new Error(`Ergebnis hat ${out.length} Werte, erwartet ${w * h * 4}.`);
  for (const v of out) if (!Number.isFinite(v)) throw new Error('Ergebnis enthält NaN/Inf.');
  const half = float32ToHalf(out);
  post({ type: 'done', id: req.id, data: half }, [half.buffer]);
}

self.onmessage = (e: MessageEvent<CpuRequest>) => {
  const req = e.data;
  run(req).catch((err: unknown) => {
    post({ type: 'error', id: req.id, message: err instanceof Error ? err.message : String(err) });
  });
};
