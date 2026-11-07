// Stil-Übertragung (FLUX): reine Logik – Lauf-Schlüssel („geändert seit dem letzten Lauf?“) und das Anwenden eines
// Ergebnisses auf das Projekt (Effektparameter, Original, Verlauf als Ebenen). Getestet in tests/unit/styleFlux.test.ts.

import type { ParamValue } from '../effects/manifest';
import {
  findHost,
  insertAbove,
  newImageLayer,
  setEffectParams,
  updateLayer,
  type EffectInstance,
  type OriginalRef,
  type Project,
} from '../state/project';
import { fillTransform, IDENTITY_TRANSFORM } from '../state/transform';

export type HistoryMode = 'layers' | 'overwrite';

/** Kurzer, stabiler Hash (FNV-1a, 64 Bit als 16 Hexzeichen) – nur zum Vergleichen, nicht kryptografisch. */
export function shortHash(text: string): string {
  let a = 0xcbf29ce484222325n;
  for (let i = 0; i < text.length; i++) {
    a ^= BigInt(text.charCodeAt(i));
    a = (a * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return a.toString(16).padStart(16, '0');
}

export type RunSettings = {
  styleId: string;
  prompt: string;
  seed: number;
  steps: number;
  guidance: number;
  workSize: number;
  /** Quelle des Laufs: Original der Ebene und die Effekte davor */
  source: string;
};

/** Schlüssel der Einstellungen eines Laufs; ändert sich etwas davon, ist das Ergebnis „veraltet“ (Knopf zeigt Punkt). */
export function runKey(s: RunSettings): string {
  return shortHash(
    JSON.stringify([s.styleId, s.prompt.trim(), s.seed, s.steps, s.guidance, s.workSize, s.source]),
  );
}

/** Effekt-Träger (Ebene oder Gruppe) zu einer ID. */
export function hostOf(project: Project, nodeId: string) {
  const found = findHost(project.root, nodeId);
  return found?.layer ?? (found && 'kind' in found.host ? found.host : undefined);
}

/** Beschreibt die Quelle: Original der Ebene plus Effekte vor dem Stil-Effekt. */
export function sourceSignature(project: Project, nodeId: string, instanceId: string): string {
  const found = findHost(project.root, nodeId);
  const host = found?.layer ?? (found && 'kind' in found.host ? found.host : undefined);
  const effects: EffectInstance[] = host?.effects ?? [];
  const before: EffectInstance[] = [];
  for (const e of effects) {
    if (e.instanceId === instanceId) break;
    before.push(e);
  }
  const original = host && host.kind === 'layer' ? host.originalId : '';
  return JSON.stringify([original, before.map((e) => [e.effectId, e.enabled, e.strength, e.params])]);
}

export function parseIds(v: unknown): string[] {
  return typeof v === 'string' && v ? v.split(',').filter(Boolean) : [];
}

export type ApplyArgs = {
  hostId: string;
  instanceId: string;
  /** Einstellungen des Laufs (werden in den Effekt geschrieben: Prompt, Seed, appliedKey …) */
  params: Record<string, ParamValue>;
  original: OriginalRef;
  mode: HistoryMode;
  layerName: string;
};

/**
 * Wendet ein Ergebnis an. „Ergebnis im Effekt“ (overwrite): der Effekt zeigt das neue Bild und ersetzt das vorige.
 * „Verlauf als Ebenen“ (layers): jedes Ergebnis wird eine neue Bildebene über der Quelle; frühere Ergebnisse bleiben als
 * ausgeblendete Ebenen erhalten, der Effekt selbst zeigt dann nichts an (ein Ergebnis nur an einer Stelle).
 */
export function applyStyleRun(
  project: Project,
  a: ApplyArgs,
): { project: Project; newLayerId: string | null } {
  let p: Project = { ...project, originals: { ...project.originals, [a.original.id]: a.original } };
  const found = findHost(p.root, a.hostId);
  const fx = (found?.layer ?? (found && 'kind' in found.host ? found.host : undefined))?.effects.find(
    (e) => e.instanceId === a.instanceId,
  );
  if (!fx) return { project, newLayerId: null };
  const values: Record<string, ParamValue> = { ...a.params };
  let newLayerId: string | null = null;
  if (a.mode === 'overwrite') {
    values.result = a.original.id;
  } else {
    values.result = '';
    const layer = newImageLayer(a.original, fillTransform(IDENTITY_TRANSFORM, a.original, p.canvas));
    layer.name = a.layerName;
    newLayerId = layer.id;
    const previous = parseIds(fx.params.historyIds);
    for (const id of previous) p = updateLayer(p, id, (l) => ({ ...l, visible: false }));
    p = insertAbove(p, layer, a.hostId);
    values.historyIds = [...previous, layer.id].join(',');
  }
  p = setEffectParams(p, a.hostId, a.instanceId, values);
  return { project: p, newLayerId };
}
