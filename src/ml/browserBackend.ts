// Browser-Backend: führt Modelle im ML-Worker aus (UI blockiert nicht).

import type { LicenseMode } from '../state/project';
import { useAppStore } from '../state/store';
import type { DownloadCommand, LandmarkResult, Progress, WorkerRequest, WorkerResponse } from './protocol';
import type { ModelEntry } from './registry';

type Pending = {
  resolve: (r: WorkerResponse) => void;
  reject: (e: Error) => void;
  onProgress: (p: Progress) => void;
};

let worker: Worker | null = null;

/** Nur im Dev-Server: lokaler Modell-Spiegel für Tests (localStorage 'bls.modelMirror'). */
function modelMirror(): string | null {
  if (!import.meta.env.DEV) return null;
  try {
    return localStorage.getItem('bls.modelMirror');
  } catch {
    return null;
  }
}
const pending = new Map<number, Pending>();
let nextId = 1;

function getWorker(): Worker {
  if (worker) return worker;
  const w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module', name: 'ml' });
  w.onmessage = (e: MessageEvent<WorkerResponse>) => {
    const msg = e.data;
    if (msg.type === 'download-state') {
      useAppStore.getState().setDownloads(msg.states);
      return;
    }
    const p = pending.get(msg.id);
    if (!p) return;
    if (msg.type === 'progress') {
      p.onProgress(msg.progress);
      return;
    }
    pending.delete(msg.id);
    if (msg.type === 'error') p.reject(new Error(msg.message));
    else p.resolve(msg);
  };
  w.onerror = (e) => {
    for (const p of pending.values()) p.reject(new Error(`ML-Worker abgestürzt: ${e.message}`));
    pending.clear();
    worker = null;
  };
  worker = w;
  return w;
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

function request(
  req: DistributiveOmit<WorkerRequest, 'id'>,
  onProgress: (p: Progress) => void,
): Promise<WorkerResponse> {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject, onProgress });
    getWorker().postMessage({ ...req, id, mirror: modelMirror() }, 'image' in req ? [req.image] : []);
  });
}

export async function browserSegment(
  model: ModelEntry,
  image: ImageBitmap,
  licenseMode: LicenseMode,
  onProgress: (p: Progress) => void,
): Promise<{ mask: Float32Array; width: number; height: number; ms: number }> {
  const res = await request({ type: 'segment', modelId: model.id, licenseMode, image }, onProgress);
  if (res.type !== 'segment-result') throw new Error('Unerwartete Antwort des ML-Workers.');
  return res;
}

export async function browserDepth(
  model: ModelEntry,
  image: ImageBitmap,
  licenseMode: LicenseMode,
  onProgress: (p: Progress) => void,
): Promise<{ mask: Float32Array; width: number; height: number; ms: number }> {
  const res = await request({ type: 'depth', modelId: model.id, licenseMode, image }, onProgress);
  if (res.type !== 'segment-result') throw new Error('Unerwartete Antwort des ML-Workers.');
  return res;
}

export async function browserLandmarks(
  image: ImageBitmap,
  licenseMode: LicenseMode,
  onProgress: (p: Progress) => void,
): Promise<LandmarkResult> {
  const res = await request({ type: 'landmarks', image, licenseMode }, onProgress);
  if (res.type !== 'landmarks-result') throw new Error('Unerwartete Antwort des ML-Workers.');
  return res.result;
}

/** Steuerung der Browser-Modell-Downloads (Zustand kommt als download-state in den Store). */
export async function browserDownload(cmd: DownloadCommand, modelId?: string): Promise<void> {
  const licenseMode = useAppStore.getState().licenseMode;
  const res = await request(
    modelId ? { type: 'downloads', cmd, modelId, licenseMode } : { type: 'downloads', cmd, licenseMode },
    () => undefined,
  );
  if (res.type !== 'done') throw new Error('Unerwartete Antwort des ML-Workers.');
}
