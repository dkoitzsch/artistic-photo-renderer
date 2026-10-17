// Effekte im Python-Dienst (Spec „Effekte“ 3.2): Bild einmal hochladen (über SHA-256 adressiert), Render-Job starten,
// Fortschritt abfragen, Ergebnis (RGBA float16) holen; Abbruch über DELETE /jobs/{id}.

import type { ParamValue } from '../effects/manifest';
import type { LicenseMode } from '../state/project';
import { SERVICE_URL } from './serviceBackend';

export type ServiceRenderRequest = {
  effectId: string;
  data: Uint16Array;
  width: number;
  height: number;
  params: Record<string, ParamValue>;
  scale: number;
  origin: [number, number];
  canvasSize: [number, number];
  licenseMode: LicenseMode;
};

async function sha256Hex(data: Uint16Array): Promise<string> {
  const view = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  const digest = await crypto.subtle.digest('SHA-256', view as Uint8Array<ArrayBuffer>);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function check(res: Response): Promise<Response> {
  if (res.ok) return res;
  const body = (await res.json().catch(() => ({}))) as { detail?: string };
  throw new Error(body.detail ?? `Dienst antwortet mit HTTP ${res.status}`);
}

type Job = { id: string; status: string; progress: number; message?: string | null; cached?: boolean };

/** Führt einen Effekt im Dienst aus. signal: Abbruch (bricht auch den Dienst-Job ab). */
export async function renderOnService(
  req: ServiceRenderRequest,
  onProgress: (p: number) => void,
  signal: AbortSignal,
): Promise<Uint16Array> {
  const digest = await sha256Hex(req.data);
  const head = await fetch(`${SERVICE_URL}/images/${digest}`, { method: 'HEAD', signal }).catch(
    (e: unknown) => {
      if (signal.aborted) throw e;
      throw new Error('Der lokale ML-Dienst ist nicht erreichbar (npm run service).');
    },
  );
  if (head.status === 404) {
    await check(
      await fetch(`${SERVICE_URL}/images/${digest}?width=${req.width}&height=${req.height}`, {
        method: 'PUT',
        body: req.data as Uint16Array<ArrayBuffer>,
        headers: { 'Content-Type': 'application/octet-stream' },
        signal,
      }),
    );
  }
  const job = (await (
    await check(
      await fetch(`${SERVICE_URL}/effects/${req.effectId}/render`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image: digest,
          params: req.params,
          scale: req.scale,
          origin: req.origin,
          canvasSize: req.canvasSize,
          licenseMode: req.licenseMode,
        }),
        signal,
      }),
    )
  ).json()) as Job;
  const cancel = () => {
    void fetch(`${SERVICE_URL}/jobs/${job.id}`, { method: 'DELETE' }).catch(() => undefined);
  };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    for (;;) {
      if (signal.aborted) throw new DOMException('abgebrochen', 'AbortError');
      const s = (await (await check(await fetch(`${SERVICE_URL}/jobs/${job.id}`, { signal }))).json()) as Job;
      onProgress(s.progress);
      if (s.status === 'done') break;
      if (s.status === 'error') throw new Error(s.message ?? 'Effekt im Dienst fehlgeschlagen.');
      if (s.status === 'cancelled') throw new DOMException('abgebrochen', 'AbortError');
      await new Promise((r) => setTimeout(r, 150));
    }
    const res = await check(await fetch(`${SERVICE_URL}/jobs/${job.id}/result`, { signal }));
    const buf = await res.arrayBuffer();
    if (buf.byteLength !== req.width * req.height * 8)
      throw new Error('Ergebnis des Dienstes hat die falsche Größe.');
    return new Uint16Array(buf);
  } finally {
    signal.removeEventListener('abort', cancel);
  }
}
