/// <reference lib="webworker" />
// ML-Worker: Modelle laden (einmalig, mit Fortschritt, SHA-256-geprüft, im OPFS gecacht) und ausführen.
// Segmentierung mit onnxruntime-web (WebGPU), Fokuspunkte mit MediaPipe Face/Pose Landmarker.

import { FaceLandmarker, PoseLandmarker } from '@mediapipe/tasks-vision';
import * as ort from 'onnxruntime-web/webgpu';
import type { LicenseMode } from '../state/project';
import type { LandmarkResult, Progress, WorkerRequest, WorkerResponse } from './protocol';
import * as downloads from './downloads';
import { assertAllowed, MODELS, modelById, type ModelEntry, type ModelFile } from './registry';

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

// ---------- Modell-Dateien (Download-Manager: downloads.ts) ----------

/** nur Entwicklung/Tests: lokaler Modell-Spiegel */
let mirror: string | null = null;

downloads.onDownloadStates((states) => {
  post({ type: 'download-state', states });
});

/** Alle Browser-Modelldateien aus dem Register beim Manager anmelden (einmal). */
let scanned: Promise<void> | null = null;
function ensureScanned(): Promise<void> {
  scanned ??= downloads.scan(
    MODELS.filter((m) => m.runtime === 'browser').flatMap((m) =>
      (m.files ?? []).map((file) => ({ modelId: m.id, file })),
    ),
  );
  return scanned;
}

/** Datei für die Inferenz (lädt bei Bedarf herunter, mit Fortschritt). */
async function fetchModelFile(
  file: ModelFile,
  onProgress: (p: Progress) => void,
): Promise<Uint8Array<ArrayBuffer>> {
  await ensureScanned();
  return downloads.bytesFor(file.name, mirror, (loaded, total) => {
    onProgress({ stage: 'download', label: file.name, loaded, total });
  });
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
  // letzte Ausgabe = feinste Maske (BiRefNet liefert mehrere Stufen); U²-Net: erste (fusionierte) Ausgabe
  const outName = sess.outputNames[model.outputIndex ?? sess.outputNames.length - 1] ?? '';
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

// ---------- Smarte Auswahl (SAM 2.1) ----------

type SamPair = { encoder: ort.InferenceSession; decoder: ort.InferenceSession };
const samSessions = new Map<string, Promise<SamPair>>();
/** Bildmerkmale je Schlüssel (wenige, sie sind groß: ≈ 10 MB je Bild) */
const samEmbeddings = new Map<string, ort.Tensor[]>();
const SAM_EMBEDDINGS_MAX = 3;

/** Datei eines Modells nach dem Namensende (z. B. „vision_encoder_fp16.onnx“) */
function samFile(model: ModelEntry, suffix: string): ModelFile {
  const f = model.files?.find((x) => x.name.endsWith(suffix));
  if (!f) throw new Error(`${model.name}: Datei ${suffix} fehlt im Register.`);
  return f;
}

function samPair(model: ModelEntry, onProgress: (p: Progress) => void): Promise<SamPair> {
  let s = samSessions.get(model.id);
  if (!s) {
    s = (async () => {
      const load = async (name: string) => {
        const graph = await fetchModelFile(samFile(model, `${name}.onnx`), onProgress);
        const data = await fetchModelFile(samFile(model, `${name}.onnx_data`), onProgress);
        onProgress({ stage: 'load', label: model.name, loaded: 0, total: 1 });
        await prepareOrtDevice();
        // externe Gewichte unter dem Namen, auf den das Modell verweist
        return ort.InferenceSession.create(graph, {
          executionProviders: ['webgpu'],
          graphOptimizationLevel: 'all',
          logSeverityLevel: 3,
          externalData: [{ path: `${name}.onnx_data`, data }],
        });
      };
      const encoder = await load('vision_encoder_fp16');
      const decoder = await load('prompt_encoder_mask_decoder_fp16');
      onProgress({ stage: 'load', label: model.name, loaded: 1, total: 1 });
      return { encoder, decoder };
    })();
    s.catch(() => samSessions.delete(model.id));
    samSessions.set(model.id, s);
  }
  return s;
}

async function samEncode(model: ModelEntry, pair: SamPair, image: ImageBitmap): Promise<ort.Tensor[]> {
  const input = model.input;
  if (!input) throw new Error(`${model.name}: Eingabeformat fehlt im Register.`);
  const S = input.size;
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
  const out = await pair.encoder.run({ pixel_values: new ort.Tensor('float32', chw, [1, 3, S, S]) });
  const e = ['image_embeddings.0', 'image_embeddings.1', 'image_embeddings.2'].map((n) => out[n]);
  if (e.some((t) => !t)) throw new Error(`${model.name}: Bildmerkmale fehlen.`);
  return e as ort.Tensor[];
}

async function samDecode(
  model: ModelEntry,
  pair: SamPair,
  emb: ort.Tensor[],
  points: [number, number, number][],
): Promise<{ mask: Float32Array; width: number; height: number }> {
  const S = model.input?.size ?? 1024;
  const n = Math.max(1, points.length);
  const coords = new Float32Array(n * 2);
  const labels = new BigInt64Array(n);
  points.forEach(([x, y, l], i) => {
    coords[i * 2] = x * S;
    coords[i * 2 + 1] = y * S;
    labels[i] = BigInt(l);
  });
  const [e0, e1, e2] = emb;
  if (!e0 || !e1 || !e2) throw new Error('Bildmerkmale unvollständig.');
  const out = await pair.decoder.run({
    input_points: new ort.Tensor('float32', coords, [1, 1, n, 2]),
    input_labels: new ort.Tensor('int64', labels, [1, 1, n]),
    input_boxes: new ort.Tensor('float32', new Float32Array(0), [1, 0, 4]),
    'image_embeddings.0': e0,
    'image_embeddings.1': e1,
    'image_embeddings.2': e2,
  });
  const iou = out.iou_scores;
  const masks = out.pred_masks;
  if (!iou || !masks) throw new Error(`${model.name}: keine Maske.`);
  const scores = tensorToFloat32(iou);
  let best = 0;
  for (let i = 1; i < scores.length; i++) if ((scores[i] ?? 0) > (scores[best] ?? 0)) best = i;
  const dims = masks.dims;
  const h = dims[dims.length - 2] ?? 256;
  const w = dims[dims.length - 1] ?? 256;
  const raw = tensorToFloat32(masks);
  const mask = new Float32Array(w * h);
  const off = best * w * h;
  for (let i = 0; i < w * h; i++) mask[i] = 1 / (1 + Math.exp(-(raw[off + i] ?? 0)));
  iou.dispose();
  masks.dispose();
  out.object_score_logits?.dispose();
  return { mask, width: w, height: h };
}

// ---------- Tiefe (Depth Anything) ----------

/**
 * Relative Tiefe 0 = nah … 1 = fern in der Größe des Eingabebilds.
 * Eingabe mit erhaltenem Seitenverhältnis, kurze Kante = input.size, Kanten auf Vielfache von 14.
 */
async function estimateDepth(
  model: ModelEntry,
  image: ImageBitmap,
  onProgress: (p: Progress) => void,
): Promise<{ mask: Float32Array; width: number; height: number }> {
  const input = model.input;
  if (!input) throw new Error(`${model.name}: Eingabeformat fehlt im Register.`);
  const sess = await session(model, onProgress);
  onProgress({ stage: 'infer', label: model.name, loaded: 0, total: 1 });
  const s = input.size / Math.min(image.width, image.height);
  const iw = Math.max(14, Math.round((image.width * s) / 14) * 14);
  const ih = Math.max(14, Math.round((image.height * s) / 14) * 14);
  const canvas = new OffscreenCanvas(iw, ih);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('2D-Kontext im Worker nicht verfügbar.');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(image, 0, 0, iw, ih);
  const px = ctx.getImageData(0, 0, iw, ih).data;
  const n = iw * ih;
  const chw = new Float32Array(3 * n);
  const [m0 = 0, m1 = 0, m2 = 0] = input.mean;
  const [s0 = 1, s1 = 1, s2 = 1] = input.std;
  for (let i = 0; i < n; i++) {
    chw[i] = ((px[i * 4] ?? 0) / 255 - m0) / s0;
    chw[n + i] = ((px[i * 4 + 1] ?? 0) / 255 - m1) / s1;
    chw[2 * n + i] = ((px[i * 4 + 2] ?? 0) / 255 - m2) / s2;
  }
  const meta = sess.inputMetadata[0];
  const isHalf = meta?.isTensor === true && meta.type === 'float16';
  const tensor = isHalf
    ? new ort.Tensor('float16', toHalf(chw), [1, 3, ih, iw])
    : new ort.Tensor('float32', chw, [1, 3, ih, iw]);
  const outputs = await sess.run({ [sess.inputNames[0] ?? 'pixel_values']: tensor });
  const out = outputs[sess.outputNames[0] ?? ''];
  if (!out) throw new Error(`${model.name}: keine Ausgabe.`);
  const raw = tensorToFloat32(out);
  const dims = out.dims;
  const oh = dims[dims.length - 2] ?? ih;
  const ow = dims[dims.length - 1] ?? iw;
  for (const t of Object.values(outputs)) t.dispose();
  // Disparität (groß = nah) robust normieren (1 %/99 %) und umkehren: 0 = nah, 1 = fern
  const sorted = Float32Array.from(raw).sort();
  const lo = sorted[Math.floor(sorted.length * 0.01)] ?? 0;
  const hi = sorted[Math.floor(sorted.length * 0.99)] ?? 1;
  const span = hi - lo || 1;
  const W = image.width;
  const H = image.height;
  const depth = new Float32Array(W * H);
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
      const a = (raw[y0 * ow + x0] ?? 0) * (1 - tx) + (raw[y0 * ow + x1] ?? 0) * tx;
      const b = (raw[y1 * ow + x0] ?? 0) * (1 - tx) + (raw[y1 * ow + x1] ?? 0) * tx;
      const d = (a * (1 - ty) + b * ty - lo) / span;
      depth[y * W + x] = 1 - Math.min(1, Math.max(0, d));
    }
  }
  onProgress({ stage: 'infer', label: model.name, loaded: 1, total: 1 });
  return { mask: depth, width: W, height: H };
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
    // WASM einmal asynchron laden und der Factory mitgeben: sonst lädt Emscripten es per synchronem XHR, das im Worker
    // nach vorangegangenen ORT-Sitzungen gelegentlich mit „NetworkError“ scheitert (Stolperstein S24)
    const wasmRes = await fetch(vendor('mediapipe/vision_wasm_module_internal.wasm'));
    if (!wasmRes.ok) throw new Error(`MediaPipe-WASM: HTTP ${wasmRes.status}`);
    const wasmBinary = await wasmRes.arrayBuffer();
    const factory = loader.default as (opts?: Record<string, unknown>) => unknown;
    const setFactory = () => {
      (self as unknown as { ModuleFactory?: unknown }).ModuleFactory = (opts?: Record<string, unknown>) =>
        factory({ ...opts, wasmBinary });
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

async function handleDownloads(req: Extract<WorkerRequest, { type: 'downloads' }>): Promise<void> {
  await ensureScanned();
  if (req.cmd === 'scan') return;
  const model = req.modelId ? modelById(req.modelId) : undefined;
  if (!model || model.runtime !== 'browser')
    throw new Error(`Unbekanntes Browser-Modell ${req.modelId ?? ''}.`);
  for (const f of model.files ?? []) {
    switch (req.cmd) {
      case 'start':
        // NC-Modelle im Modus „Kommerziell“ auch nicht herunterladen
        assertAllowed(model, req.licenseMode);
        // nicht abwarten: Fortschritt kommt über download-state
        downloads.start(f.name, mirror).catch(() => undefined);
        break;
      case 'pause':
        downloads.pause(f.name);
        break;
      case 'stop':
        await downloads.stop(f.name);
        break;
      case 'delete':
        sessions.delete(model.id);
        samSessions.delete(model.id);
        await downloads.remove(f.name);
        break;
    }
  }
}

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const req = e.data;
  mirror = req.mirror ?? null;
  if (req.type === 'downloads') {
    try {
      await handleDownloads(req);
      post({ type: 'done', id: req.id });
    } catch (err) {
      post({ type: 'error', id: req.id, message: err instanceof Error ? err.message : String(err) });
    }
    return;
  }
  const onProgress = (progress: Progress) => {
    post({ type: 'progress', id: req.id, progress });
  };
  const t0 = performance.now();
  if (req.type === 'sam') {
    try {
      const model = modelById(req.modelId);
      if (!model || model.runtime !== 'browser')
        throw new Error(`Unbekanntes Browser-Modell ${req.modelId}.`);
      assertAllowed(model, req.licenseMode);
      const pair = await samPair(model, onProgress);
      let emb = samEmbeddings.get(req.key);
      if (!emb) {
        if (!req.image) {
          post({ type: 'sam-need-image', id: req.id });
          return;
        }
        onProgress({ stage: 'infer', label: model.name, loaded: 0, total: 1 });
        emb = await samEncode(model, pair, req.image);
        samEmbeddings.set(req.key, emb);
        while (samEmbeddings.size > SAM_EMBEDDINGS_MAX) {
          const oldest = samEmbeddings.keys().next().value;
          if (oldest === undefined) break;
          for (const t of samEmbeddings.get(oldest) ?? []) t.dispose();
          samEmbeddings.delete(oldest);
        }
      }
      const r = await samDecode(model, pair, emb, req.points);
      onProgress({ stage: 'infer', label: model.name, loaded: 1, total: 1 });
      post({ type: 'sam-result', id: req.id, ...r, ms: performance.now() - t0 }, [r.mask.buffer]);
    } catch (err) {
      post({ type: 'error', id: req.id, message: err instanceof Error ? err.message : String(err) });
    } finally {
      req.image?.close();
    }
    return;
  }
  try {
    if (req.type === 'segment' || req.type === 'depth') {
      const model = modelById(req.modelId);
      if (!model || model.runtime !== 'browser')
        throw new Error(`Unbekanntes Browser-Modell ${req.modelId}.`);
      assertAllowed(model, req.licenseMode);
      const r =
        req.type === 'depth'
          ? await estimateDepth(model, req.image, onProgress)
          : await segment(model, req.image, onProgress);
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
