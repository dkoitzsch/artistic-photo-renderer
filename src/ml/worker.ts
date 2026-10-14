/// <reference lib="webworker" />
// ML-Worker: Modelle laden (einmalig, mit Fortschritt, SHA-256-geprüft, im OPFS gecacht) und ausführen.
// Segmentierung mit onnxruntime-web (WebGPU), Fokuspunkte mit MediaPipe Face/Pose Landmarker.

import { FaceLandmarker, PoseLandmarker } from '@mediapipe/tasks-vision';
import * as ort from 'onnxruntime-web/webgpu';
import type { LicenseMode } from '../state/project';
import type { LandmarkResult, Progress, WorkerRequest, WorkerResponse } from './protocol';
import { assertAllowed, modelById, type ModelEntry, type ModelFile } from './registry';

declare const self: DedicatedWorkerGlobalScope;

// Laufzeit-Dateien lokal ausliefern (keine CDN-Anfragen; siehe vendorAssets in vite.config.ts)
const vendor = (path: string) =>
  new URL(`${import.meta.env.BASE_URL}vendor/${path}`, self.location.origin).href;
ort.env.wasm.wasmPaths = {
  mjs: vendor('ort/ort-wasm-simd-threaded.asyncify.mjs'),
  wasm: vendor('ort/ort-wasm-simd-threaded.asyncify.wasm'),
};
ort.env.wasm.numThreads = 1;
ort.env.logLevel = 'error';

const post = (msg: WorkerResponse, transfer: Transferable[] = []) => {
  self.postMessage(msg, transfer);
};

// ---------- Modell-Dateien ----------

async function modelDir(): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle('models', { create: true });
}

async function sha256(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Lädt eine Modelldatei aus dem OPFS-Cache oder einmalig aus dem Netz (mit Fortschritt). */
let mirror: string | null = null;

async function fetchModelFile(
  file: ModelFile,
  onProgress: (p: Progress) => void,
): Promise<Uint8Array<ArrayBuffer>> {
  const dir = await modelDir();
  try {
    const cached = await (await dir.getFileHandle(file.name)).getFile();
    if (cached.size === file.size) return new Uint8Array(await cached.arrayBuffer());
  } catch {
    // nicht im Cache
  }
  const res = await fetch(mirror ? `${mirror}${file.name}` : file.url);
  if (!res.ok || !res.body) throw new Error(`Download von ${file.name} fehlgeschlagen (HTTP ${res.status}).`);
  const total = file.size;
  const out = new Uint8Array(total);
  let loaded = 0;
  const reader = res.body.getReader();
  let last = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (loaded + value.length > total) throw new Error(`${file.name}: unerwartete Dateigröße.`);
    out.set(value, loaded);
    loaded += value.length;
    const now = performance.now();
    if (now - last > 100) {
      last = now;
      onProgress({ stage: 'download', label: file.name, loaded, total });
    }
  }
  if (loaded !== total)
    throw new Error(`${file.name}: Download unvollständig (${loaded} von ${total} Byte).`);
  onProgress({ stage: 'download', label: file.name, loaded, total });
  if ((await sha256(out)) !== file.sha256)
    throw new Error(`${file.name}: Prüfsumme stimmt nicht – Datei verworfen.`);
  const handle = await dir.getFileHandle(file.name, { create: true });
  const w = await handle.createWritable();
  await w.write(out);
  await w.close();
  return out;
}

function modelFile(model: ModelEntry): ModelFile {
  const f = model.files?.[0];
  if (!f) throw new Error(`${model.name}: keine Datei im Register.`);
  return f;
}

// ---------- Segmentierung (ONNX) ----------

const sessions = new Map<string, Promise<ort.InferenceSession>>();
let ortDevice: Promise<void> | null = null;

/**
 * Eigenes WebGPU-Gerät für ONNX Runtime mit den Limits des Adapters: BiRefNet braucht z. B.
 * 17 Storage-Buffer pro Shader-Stufe (Standard: 8).
 */
function prepareOrtDevice(): Promise<void> {
  ortDevice ??= (async () => {
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) throw new Error('Kein WebGPU-Adapter im ML-Worker.');
    const names = [
      'maxStorageBuffersPerShaderStage',
      'maxStorageBufferBindingSize',
      'maxBufferSize',
      'maxComputeWorkgroupStorageSize',
      'maxComputeInvocationsPerWorkgroup',
      'maxComputeWorkgroupSizeX',
      'maxComputeWorkgroupSizeY',
      'maxComputeWorkgroupSizeZ',
      'maxComputeWorkgroupsPerDimension',
    ] as const;
    const requiredLimits: Record<string, number> = {};
    for (const n of names) requiredLimits[n] = adapter.limits[n];
    const requiredFeatures: GPUFeatureName[] = adapter.features.has('shader-f16') ? ['shader-f16'] : [];
    const device = await adapter.requestDevice({ requiredLimits, requiredFeatures });
    ort.env.webgpu.device = device;
  })();
  return ortDevice;
}

function session(model: ModelEntry, onProgress: (p: Progress) => void): Promise<ort.InferenceSession> {
  let s = sessions.get(model.id);
  if (!s) {
    s = (async () => {
      const bytes = await fetchModelFile(modelFile(model), onProgress);
      onProgress({ stage: 'load', label: model.name, loaded: 0, total: 1 });
      await prepareOrtDevice();
      const sess = await ort.InferenceSession.create(bytes, {
        executionProviders: ['webgpu'],
        graphOptimizationLevel: 'all',
        logSeverityLevel: 3,
      });
      onProgress({ stage: 'load', label: model.name, loaded: 1, total: 1 });
      return sess;
    })();
    s.catch(() => sessions.delete(model.id));
    sessions.set(model.id, s);
  }
  return s;
}

/** float32 → IEEE half (für fp16-Eingänge) */
function toHalf(src: Float32Array): Uint16Array {
  const out = new Uint16Array(src.length);
  const f = new Float32Array(1);
  const u = new Uint32Array(f.buffer);
  for (let i = 0; i < src.length; i++) {
    f[0] = src[i] ?? 0;
    const x = u[0] ?? 0;
    const sign = (x >>> 16) & 0x8000;
    const exp = ((x >>> 23) & 0xff) - 112;
    const mant = x & 0x7fffff;
    if (exp <= 0) out[i] = sign;
    else if (exp >= 31) out[i] = sign | 0x7c00;
    else out[i] = sign | (exp << 10) | ((mant + 0x1000) >>> 13);
  }
  return out;
}

function fromHalf(h: number): number {
  const s = h & 0x8000 ? -1 : 1;
  const e = (h >> 10) & 0x1f;
  const m = h & 0x3ff;
  if (e === 0) return s * 2 ** -14 * (m / 1024);
  if (e === 31) return m ? NaN : s * Infinity;
  return s * 2 ** (e - 15) * (1 + m / 1024);
}

function tensorToFloat32(t: ort.Tensor): Float32Array {
  const d = t.data;
  if (d instanceof Float32Array) return d;
  if (t.type === 'float16') {
    if (d instanceof Uint16Array) return Float32Array.from(d, fromHalf);
    return Float32Array.from(d as ArrayLike<number>);
  }
  return Float32Array.from(d as ArrayLike<number>);
}

async function segment(
  model: ModelEntry,
  image: ImageBitmap,
  onProgress: (p: Progress) => void,
): Promise<{ mask: Float32Array; width: number; height: number }> {
  const input = model.input;
  if (!input) throw new Error(`${model.name}: Eingabeformat fehlt im Register.`);
  const sess = await session(model, onProgress);
  const S = input.size;
  onProgress({ stage: 'infer', label: model.name, loaded: 0, total: 1 });

  // Bild auf S × S strecken (wie im Preprocessing der Modelle) und normalisieren (NCHW)
  const canvas = new OffscreenCanvas(S, S);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('2D-Kontext im Worker nicht verfügbar.');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(image, 0, 0, S, S);
  const px = ctx.getImageData(0, 0, S, S).data;
  const chw = new Float32Array(3 * S * S);
  const [m0 = 0, m1 = 0, m2 = 0] = input.mean;
  const [s0 = 1, s1 = 1, s2 = 1] = input.std;
  for (let i = 0; i < S * S; i++) {
    chw[i] = ((px[i * 4] ?? 0) / 255 - m0) / s0;
    chw[S * S + i] = ((px[i * 4 + 1] ?? 0) / 255 - m1) / s1;
    chw[2 * S * S + i] = ((px[i * 4 + 2] ?? 0) / 255 - m2) / s2;
  }
  const inputName = sess.inputNames[0] ?? 'input';
  const meta = sess.inputMetadata[0];
  const isHalf = meta?.isTensor === true && meta.type === 'float16';
  const tensor = isHalf
    ? new ort.Tensor('float16', toHalf(chw), [1, 3, S, S])
    : new ort.Tensor('float32', chw, [1, 3, S, S]);
  const outputs = await sess.run({ [inputName]: tensor });
  // letzte Ausgabe = feinste Maske (BiRefNet liefert mehrere Stufen)
  const outName = sess.outputNames[sess.outputNames.length - 1] ?? '';
  const out = outputs[outName];
  if (!out) throw new Error(`${model.name}: keine Ausgabe.`);
  const raw = tensorToFloat32(out);
  const dims = out.dims;
  const oh = dims[dims.length - 2] ?? S;
  const ow = dims[dims.length - 1] ?? S;
  const prob = new Float32Array(ow * oh);
  if (model.output === 'logits') {
    for (let i = 0; i < prob.length; i++) prob[i] = 1 / (1 + Math.exp(-(raw[i] ?? 0)));
  } else {
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < prob.length; i++) {
      const v = raw[i] ?? 0;
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
    const d = hi - lo || 1;
    for (let i = 0; i < prob.length; i++) prob[i] = ((raw[i] ?? 0) - lo) / d;
  }
  for (const t of Object.values(outputs)) t.dispose();

  // zurück auf die Seitenverhältnisse des Eingabebilds (bilinear)
  const W = image.width;
  const H = image.height;
  const mask = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    const fy = Math.max(0, ((y + 0.5) * oh) / H - 0.5);
    const y0 = Math.min(oh - 1, Math.floor(fy));
    const y1 = Math.min(oh - 1, y0 + 1);
    const ty = fy - y0;
    for (let x = 0; x < W; x++) {
      const fx = Math.max(0, ((x + 0.5) * ow) / W - 0.5);
      const x0 = Math.min(ow - 1, Math.floor(fx));
      const x1 = Math.min(ow - 1, x0 + 1);
      const tx = fx - x0;
      const a = (prob[y0 * ow + x0] ?? 0) * (1 - tx) + (prob[y0 * ow + x1] ?? 0) * tx;
      const b = (prob[y1 * ow + x0] ?? 0) * (1 - tx) + (prob[y1 * ow + x1] ?? 0) * tx;
      mask[y * W + x] = a * (1 - ty) + b * ty;
    }
  }
  onProgress({ stage: 'infer', label: model.name, loaded: 1, total: 1 });
  return { mask, width: W, height: H };
}

// ---------- Fokuspunkte (MediaPipe) ----------

let landmarkers: Promise<{ face: FaceLandmarker; pose: PoseLandmarker }> | null = null;

function getLandmarkers(mode: LicenseMode, onProgress: (p: Progress) => void) {
  landmarkers ??= (async () => {
    const faceModel = modelById('mediapipe-face-landmarker');
    const poseModel = modelById('mediapipe-pose-landmarker');
    if (!faceModel || !poseModel) throw new Error('Landmarker fehlen im Register.');
    assertAllowed(faceModel, mode);
    assertAllowed(poseModel, mode);
    const [faceBytes, poseBytes] = await Promise.all([
      fetchModelFile(modelFile(faceModel), onProgress),
      fetchModelFile(modelFile(poseModel), onProgress),
    ]);
    // MediaPipe löscht ModuleFactory nach jedem Erzeugen; ein ES-Modul wird aber nur einmal ausgeführt.
    // Daher die Factory vor jedem createFromOptions selbst setzen.
    const loader = (await import(/* @vite-ignore */ vendor('mediapipe/vision_wasm_module_internal.js'))) as {
      default?: unknown;
    };
    const setFactory = () => {
      (self as unknown as { ModuleFactory?: unknown }).ModuleFactory = loader.default;
    };
    setFactory();
    const fileset = {
      wasmLoaderPath: vendor('mediapipe/vision_wasm_module_internal.js'),
      wasmBinaryPath: vendor('mediapipe/vision_wasm_module_internal.wasm'),
    };
    const face = await FaceLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetBuffer: faceBytes, delegate: 'CPU' },
      runningMode: 'IMAGE',
      numFaces: 4,
    });
    setFactory();
    const pose = await PoseLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetBuffer: poseBytes, delegate: 'CPU' },
      runningMode: 'IMAGE',
      numPoses: 4,
    });
    return { face, pose };
  })();
  landmarkers.catch(() => {
    landmarkers = null;
  });
  return landmarkers;
}

async function detectLandmarks(
  image: ImageBitmap,
  mode: LicenseMode,
  onProgress: (p: Progress) => void,
): Promise<LandmarkResult> {
  const { face, pose } = await getLandmarkers(mode, onProgress);
  onProgress({ stage: 'infer', label: 'Fokuspunkte', loaded: 0, total: 1 });
  const f = face.detect(image);
  const p = pose.detect(image);
  onProgress({ stage: 'infer', label: 'Fokuspunkte', loaded: 1, total: 1 });
  return {
    faces: f.faceLandmarks.map((l) => l.map(({ x, y }) => ({ x, y }))),
    poses: p.landmarks.map((l) => l.map(({ x, y, visibility }) => ({ x, y, visibility }))),
  };
}

// ---------- Nachrichten ----------

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const req = e.data;
  mirror = req.mirror ?? null;
  const onProgress = (progress: Progress) => {
    post({ type: 'progress', id: req.id, progress });
  };
  const t0 = performance.now();
  try {
    if (req.type === 'segment') {
      const model = modelById(req.modelId);
      if (!model || model.runtime !== 'browser')
        throw new Error(`Unbekanntes Browser-Modell ${req.modelId}.`);
      assertAllowed(model, req.licenseMode);
      const r = await segment(model, req.image, onProgress);
      post({ type: 'segment-result', id: req.id, ...r, ms: performance.now() - t0 }, [r.mask.buffer]);
    } else {
      const result = await detectLandmarks(req.image, req.licenseMode, onProgress);
      post({ type: 'landmarks-result', id: req.id, result, ms: performance.now() - t0 });
    }
  } catch (err) {
    post({ type: 'error', id: req.id, message: err instanceof Error ? err.message : String(err) });
  } finally {
    req.image.close();
  }
};
