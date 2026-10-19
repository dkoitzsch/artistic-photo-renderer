// Asynchrone Effekte (Ausführung "browser-cpu" im Web Worker oder "python" im Dienst).
// Der Compositor rendert synchron: Fehlt ein Ergebnis, meldet er eine Anfrage (mit Kopie des Eingangs) und reicht den
// Eingang vorerst durch. Nach dem Frame werden die Anfragen ausgeführt; fertige Ergebnisse liegen als Textur bereit,
// die Vorschau rendert dann neu (onChange). Der Export wiederholt den Durchlauf, bis alle Ergebnisse vorliegen.

import type { CpuRequest, CpuResponse } from '../effects/cpu.worker';
import type { ParamValue } from '../effects/manifest';
import { renderOnService } from '../ml/serviceEffects';
import type { LicenseMode } from '../state/project';
import { paddedBytesPerRow } from './readback';
import type { Frame } from './texturePool';
import { WORK_FORMAT } from './texturePool';

export type AsyncImpl = 'browser-cpu' | 'python';
export type AsyncStatus = 'pending' | 'running' | 'done' | 'error' | 'cancelled';

export type AsyncJobInfo = {
  key: string;
  label: string;
  impl: AsyncImpl;
  /** Endrender (Export, volle Auflösung) statt Vorschau */
  final: boolean;
  status: AsyncStatus;
  progress: number;
  error?: string;
};

export type AsyncRequestInfo = {
  label: string;
  impl: AsyncImpl;
  final: boolean;
  effectId: string;
  params: Record<string, ParamValue>;
  seed: number;
  scale: number;
  origin: [number, number];
  canvasSize: [number, number];
};

type Entry = AsyncJobInfo & {
  info: AsyncRequestInfo;
  input: GPUTexture | null;
  /** Zweitbild (Parameter vom Typ "image"), Kopie */
  inputB: GPUTexture | null;
  tex: GPUTexture | null;
  abort: AbortController | null;
  lastUsed: number;
  /** läuft bzw. ist fertig (gesetzt, sobald die Ausführung gestartet wurde) */
  promise: Promise<void> | null;
};

/** Führt CPU-Effekte nacheinander in einem Web Worker aus; Abbruch beendet den Worker. */
class CpuExecutor {
  private worker: Worker | null = null;
  private nextId = 1;
  private pending = new Map<
    number,
    { resolve: (d: Uint16Array) => void; reject: (e: Error) => void; progress: (p: number) => void }
  >();

  private ensure(): Worker {
    if (this.worker) return this.worker;
    const w = new Worker(new URL('../effects/cpu.worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (e: MessageEvent<CpuResponse>) => {
      const msg = e.data;
      const p = this.pending.get(msg.id);
      if (!p) return;
      if (msg.type === 'progress') p.progress(msg.progress);
      else {
        this.pending.delete(msg.id);
        if (msg.type === 'done') p.resolve(msg.data);
        else p.reject(new Error(msg.message));
      }
    };
    w.onerror = (e) => {
      for (const p of this.pending.values()) p.reject(new Error(e.message || 'Worker-Fehler'));
      this.pending.clear();
      this.worker?.terminate();
      this.worker = null;
    };
    this.worker = w;
    return w;
  }

  run(
    req: Omit<CpuRequest, 'type' | 'id'>,
    onProgress: (p: number) => void,
    signal: AbortSignal,
  ): Promise<Uint16Array> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      if (signal.aborted) {
        reject(new DOMException('abgebrochen', 'AbortError'));
        return;
      }
      this.pending.set(id, { resolve, reject, progress: onProgress });
      signal.addEventListener(
        'abort',
        () => {
          // Rechnung im Worker lässt sich nicht unterbrechen: Worker beenden, alle offenen Aufträge abbrechen
          for (const [pid, p] of this.pending) {
            p.reject(new DOMException('abgebrochen', 'AbortError'));
            this.pending.delete(pid);
          }
          this.worker?.terminate();
          this.worker = null;
        },
        { once: true },
      );
      this.ensure().postMessage({ type: 'render', id, ...req } satisfies CpuRequest, [req.data.buffer]);
    });
  }
}

/** Speicherbudget für fertige Ergebnis-Texturen (Bytes). */
const BUDGET = 1.5 * 1024 ** 3;

export class AsyncEffects {
  private readonly entries = new Map<string, Entry>();
  private collected: Entry[] = [];
  private readonly cpu = new CpuExecutor();
  private newResults = false;
  /** Wird bei jeder Zustandsänderung aufgerufen (Vorschau neu rendern, Job-Liste aktualisieren). */
  onChange: () => void = () => undefined;
  /** Lizenzmodus für Dienst-Effekte */
  licenseMode: () => LicenseMode = () => 'commercial';

  constructor(private readonly device: GPUDevice) {}

  /** true, wenn seit dem letzten Aufruf neue Ergebnisse fertig wurden (Vorschau neu rendern). */
  takeNewResults(): boolean {
    const r = this.newResults;
    this.newResults = false;
    return r;
  }

  /** Fertiges Ergebnis (Leinwand-Ausschnitt, rgba16float) oder undefined. */
  result(key: string): GPUTexture | undefined {
    const e = this.entries.get(key);
    if (e?.status !== 'done' || !e.tex) return undefined;
    e.lastUsed = performance.now();
    return e.tex;
  }

  status(key: string): AsyncJobInfo | undefined {
    return this.entries.get(key);
  }

  /** Meldet eine Anfrage (einmal je Schlüssel). Der Eingang wird in diesem Frame kopiert. */
  request(frame: Frame, key: string, info: AsyncRequestInfo, input: GPUTexture, imageB?: GPUTexture | null): void {
    if (this.entries.has(key)) return;
    const copyOf = (tex: GPUTexture, label: string) => {
      const copy = this.device.createTexture({
        label,
        size: [tex.width, tex.height],
        format: WORK_FORMAT,
        usage: GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST,
      });
      frame.encoder.copyTextureToTexture({ texture: tex }, { texture: copy }, [tex.width, tex.height]);
      return copy;
    };
    const copy = copyOf(input, `async-in ${info.effectId}`);
    const copyB = imageB ? copyOf(imageB, `async-in-b ${info.effectId}`) : null;
    const entry: Entry = {
      key,
      label: info.label,
      impl: info.impl,
      final: info.final,
      status: 'pending',
      progress: 0,
      info,
      input: copy,
      inputB: copyB,
      tex: null,
      abort: null,
      lastUsed: performance.now(),
      promise: null,
    };
    this.entries.set(key, entry);
    this.collected.push(entry);
  }

  /** Startet gesammelte Anfragen im Hintergrund (Vorschau). */
  kick(): void {
    if (this.collected.length) void this.flush();
  }

  /** Startet alle gesammelten Anfragen und wartet auf ihr Ende. */
  async flush(): Promise<void> {
    const list = this.collected.splice(0);
    if (list.length) this.onChange();
    for (const e of list) e.promise ??= this.run(e);
    await Promise.all(list.map((e) => e.promise ?? Promise.resolve()));
  }

  /** Wartet, bis die Anfragen zu diesen Schlüsseln fertig sind (egal, ob Export oder Vorschau sie gestartet hat). */
  async waitFor(keys: string[]): Promise<void> {
    const list = this.collected.splice(0);
    if (list.length) this.onChange();
    for (const e of list) e.promise ??= this.run(e);
    await Promise.all(keys.map((k) => this.entries.get(k)?.promise ?? Promise.resolve()));
  }

  /** Fehler/Abbrüche der Schlüssel (Export: nach flush prüfen). */
  failures(keys: string[]): AsyncJobInfo[] {
    return keys
      .map((k) => this.entries.get(k))
      .filter((e): e is Entry => !!e && (e.status === 'error' || e.status === 'cancelled'));
  }

  cancel(key: string): void {
    const e = this.entries.get(key);
    if (!e || (e.status !== 'pending' && e.status !== 'running')) return;
    e.abort?.abort();
    if (e.status === 'pending') {
      e.status = 'cancelled';
      this.collected = this.collected.filter((x) => x !== e);
      this.dropInput(e);
    }
    this.onChange();
  }

  cancelAll(): void {
    for (const e of this.entries.values()) this.cancel(e.key);
  }

  /** Fehlgeschlagene/abgebrochene Berechnung vergessen, damit sie erneut angefordert wird. */
  retry(key: string): void {
    const e = this.entries.get(key);
    if (e && (e.status === 'error' || e.status === 'cancelled')) {
      this.entries.delete(key);
      this.onChange();
    }
  }

  /** Laufende und fehlgeschlagene Jobs für die Oberfläche (fertige werden nicht gelistet). */
  jobs(): AsyncJobInfo[] {
    return [...this.entries.values()]
      .filter((e) => e.status !== 'done')
      .map(({ key, label, impl, final, status, progress, error }) => ({
        key,
        label,
        impl,
        final,
        status,
        progress,
        ...(error ? { error } : {}),
      }));
  }

  /** Alles verwerfen (z. B. beim Projektwechsel). */
  clear(): void {
    for (const e of this.entries.values()) {
      e.abort?.abort();
      this.dropInput(e);
      e.tex?.destroy();
    }
    this.entries.clear();
    this.collected = [];
    this.onChange();
  }

  private dropInput(e: Entry): void {
    e.input?.destroy();
    e.input = null;
    e.inputB?.destroy();
    e.inputB = null;
  }

  private async readInput(tex: GPUTexture | null): Promise<Uint16Array> {
    if (!tex) throw new Error('Eingang fehlt');
    const { width: w, height: h } = tex;
    const stride = paddedBytesPerRow(w, 8);
    const buffer = this.device.createBuffer({
      size: stride * h,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    const enc = this.device.createCommandEncoder({ label: 'async-read' });
    enc.copyTextureToBuffer({ texture: tex }, { buffer, bytesPerRow: stride }, [w, h]);
    this.device.queue.submit([enc.finish()]);
    await buffer.mapAsync(GPUMapMode.READ);
    const src = new Uint16Array(buffer.getMappedRange());
    const out = new Uint16Array(w * h * 4);
    const row = w * 4;
    for (let y = 0; y < h; y++) out.set(src.subarray((y * stride) / 2, (y * stride) / 2 + row), y * row);
    buffer.unmap();
    buffer.destroy();
    return out;
  }

  private async run(e: Entry): Promise<void> {
    if (e.status !== 'pending' || !e.input) return;
    const { width, height } = e.input;
    e.abort = new AbortController();
    e.status = 'running';
    this.onChange();
    let lastNotify = 0;
    const progress = (p: number) => {
      e.progress = p;
      const now = performance.now();
      if (now - lastNotify > 100) {
        lastNotify = now;
        this.onChange();
      }
    };
    try {
      const data = await this.readInput(e.input);
      const b = e.inputB;
      const imageB = b ? { data: await this.readInput(b), width: b.width, height: b.height } : null;
      this.dropInput(e);
      const { info } = e;
      const result =
        info.impl === 'browser-cpu'
          ? await this.cpu.run(
              {
                effectId: info.effectId,
                data,
                width,
                height,
                params: info.params,
                seed: info.seed,
                scale: info.scale,
                origin: info.origin,
                canvasSize: info.canvasSize,
                imageB,
              },
              progress,
              e.abort.signal,
            )
          : await renderOnService(
              {
                effectId: info.effectId,
                data,
                width,
                height,
                params: info.params,
                scale: info.scale,
                origin: info.origin,
                canvasSize: info.canvasSize,
                licenseMode: this.licenseMode(),
                imageB,
              },
              progress,
              e.abort.signal,
            );
      const tex = this.device.createTexture({
        label: `async-out ${info.effectId}`,
        size: [width, height],
        format: WORK_FORMAT,
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC,
      });
      this.device.queue.writeTexture(
        { texture: tex },
        result as Uint16Array<ArrayBuffer>,
        { bytesPerRow: width * 8 },
        [width, height],
      );
      e.tex = tex;
      this.newResults = true;
      e.status = 'done';
      e.progress = 1;
      this.evict();
    } catch (err) {
      this.dropInput(e);
      if (e.abort.signal.aborted || (err instanceof DOMException && err.name === 'AbortError')) {
        e.status = 'cancelled';
      } else {
        e.status = 'error';
        e.error = err instanceof Error ? err.message : String(err);
      }
    } finally {
      e.abort = null;
      this.onChange();
    }
  }

  private evict(): void {
    const done = [...this.entries.values()].filter((e) => e.tex);
    let bytes = done.reduce((s, e) => s + (e.tex ? e.tex.width * e.tex.height * 8 : 0), 0);
    for (const e of done.sort((a, b) => a.lastUsed - b.lastUsed)) {
      if (bytes <= BUDGET) break;
      if (!e.tex) continue;
      bytes -= e.tex.width * e.tex.height * 8;
      e.tex.destroy();
      this.entries.delete(e.key);
    }
  }
}
