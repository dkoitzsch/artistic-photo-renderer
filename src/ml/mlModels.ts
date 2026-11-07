// ML-Modellverwaltung (Spec „ML-Fotobearbeitung“, Abschnitt 3): frei wählbare Modelle für Rollen wie `image-edit`
// (z. B. FLUX.2 klein). Die Konfiguration liegt im Dienst (~/.config/artistic-photo-renderer/models.yaml); Modelle werden
// dort verwendet, wo sie liegen (nur gelesen). Hier: Zugriff auf die Dienst-API und ein kleiner Zustandsspeicher.

import { create } from 'zustand';
import type { LicenseMode } from '../state/project';
import { SERVICE_URL } from './serviceBackend';

export type MlModelStatus = {
  available: boolean;
  note: string | null;
  pipeline?: string;
  sizeBytes?: number;
  fingerprint?: string;
};

export type MlModelEntry = {
  id: string;
  name: string;
  roles: string[];
  backend: string;
  paths: { root: string };
  precision: 'bf16' | 'fp16' | 'fp32';
  device: string;
  memory: { offload: 'auto' | 'none' | 'model' | 'sequential' };
  defaults: { steps: number; guidance: number };
  license: { name: string; url: string; notes: string };
  outputCommercialUse: boolean;
  defaultForRoles: string[];
  status: MlModelStatus;
  loaded: boolean;
  roleDefaults: string[];
};

export type MlModelsInfo = {
  configPath: string;
  hardware: { device: string; ramGB: number; mps: boolean; cuda: boolean };
  roles: string[];
  models: MlModelEntry[];
};

type MlState = {
  state: 'unknown' | 'online' | 'offline';
  info: MlModelsInfo | null;
  error: string | null;
  set: (p: Partial<Omit<MlState, 'set'>>) => void;
};

export const useMlModels = create<MlState>((set) => ({
  state: 'unknown',
  info: null,
  error: null,
  set: (p) => {
    set(p);
  },
}));

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${SERVICE_URL}${path}`, init);
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { detail?: string };
    throw new Error(body.detail ?? `Dienst antwortet mit HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

/** Fragt die konfigurierten Modelle und ihren Zustand ab (Dienst nötig). */
export async function refreshMlModels(): Promise<MlModelsInfo | null> {
  const { set } = useMlModels.getState();
  try {
    const info = await api<MlModelsInfo>('/ml/models');
    set({ state: 'online', info, error: null });
    return info;
  } catch (e) {
    set({ state: 'offline', info: null, error: e instanceof Error ? e.message : String(e) });
    return null;
  }
}

export type MlModelInput = {
  name: string;
  roles: string[];
  root: string;
  precision: string;
  offload: string;
  steps: number;
  guidance: number;
  licenseName: string;
  licenseNotes: string;
  outputCommercialUse: boolean;
  defaultForRoles: string[];
};

export async function saveMlModel(id: string, m: MlModelInput): Promise<MlModelEntry> {
  const entry = await api<MlModelEntry>(`/ml/models/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: m.name,
      roles: m.roles,
      backend: 'diffusers',
      paths: { root: m.root },
      precision: m.precision,
      device: 'auto',
      memory: { offload: m.offload },
      defaults: { steps: m.steps, guidance: m.guidance },
      license: { name: m.licenseName, notes: m.licenseNotes },
      outputCommercialUse: m.outputCommercialUse,
      defaultForRoles: m.defaultForRoles,
    }),
  });
  await refreshMlModels();
  return entry;
}

/** Entfernt nur den Eintrag; die Modelldateien bleiben unberührt. */
export async function deleteMlModel(id: string): Promise<void> {
  await api<unknown>(`/ml/models/${encodeURIComponent(id)}`, { method: 'DELETE' });
  await refreshMlModels();
}

export async function unloadMlModels(): Promise<void> {
  await api<unknown>('/ml/unload', { method: 'POST' });
  await refreshMlModels();
}

/** Standardmodell einer Rolle (mit Status) – das erste mit dieser Rolle, falls keins ausdrücklich Standard ist. */
export function modelForRole(role: string, info = useMlModels.getState().info): MlModelEntry | undefined {
  const list = info?.models.filter((m) => m.roles.includes(role)) ?? [];
  return list.find((m) => m.roleDefaults.includes(role)) ?? list[0];
}

/** Kann ein Modell der Rolle jetzt benutzt werden? Sonst die Begründung (für Hinweise in der Oberfläche). */
export function roleAvailability(
  role: string,
  licenseMode: LicenseMode,
): { ok: true; model: MlModelEntry } | { ok: false; reason: string } {
  const { state, info } = useMlModels.getState();
  if (state === 'offline') return { ok: false, reason: 'Der ML-Dienst ist nicht erreichbar (npm run dev).' };
  const m = modelForRole(role, info);
  if (!m) return { ok: false, reason: 'Kein Modell eingerichtet (Einstellungen › ML-Modelle).' };
  if (!m.status.available) return { ok: false, reason: `${m.name}: ${m.status.note ?? 'nicht verfügbar'}` };
  if (!m.outputCommercialUse && licenseMode !== 'all')
    return {
      ok: false,
      reason: `${m.name} ist im Lizenzmodus „Kommerziell“ gesperrt (Einstufung der erzeugten Bilder: nicht kommerziell).`,
    };
  return { ok: true, model: m };
}
