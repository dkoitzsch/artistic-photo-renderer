// Dienst-Backend: lokaler Python-Dienst (127.0.0.1:8765). Lange Aufgaben laufen als Job mit Fortschritt.

import { decodeMaskPng, type MaskData } from '../io/maskCodec';
import type { LicenseMode } from '../state/project';
import type { ServiceInfo } from '../state/store';
import type { Progress } from './protocol';
import type { ModelEntry } from './registry';

export const SERVICE_URL = 'http://127.0.0.1:8765';

async function fetchJson<T>(url: string, init?: RequestInit, timeoutMs = 2000): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => {
    ctrl.abort();
  }, timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Dienst antwortet mit HTTP ${res.status}${text ? `: ${text.slice(0, 200)}` : ''}`);
    }
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

export async function serviceHealth(licenseMode: LicenseMode): Promise<ServiceInfo> {
  return fetchJson<ServiceInfo>(`${SERVICE_URL}/health?license_mode=${licenseMode}`, undefined, 1500);
}

type Job = {
  id: string;
  status: 'queued' | 'running' | 'done' | 'error';
  progress: number;
  message?: string;
};

export async function serviceSegment(
  model: ModelEntry,
  original: Blob,
  licenseMode: LicenseMode,
  onProgress: (p: Progress) => void,
): Promise<MaskData> {
  const form = new FormData();
  form.append('image', original, 'image');
  form.append('model', model.id);
  form.append('license_mode', licenseMode);
  const job = await fetchJson<Job>(
    `${SERVICE_URL}/segment/foreground`,
    { method: 'POST', body: form },
    30_000,
  );
  for (;;) {
    const s = await fetchJson<Job>(`${SERVICE_URL}/jobs/${job.id}`);
    if (s.status === 'error') throw new Error(s.message ?? 'Dienst-Job fehlgeschlagen.');
    onProgress({
      stage: s.status === 'queued' ? 'load' : 'infer',
      label: `${model.name} (Dienst)`,
      loaded: s.progress,
      total: 1,
    });
    if (s.status === 'done') break;
    await new Promise((r) => setTimeout(r, 250));
  }
  const res = await fetch(`${SERVICE_URL}/jobs/${job.id}/result`);
  if (!res.ok) throw new Error(`Ergebnis des Dienstes nicht abrufbar (HTTP ${res.status}).`);
  return decodeMaskPng(new Uint8Array(await res.arrayBuffer()));
}
