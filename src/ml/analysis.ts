// Analysekarten aus Modellen (Spec „Effekte“ 4): Tiefe, Salienz, Gesichter je Original. Normalen entstehen auf der GPU
// aus der Tiefe. Karten werden automatisch berechnet, sobald ein sichtbarer Effekt (requires) oder eine Effekt-/Gruppen-
// maske sie braucht, und in allen Verlaufseinträgen abgelegt (abgeleitete Daten, kein Undo-Schritt; DECISIONS.md E3).

import { getPlugin } from '../effects/pluginStore';
import { encodeMaskPng, type MaskData } from '../io/maskCodec';
import { loadOriginal, saveDepth } from '../io/storage';
import { getEngine } from '../render/runtime';
import {
  newId,
  type AnalysisMapKind,
  type AnalysisMaps,
  type DepthMapRef,
  type LicenseMode,
  type Project,
} from '../state/project';
import { useAppStore } from '../state/store';
import { browserSegment } from './browserBackend';
import { detectLandmarks } from './backend';
import { convexHull, missingMapsWith, requiredMapsWith } from './analysisNeeds';
import { computeDepth } from './depth';
import { focusPointsFromLandmarks } from './focus';
import type { Landmark, Progress } from './protocol';
import { assertAllowed, modelById } from './registry';
import { INFERENCE_MAX_EDGE, startTask } from './split';

export const SALIENCY_MODEL_ID = 'u2netp';
export const FACES_MODEL_ID = 'mediapipe-face-landmarker';
/** Tiefe für Analysekarten: kommerziell nutzbar (Large nur über den Dialog „Tiefenebenen“) */
export const ANALYSIS_DEPTH_FAMILY = 'depth-anything-small';

export const MAP_LABELS: Record<AnalysisMapKind, string> = {
  depth: 'Tiefenkarte',
  saliency: 'Salienzkarte',
  faces: 'Gesichterkarte',
};

/** Benötigte Karten mit den Anforderungen der geladenen Plugins */
export function requiredMaps(
  project: Project,
  extra?: { layerId: string; map: AnalysisMapKind } | null,
): Map<string, Set<AnalysisMapKind>> {
  return requiredMapsWith(project, requiresOf, extra);
}

/** Fehlende (oder im Lizenzmodus nicht erlaubte) Karten. */
export function missingMaps(
  project: Project,
  mode: LicenseMode,
  extra?: { layerId: string; map: AnalysisMapKind } | null,
): { originalId: string; kind: AnalysisMapKind }[] {
  return missingMapsWith(project, mode, requiresOf, extra);
}

const requiresOf = (effectId: string): readonly string[] => getPlugin(effectId)?.manifest?.requires ?? [];

/** Legt eine Karte in allen Verlaufseinträgen ab, die das Original enthalten (kein neuer Undo-Schritt). */
export function setAnalysisMap<K extends AnalysisMapKind>(
  originalId: string,
  kind: K,
  ref: NonNullable<AnalysisMaps[K]>,
): void {
  const { history, setHistory } = useAppStore.getState();
  if (!history) return;
  const entries = history.entries.map((e) => {
    if (!e.state.originals[originalId]) return e;
    const analysis = { ...e.state.analysis };
    analysis[originalId] = { ...analysis[originalId], [kind]: ref };
    return { ...e, state: { ...e.state, analysis } };
  });
  setHistory({ ...history, entries });
}

async function previewBitmap(project: Project, originalId: string): Promise<ImageBitmap> {
  const o = project.originals[originalId];
  const f = await loadOriginal(originalId);
  if (!o || !f) throw new Error('Original fehlt im lokalen Speicher.');
  const s = Math.min(1, INFERENCE_MAX_EDGE / Math.max(o.width, o.height));
  return createImageBitmap(new Blob([f], { type: o.mimeType }), {
    resizeWidth: Math.max(1, Math.round(o.width * s)),
    resizeHeight: Math.max(1, Math.round(o.height * s)),
    resizeQuality: 'high',
    premultiplyAlpha: 'none',
    colorSpaceConversion: 'default',
  });
}

export async function storeMap(
  data: Float32Array,
  width: number,
  height: number,
  modelId: string,
  commercialUse: boolean,
): Promise<DepthMapRef> {
  const engine = getEngine();
  if (!engine) throw new Error('WebGPU nicht bereit.');
  const mask: MaskData = {
    width,
    height,
    data: Uint16Array.from(data, (v) => Math.round(Math.min(1, Math.max(0, v)) * 65535)),
  };
  const id = newId();
  await saveDepth(id, encodeMaskPng(mask));
  engine.sources.addMask(id, width, height, mask.data);
  return { id, width, height, provenance: { modelId, commercialUse, createdAt: new Date().toISOString() } };
}

/**
 * Gesichtsflächen als weiche Maske (width × height): Hülle der Landmarken, um 10 % um ihre Mitte vergrößert (Stirn,
 * Kinn), Rand weich mit 6 % der Gesichtsbreite.
 */
export function rasterFaces(
  faces: Landmark[][],
  width: number,
  height: number,
  /** Rückfall ohne Face-Mesh: Gesichtsmitten aus der Pose (px, Radius ≈ ¾ Gesichtsbreite) */
  ellipses: { x: number; y: number; radius: number }[] = [],
): Float32Array {
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('2D-Kontext nicht verfügbar.');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, width, height);
  for (const face of faces) {
    const pts = face.map((l): [number, number] => [l.x * width, l.y * height]);
    if (pts.length < 3) continue;
    const hull = convexHull(pts);
    const cx = hull.reduce((s, q) => s + q[0], 0) / hull.length;
    const cy = hull.reduce((s, q) => s + q[1], 0) / hull.length;
    const xs = hull.map((q) => q[0]);
    const fw = Math.max(...xs) - Math.min(...xs);
    ctx.filter = `blur(${Math.max(1, fw * 0.06).toFixed(1)}px)`;
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    hull.forEach(([x, y], i) => {
      const gx = cx + (x - cx) * 1.1;
      const gy = cy + (y - cy) * 1.1;
      if (i === 0) ctx.moveTo(gx, gy);
      else ctx.lineTo(gx, gy);
    });
    ctx.closePath();
    ctx.fill();
  }
  for (const e of ellipses) {
    const rx = e.radius * 0.75;
    ctx.filter = `blur(${Math.max(1, rx * 0.12).toFixed(1)}px)`;
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.ellipse(e.x, e.y, rx, rx * 1.3, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  const px = ctx.getImageData(0, 0, width, height).data;
  const out = new Float32Array(width * height);
  for (let i = 0; i < out.length; i++) out[i] = (px[i * 4] ?? 0) / 255;
  return out;
}

/** Berechnet eine Karte eines Originals (Modell nach Lizenzmodus) und legt sie ab. */
export async function computeMap(
  project: Project,
  originalId: string,
  kind: AnalysisMapKind,
  mode: LicenseMode,
  onProgress: (p: Progress) => void,
): Promise<void> {
  if (kind === 'depth') {
    const r = await computeDepth(project, originalId, ANALYSIS_DEPTH_FAMILY, mode, onProgress);
    setAnalysisMap(originalId, 'depth', r.ref);
    return;
  }
  const bitmap = await previewBitmap(project, originalId);
  const { width, height } = bitmap;
  if (kind === 'saliency') {
    const model = modelById(SALIENCY_MODEL_ID);
    if (!model) throw new Error('Salienzmodell fehlt im Register.');
    assertAllowed(model, mode);
    const r = await browserSegment(model, bitmap, mode, onProgress);
    setAnalysisMap(
      originalId,
      'saliency',
      await storeMap(r.mask, r.width, r.height, model.id, model.commercialUse),
    );
    return;
  }
  const lm = await detectLandmarks(bitmap, mode, onProgress);
  const model = modelById(FACES_MODEL_ID);
  // Findet das Face-Mesh kein Gesicht (z. B. Hand davor), Gesichtsmitten aus der Pose wie bei den Fokuspunkten
  let n = 0;
  const fromPose =
    lm.faces.length === 0
      ? focusPointsFromLandmarks(lm, width, height, () => `f${n++}`).filter((p) => p.kind === 'face')
      : [];
  const ref = await storeMap(
    rasterFaces(lm.faces, width, height, fromPose),
    width,
    height,
    FACES_MODEL_ID,
    model?.commercialUse ?? true,
  );
  setAnalysisMap(originalId, 'faces', { ...ref, faceCount: lm.faces.length || fromPose.length });
}

// ---------- automatische Berechnung ----------

const failed = new Set<string>();
let running = false;
let timer: ReturnType<typeof setTimeout> | null = null;

/** Zusätzlich angeforderte Karte (Ansicht „Analysekarte“) */
let viewRequest: { layerId: string; map: AnalysisMapKind } | null = null;

export function requestViewMap(req: { layerId: string; map: AnalysisMapKind } | null): void {
  viewRequest = req;
  schedule();
}

/** Arbeitet fehlende Karten nacheinander ab (je Original und Art höchstens ein Versuch pro Sitzung bei Fehlern). */
async function work(): Promise<void> {
  if (running) return;
  running = true;
  try {
    for (;;) {
      const s = useAppStore.getState();
      const project = s.history ? s.history.entries[s.history.index]?.state : undefined;
      if (!project || s.gpu.state !== 'ready') return;
      const next = missingMaps(project, s.licenseMode, viewRequest).find(
        (m) => !failed.has(`${m.originalId}|${m.kind}|${s.licenseMode}`),
      );
      if (!next) return;
      const task = startTask(`${MAP_LABELS[next.kind]} berechnen`);
      try {
        await computeMap(project, next.originalId, next.kind, s.licenseMode, task.progress);
        s.bumpRenderTick();
      } catch (e) {
        failed.add(`${next.originalId}|${next.kind}|${s.licenseMode}`);
        s.notify('error', `${MAP_LABELS[next.kind]}: ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        task.done();
      }
    }
  } finally {
    running = false;
  }
}

function schedule(): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void work();
  }, 250);
}

/** Beobachtet den Store und berechnet fehlende Karten im Hintergrund. Rückgabe: Abmelden. */
export function startAnalysisWatcher(): () => void {
  let last: unknown = null;
  let lastMode: LicenseMode | null = null;
  return useAppStore.subscribe((s) => {
    const p = s.history ? s.history.entries[s.history.index]?.state : null;
    if (p === last && s.licenseMode === lastMode) return;
    last = p;
    lastMode = s.licenseMode;
    if (p) schedule();
  });
}
