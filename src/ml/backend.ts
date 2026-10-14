// MlBackend: wählt zwischen Browser-Modellen und lokalem Python-Dienst (Einstellung Auto / Browser / Dienst)
// und fällt im Modus „Auto“ ohne Fehler auf den Browser zurück, wenn der Dienst nicht antwortet.

import type { MaskData } from '../io/maskCodec';
import type { LicenseMode } from '../state/project';
import { useAppStore } from '../state/store';
import { browserDepth, browserLandmarks, browserSegment } from './browserBackend';
import type { LandmarkResult, Progress } from './protocol';
import { assertAllowed, modelFor, type ModelEntry, type ModelTask, type Runtime } from './registry';
import { serviceHealth, serviceSegment } from './serviceBackend';

export interface MlBackend {
  readonly runtime: Runtime;
  /** Vordergrundmaske. browser: Eingabe ≤ 1024 px; service: Originaldatei, Ergebnis in voller Auflösung */
  segmentForeground(
    family: string,
    input: { preview: () => Promise<ImageBitmap>; original: Blob },
    licenseMode: LicenseMode,
    onProgress: (p: Progress) => void,
  ): Promise<{ mask: MaskData | { data: Float32Array; width: number; height: number }; model: ModelEntry }>;
  /** Tiefenkarte 0 = nah … 1 = fern (Formate wie bei segmentForeground) */
  estimateDepth(
    family: string,
    input: { preview: () => Promise<ImageBitmap>; original: Blob },
    licenseMode: LicenseMode,
    onProgress: (p: Progress) => void,
  ): Promise<{ mask: MaskData | { data: Float32Array; width: number; height: number }; model: ModelEntry }>;
}

export const BrowserBackend: MlBackend = {
  runtime: 'browser',
  async segmentForeground(family, input, licenseMode, onProgress) {
    const model = modelFor(family, 'browser', 'foreground');
    if (!model) throw new Error(`Kein Browser-Modell für ${family}.`);
    assertAllowed(model, licenseMode);
    const r = await browserSegment(model, await input.preview(), licenseMode, onProgress);
    return { mask: { data: r.mask, width: r.width, height: r.height }, model };
  },
  async estimateDepth(family, input, licenseMode, onProgress) {
    const model = modelFor(family, 'browser', 'depth');
    if (!model) throw new Error(`Kein Browser-Modell für ${family} – nur im ML-Dienst verfügbar.`);
    assertAllowed(model, licenseMode);
    const r = await browserDepth(model, await input.preview(), licenseMode, onProgress);
    return { mask: { data: r.mask, width: r.width, height: r.height }, model };
  },
};

export const ServiceBackend: MlBackend = {
  runtime: 'service',
  async segmentForeground(family, input, licenseMode, onProgress) {
    const model = modelFor(family, 'service', 'foreground');
    if (!model) throw new Error(`Kein Dienst-Modell für ${family}.`);
    assertAllowed(model, licenseMode);
    const mask = await serviceSegment(model, input.original, licenseMode, onProgress);
    return { mask, model };
  },
  async estimateDepth(family, input, licenseMode, onProgress) {
    const model = modelFor(family, 'service', 'depth');
    if (!model) throw new Error(`Kein Dienst-Modell für ${family}.`);
    assertAllowed(model, licenseMode);
    const mask = await serviceSegment(model, input.original, licenseMode, onProgress, '/depth');
    return { mask, model };
  },
};

/** Fokuspunkte laufen immer im Browser (MediaPipe, kommerziell nutzbar). */
export function detectLandmarks(
  image: ImageBitmap,
  licenseMode: LicenseMode,
  onProgress: (p: Progress) => void,
): Promise<LandmarkResult> {
  return browserLandmarks(image, licenseMode, onProgress);
}

// ---------- Dienst-Überwachung ----------

let monitor: ReturnType<typeof setInterval> | null = null;

export async function checkService(): Promise<boolean> {
  const { setService, licenseMode } = useAppStore.getState();
  try {
    const info = await serviceHealth(licenseMode);
    setService({ state: 'online', info });
    return true;
  } catch {
    setService({ state: 'offline' });
    return false;
  }
}

/**
 * Fragt /health ab, solange nicht „nur Browser“ eingestellt ist: alle 5 s, wenn verbunden,
 * sonst alle 20 s (jeder Fehlversuch erscheint in der Browser-Konsole).
 */
export function startServiceMonitor(): () => void {
  let lastCheck = 0;
  const tick = (force = false) => {
    const { mlMode, service, setService } = useAppStore.getState();
    if (mlMode === 'browser') {
      setService({ state: 'unknown' });
      return;
    }
    const { modelsOpen } = useAppStore.getState();
    const busy = service.info?.models.some((m) => m.download?.status === 'downloading') ?? false;
    const interval = service.state === 'online' ? (modelsOpen || busy ? 1000 : 5000) : 20000;
    if (!force && Date.now() - lastCheck < interval) return;
    lastCheck = Date.now();
    void checkService();
  };
  tick(true);
  monitor = setInterval(tick, 1000);
  const unsub = useAppStore.subscribe((s, prev) => {
    if (s.mlMode !== prev.mlMode || s.licenseMode !== prev.licenseMode || (s.modelsOpen && !prev.modelsOpen))
      tick(true);
  });
  return () => {
    if (monitor) clearInterval(monitor);
    unsub();
  };
}

/** Bietet der Dienst ein (erlaubtes, verfügbares) Modell dieser Familie an? */
function serviceOffers(family: string, licenseMode: LicenseMode, task: ModelTask): boolean {
  const { service } = useAppStore.getState();
  const model = modelFor(family, 'service', task);
  if (service.state !== 'online' || !model) return false;
  if (!model.commercialUse && licenseMode !== 'all') return false;
  return service.info?.models.some((m) => m.id === model.id && m.available) ?? false;
}

/**
 * Backends in Reihenfolge der Wahl. Auto: Dienst (falls online und Modell verfügbar), dann Browser.
 */
export function backendsFor(
  family: string,
  licenseMode: LicenseMode,
  task: ModelTask = 'foreground',
): MlBackend[] {
  const mode = useAppStore.getState().mlMode;
  const hasBrowser = modelFor(family, 'browser', task) !== undefined;
  if (mode === 'browser') return [BrowserBackend];
  if (mode === 'service') return [ServiceBackend];
  if (!hasBrowser) return [ServiceBackend];
  return serviceOffers(family, licenseMode, task) ? [ServiceBackend, BrowserBackend] : [BrowserBackend];
}
