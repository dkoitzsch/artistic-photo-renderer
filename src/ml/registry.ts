// Zugriff auf models/registry.json – die einzige Quelle für Modelle (Lizenz, Laufort, Dateien).

import registry from '../../models/registry.json';
import type { LicenseMode } from '../state/project';

export type ModelTask =
  | 'foreground'
  | 'landmarks'
  | 'depth'
  | 'points'
  | 'objects'
  | 'inpaint'
  | 'saliency'
  | 'style';
export type Runtime = 'browser' | 'service';

export type ModelFile = { name: string; url: string; sha256: string; size: number };

export type ModelEntry = {
  id: string;
  family: string;
  name: string;
  task: ModelTask;
  runtime: Runtime;
  license: string;
  commercialUse: boolean;
  source: string;
  revision: string;
  files?: ModelFile[];
  input?: { size: number; mean: number[]; std: number[] };
  output?: 'logits' | 'probability-minmax' | 'disparity';
  /** Index der Modellausgabe (Standard: letzte) */
  outputIndex?: number;
  gated?: boolean;
  checkedAt: string;
};

export const MODELS: readonly ModelEntry[] = registry.models as ModelEntry[];

export function modelById(id: string): ModelEntry | undefined {
  return MODELS.find((m) => m.id === id);
}

/** Darf das Modell im Lizenzmodus geladen werden? NC-Modelle nur im Modus „Alle“. */
export function isAllowed(model: ModelEntry, mode: LicenseMode): boolean {
  return model.commercialUse || mode === 'all';
}

/** Wirft, wenn ein NC-Modell im Modus „Kommerziell“ geladen werden soll (letzte Schutzlinie). */
export function assertAllowed(model: ModelEntry, mode: LicenseMode): void {
  if (!isAllowed(model, mode))
    throw new Error(
      `${model.name} ist nur nicht-kommerziell nutzbar und im Lizenzmodus „Kommerziell“ gesperrt.`,
    );
}

/** Modellfamilien einer Aufgabe (z. B. BiRefNet, RMBG) für die Auswahl im Dialog. */
export function familiesFor(
  task: ModelTask,
): { family: string; name: string; commercialUse: boolean; license: string }[] {
  const out = new Map<string, { family: string; name: string; commercialUse: boolean; license: string }>();
  for (const m of MODELS) {
    if (m.task !== task || out.has(m.family)) continue;
    out.set(m.family, {
      family: m.family,
      name: m.name.replace(/ (lite|\(voll\)|1\.4|2\.0)$/, ''),
      commercialUse: m.commercialUse,
      license: m.license,
    });
  }
  return [...out.values()];
}

/** Konkretes Modell einer Familie für einen Laufort. */
export function modelFor(family: string, runtime: Runtime, task: ModelTask): ModelEntry | undefined {
  return MODELS.find((m) => m.family === family && m.runtime === runtime && m.task === task);
}
