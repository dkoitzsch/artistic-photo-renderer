// Stil-Übertragung mit einem Bildbearbeitungsmodell (FLUX.2 klein u. a., Rolle `image-edit` im ML-Dienst).
// Ablauf: Eingangsbild der Ebene (mit den Effekten vor dem Stil-Effekt) + Stilbild + Prompt → Dienst → Ergebnis als
// Original im Projekt → Effekt zeigt es („Ergebnis im Effekt“) oder es wird eine neue Ebene („Verlauf als Ebenen“).

import { loadOriginal } from '../io/storage';
import { registerOriginalFromBlob } from '../io/import';
import { getEngine } from '../render/runtime';
import { applyStyleRunCommand } from '../state/commands';
import type { EffectInstance } from '../state/project';
import { getProject, useAppStore } from '../state/store';
import { roleAvailability } from './mlModels';
import { serviceMlEdit } from './serviceBackend';
import { startTask } from './split';
import { isPresetId, templateText, type PromptPresetId } from './stylePrompts';
import { hostOf, runKey, sourceSignature, type HistoryMode, type RunSettings } from './styleFluxModel';

export const STYLE_EFFECT_ID = 'style-flux';

/** Prompt des Effekts; ist keiner gespeichert, gilt die Vorlage des gewählten Presets (Einstellungen). */
export function effectivePrompt(fx: EffectInstance): string {
  if (typeof fx.params.prompt === 'string' && fx.params.prompt.trim()) return fx.params.prompt;
  const preset: PromptPresetId = isPresetId(fx.params.promptPreset) ? fx.params.promptPreset : 'faithful';
  return templateText(preset);
}

/** Einstellungen aus den Parametern der Effektinstanz. */
export function settingsOf(
  project: NonNullable<ReturnType<typeof getProject>>,
  nodeId: string,
  fx: EffectInstance,
): RunSettings {
  const p = fx.params;
  return {
    styleId: typeof p.styleId === 'string' ? p.styleId : '',
    prompt: effectivePrompt(fx),
    seed: typeof p.seed === 'number' ? p.seed : 1,
    steps: typeof p.steps === 'number' ? p.steps : 0,
    guidance: typeof p.guidance === 'number' ? p.guidance : 0,
    workSize: Number(p.workSize ?? 1024),
    source: sourceSignature(project, nodeId, fx.instanceId),
  };
}

/** Hat sich etwas seit dem letzten Lauf geändert (oder gab es noch keinen)? */
export function isDirty(
  project: NonNullable<ReturnType<typeof getProject>>,
  nodeId: string,
  fx: EffectInstance,
): boolean {
  const applied = typeof fx.params.appliedKey === 'string' ? fx.params.appliedKey : '';
  return applied !== runKey(settingsOf(project, nodeId, fx));
}

const running = new Set<string>();

export function isRunning(instanceId: string): boolean {
  return running.has(instanceId);
}

function pngOf(img: ImageData): Promise<Blob> {
  const c = new OffscreenCanvas(img.width, img.height);
  const g = c.getContext('2d');
  if (!g) throw new Error('2D-Kontext nicht verfügbar.');
  g.putImageData(img, 0, 0);
  return c.convertToBlob({ type: 'image/png' });
}

/**
 * Führt die Stil-Übertragung aus. newSeed: neuen Zufallswert würfeln (Knopf „Aktualisieren“ ohne Änderungen: eine andere
 * Variante). Liefert true bei Erfolg; Fehler werden gemeldet und verändern nichts.
 */
export async function runStyleTransfer(
  nodeId: string,
  instanceId: string,
  newSeed: boolean,
): Promise<boolean> {
  const { notify, licenseMode } = useAppStore.getState();
  const project = getProject();
  const engine = getEngine();
  const host = project ? hostOf(project, nodeId) : undefined;
  const fx = host?.effects.find((e) => e.instanceId === instanceId);
  if (!project || !engine || !host || !fx) return false;
  if (host.kind !== 'layer') {
    notify('info', 'Stil-Übertragung: bitte den Effekt auf eine Ebene legen (nicht auf eine Gruppe).');
    return false;
  }
  if (running.has(instanceId)) return false;
  const avail = roleAvailability('image-edit', licenseMode);
  if (!avail.ok) {
    notify('error', `Stil-Übertragung: ${avail.reason}`);
    return false;
  }
  const s = settingsOf(project, nodeId, fx);
  const style = project.originals[s.styleId];
  const styleFile = style ? await loadOriginal(s.styleId) : null;
  if (!style || !styleFile) {
    notify('info', 'Stil-Übertragung: Bitte zuerst ein Stilbild wählen.');
    return false;
  }
  if (!s.prompt.trim()) {
    notify('info', 'Stil-Übertragung: Der Prompt ist leer.');
    return false;
  }
  const seed = newSeed ? Math.floor(Math.random() * 2_000_000_000) : s.seed;
  const mode: HistoryMode = fx.params.history === 'overwrite' ? 'overwrite' : 'layers';
  const task = startTask('Stil-Übertragung (FLUX)');
  running.add(instanceId);
  try {
    const input = await engine.renderEffectInput(project, nodeId, instanceId, s.workSize);
    if (!input) throw new Error('Das Eingangsbild konnte nicht gerendert werden.');
    const result = await serviceMlEdit(
      {
        image: await pngOf(input),
        refs: [new Blob([styleFile], { type: style.mimeType })],
        prompt: s.prompt.trim(),
        seed,
        steps: s.steps,
        guidance: s.guidance > 0 ? s.guidance : -1,
        maxEdge: s.workSize,
        modelId: avail.model.id,
        licenseMode,
      },
      task.progress,
    );
    const stamp = new Date().toLocaleTimeString('de-DE', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    const original = await registerOriginalFromBlob(result.blob, `Stil-Transfer ${host.name} ${stamp}.png`);
    // Projekt kann sich währenddessen geändert haben: Schlüssel aus dem aktuellen Stand bilden
    const now = getProject();
    const nowFx = now ? hostOf(now, nodeId)?.effects.find((e) => e.instanceId === instanceId) : undefined;
    const key = now && nowFx ? runKey({ ...settingsOf(now, nodeId, nowFx), seed: result.seed }) : '';
    const previous =
      typeof nowFx?.params.historyIds === 'string'
        ? nowFx.params.historyIds.split(',').filter(Boolean).length
        : 0;
    applyStyleRunCommand({
      hostId: nodeId,
      instanceId,
      params: { seed: result.seed, appliedKey: key },
      original,
      mode,
      layerName: `Stil-Transfer ${previous + 1} · ${host.name}`,
    });
    notify('info', `Stil-Übertragung fertig (${avail.model.name}, Seed ${result.seed}).`);
    return true;
  } catch (e) {
    notify('error', `Stil-Übertragung fehlgeschlagen: ${e instanceof Error ? e.message : String(e)}`);
    return false;
  } finally {
    running.delete(instanceId);
    task.done();
  }
}
