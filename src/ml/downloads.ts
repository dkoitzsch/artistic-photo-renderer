/// <reference lib="webworker" />
// Download-Manager für Browser-Modelle (läuft im ML-Worker):
// - Teil-Downloads liegen als <name>.part im OPFS und werden per HTTP-Range fortgesetzt (Pausieren/Fortsetzen)
// - Stoppen verwirft den Teil-Download, Löschen entfernt das fertige Modell
// - Fertige Dateien werden per SHA-256 geprüft, erst dann umbenannt

import type { DownloadState } from './protocol';
import type { ModelFile } from './registry';

type Entry = DownloadState & { file: ModelFile };

const entries = new Map<string, Entry>();
const controllers = new Map<string, AbortController>();
const running = new Map<string, Promise<void>>();
let notify: (states: DownloadState[]) => void = () => undefined;
let lastNotify = 0;
let pendingNotify: ReturnType<typeof setTimeout> | null = null;

export function onDownloadStates(fn: (states: DownloadState[]) => void): void {
  notify = fn;
}

function snapshot(): DownloadState[] {
  return [...entries.values()].map(({ file: _file, ...s }) => s);
}

/** Zustand melden (höchstens alle 150 ms, Statuswechsel sofort) */
function publish(force = false): void {
  const now = performance.now();
  if (force || now - lastNotify > 150) {
    lastNotify = now;
    if (pendingNotify) clearTimeout(pendingNotify);
    pendingNotify = null;
    notify(snapshot());
  } else {
    pendingNotify ??= setTimeout(() => {
      pendingNotify = null;
      publish(true);
    }, 150);
  }
}

function set(name: string, patch: Partial<DownloadState>, force = true): Entry {
  const e = entries.get(name);
  if (!e) throw new Error(`Unbekannte Modelldatei ${name}`);
  Object.assign(e, patch);
  publish(force);
  return e;
}

async function modelDir(): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle('models', { create: true });
}

async function sizeOf(dir: FileSystemDirectoryHandle, name: string): Promise<number | null> {
  try {
    return (await (await dir.getFileHandle(name)).getFile()).size;
  } catch {
    return null;
  }
}

async function sha256(bytes: ArrayBuffer): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Registriert die Dateien und bestimmt ihren Zustand aus dem OPFS. */
export async function scan(models: { modelId: string; file: ModelFile }[]): Promise<void> {
  const dir = await modelDir();
  for (const { modelId, file } of models) {
    if (running.has(file.name)) continue;
    const full = await sizeOf(dir, file.name);
    const part = await sizeOf(dir, `${file.name}.part`);
    const status: DownloadState['status'] =
      full === file.size ? 'done' : part !== null ? 'paused' : 'missing';
    entries.set(file.name, {
      modelId,
      name: file.name,
      file,
      status,
      loaded: status === 'done' ? file.size : (part ?? 0),
      total: file.size,
    });
  }
  publish(true);
}

/** Startet bzw. setzt einen Download fort; liefert, wenn die Datei fertig und geprüft ist. */
export function start(name: string, mirror: string | null): Promise<void> {
  const existing = running.get(name);
  if (existing) return existing;
  const e = entries.get(name);
  if (!e) return Promise.reject(new Error(`Unbekannte Modelldatei ${name}`));
  if (e.status === 'done') return Promise.resolve();
  const ctrl = new AbortController();
  controllers.set(name, ctrl);
  const job = download(e, mirror, ctrl.signal).finally(() => {
    running.delete(name);
    controllers.delete(name);
  });
  running.set(name, job);
  return job;
}

async function download(e: Entry, mirror: string | null, signal: AbortSignal): Promise<void> {
  const { file } = e;
  const dir = await modelDir();
  const partHandle = await dir.getFileHandle(`${file.name}.part`, { create: true });
  const access = await partHandle.createSyncAccessHandle();
  let offset = access.getSize();
  set(file.name, { status: 'downloading', loaded: offset, error: undefined });
  try {
    if (offset < file.size) {
      const url = mirror ? `${mirror}${file.name}` : file.url;
      const res = await fetch(
        url,
        offset > 0 ? { signal, headers: { Range: `bytes=${offset}-` } } : { signal },
      );
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      if (offset > 0 && res.status !== 206) {
        // Server kann nicht fortsetzen → von vorn
        access.truncate(0);
        offset = 0;
      }
      const reader = res.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (offset + value.length > file.size) throw new Error('unerwartete Dateigröße');
        access.write(value, { at: offset });
        offset += value.length;
        set(file.name, { loaded: offset }, false);
      }
      access.flush();
    }
    if (offset !== file.size) throw new Error(`unvollständig (${offset} von ${file.size} Byte)`);
    access.close();
    set(file.name, { status: 'verifying', loaded: offset });
    const bytes = await (await partHandle.getFile()).arrayBuffer();
    if ((await sha256(bytes)) !== file.sha256) {
      await dir.removeEntry(`${file.name}.part`);
      throw new Error('Prüfsumme stimmt nicht – Datei verworfen');
    }
    await (partHandle as unknown as { move: (name: string) => Promise<void> }).move(file.name);
    set(file.name, { status: 'done', loaded: file.size });
  } catch (err) {
    try {
      access.close();
    } catch {
      // schon geschlossen
    }
    const reason = signal.aborted ? String(signal.reason) : null;
    if (reason === 'stop') {
      await dir.removeEntry(`${file.name}.part`).catch(() => undefined);
      set(file.name, { status: 'missing', loaded: 0 });
      throw new Error(`Download von ${file.name} gestoppt.`, { cause: err });
    }
    if (reason === 'pause') {
      set(file.name, { status: 'paused', loaded: offset });
      throw new Error(`Download von ${file.name} pausiert.`, { cause: err });
    }
    set(file.name, { status: 'error', error: err instanceof Error ? err.message : String(err) });
    throw new Error(
      `Download von ${file.name} fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}`,
      {
        cause: err,
      },
    );
  }
}

export function pause(name: string): void {
  controllers.get(name)?.abort('pause');
}

export async function stop(name: string): Promise<void> {
  const ctrl = controllers.get(name);
  if (ctrl) {
    ctrl.abort('stop');
    await running.get(name)?.catch(() => undefined);
    return;
  }
  // pausierter Teil-Download
  const dir = await modelDir();
  await dir.removeEntry(`${name}.part`).catch(() => undefined);
  if (entries.has(name)) set(name, { status: 'missing', loaded: 0, error: undefined });
}

export async function remove(name: string): Promise<void> {
  await stop(name);
  const dir = await modelDir();
  await dir.removeEntry(name).catch(() => undefined);
  if (entries.has(name)) set(name, { status: 'missing', loaded: 0, error: undefined });
}

export function state(name: string): DownloadState | undefined {
  return entries.get(name);
}

/**
 * Liefert die Datei für die Inferenz: fertige Datei lesen, sonst Download starten (nicht bei „pausiert“:
 * dann bewusst ein Hinweis statt stillem Fortsetzen).
 */
export async function bytesFor(
  name: string,
  mirror: string | null,
  onProgress: (loaded: number, total: number) => void,
): Promise<Uint8Array<ArrayBuffer>> {
  const e = entries.get(name);
  if (!e) throw new Error(`Unbekannte Modelldatei ${name}`);
  if (e.status === 'paused' && !running.has(name))
    throw new Error(`Der Download von ${name} ist pausiert – unter „Modelle“ fortsetzen.`);
  if (e.status !== 'done') {
    const timer = setInterval(() => {
      onProgress(e.loaded, e.total);
    }, 150);
    try {
      await start(name, mirror);
    } finally {
      clearInterval(timer);
    }
    onProgress(e.total, e.total);
  }
  const dir = await modelDir();
  return new Uint8Array(await (await (await dir.getFileHandle(name)).getFile()).arrayBuffer());
}
