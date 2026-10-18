// Originale und Masken auf der GPU sowie daraus abgeleitete, zwischengespeicherte Texturen
// (verkleinerte Originale, aufbereitete Masken, Lochfüllungen).

import type { GpuCore } from './core';
import { dispatch2d, Frame, WORK_FORMAT } from './texturePool';

const WORK_USAGE_PERSISTENT =
  GPUTextureUsage.TEXTURE_BINDING |
  GPUTextureUsage.STORAGE_BINDING |
  GPUTextureUsage.COPY_SRC |
  GPUTextureUsage.COPY_DST |
  GPUTextureUsage.RENDER_ATTACHMENT;

let halfTable: Uint16Array | null = null;

/** Tabelle 16-Bit-Ganzzahl (0…65535 ≙ 0…1) → IEEE-Half-Bits, einmal berechnet. */
function u16ToHalfTable(): Uint16Array {
  if (halfTable) return halfTable;
  const t = new Uint16Array(65536);
  const f32 = new Float32Array(1);
  const u32 = new Uint32Array(f32.buffer);
  for (let i = 0; i < 65536; i++) {
    f32[0] = i / 65535;
    const x = u32[0] ?? 0;
    const sign = (x >>> 16) & 0x8000;
    const exp = ((x >>> 23) & 0xff) - 127 + 15;
    const mant = x & 0x7fffff;
    if (exp <= 0) {
      // subnormal (nur sehr kleine Werte)
      t[i] = sign | ((mant | 0x800000) >>> (14 - exp));
    } else if (exp >= 31) {
      t[i] = sign | 0x7c00;
    } else {
      // runden auf nächsten Wert
      t[i] = sign | (exp << 10) | ((mant + 0x1000) >>> 13);
    }
  }
  halfTable = t;
  return t;
}

/** LRU-Cache mit Speicherbudget für persistente Texturen. */
class DerivedCache {
  private readonly entries = new Map<string, GPUTexture>();
  private bytes = 0;

  constructor(private readonly budget: number) {}

  get(key: string): GPUTexture | undefined {
    const t = this.entries.get(key);
    if (t) {
      // als zuletzt benutzt markieren
      this.entries.delete(key);
      this.entries.set(key, t);
    }
    return t;
  }

  set(key: string, tex: GPUTexture, protect: Set<GPUTexture>): void {
    this.entries.set(key, tex);
    this.bytes += tex.width * tex.height * 8;
    for (const [k, t] of this.entries) {
      if (this.bytes <= this.budget) break;
      if (protect.has(t) || k === key) continue;
      this.entries.delete(k);
      this.bytes -= t.width * t.height * 8;
      t.destroy();
    }
  }

  retain(pred: (key: string) => boolean): void {
    for (const [k, t] of this.entries)
      if (!pred(k)) {
        this.entries.delete(k);
        this.bytes -= t.width * t.height * 8;
        t.destroy();
      }
  }
}

export class SourceStore {
  private readonly full = new Map<string, GPUTexture>();
  private readonly masks = new Map<string, GPUTexture>();
  private readonly derived = new DerivedCache(1.5 * 1024 ** 3);
  /** In diesem Frame benutzte abgeleitete Texturen – werden vom LRU nicht verdrängt. */
  private readonly inUse = new Set<GPUTexture>();

  constructor(private readonly core: GpuCore) {}

  has(id: string): boolean {
    return this.full.has(id);
  }

  hasMask(id: string): boolean {
    return this.masks.has(id);
  }

  /** Lädt ein dekodiertes Bild (sRGB, gerades Alpha). */
  add(id: string, bitmap: ImageBitmap): void {
    if (this.full.has(id)) return;
    const { device } = this.core;
    const { width, height } = bitmap;
    const staging = device.createTexture({
      label: 'import-staging',
      size: [width, height],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    device.queue.copyExternalImageToTexture(
      { source: bitmap },
      { texture: staging, premultipliedAlpha: false, colorSpace: 'srgb' },
      [width, height],
    );
    const work = device.createTexture({
      label: `original ${id.slice(0, 8)}`,
      size: [width, height],
      format: WORK_FORMAT,
      usage: WORK_USAGE_PERSISTENT,
    });
    const frame = new Frame(device, this.core.pool, 'import');
    const bg = this.core.bindCompute(this.core.importPipeline, [staging.createView(), work.createView()]);
    dispatch2d(frame, this.core.importPipeline, bg, width, height, 'import');
    frame.submit();
    staging.destroy();
    this.full.set(id, work);
  }

  /** Lädt eine 16-Bit-Maske (0…65535) als r16float-Textur. */
  addMask(id: string, width: number, height: number, data: Uint16Array): void {
    if (this.masks.has(id)) return;
    const table = u16ToHalfTable();
    const half = new Uint16Array(data.length);
    for (let i = 0; i < data.length; i++) half[i] = table[data[i] ?? 0] ?? 0;
    const tex = this.core.device.createTexture({
      label: `mask ${id.slice(0, 8)}`,
      size: [width, height],
      format: 'r16float',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    this.core.device.queue.writeTexture({ texture: tex }, half, { bytesPerRow: width * 2 }, [width, height]);
    this.masks.set(id, tex);
  }

  original(id: string): GPUTexture {
    const t = this.full.get(id);
    if (!t) throw new Error(`Original ${id.slice(0, 8)} ist nicht geladen.`);
    return t;
  }

  mask(id: string): GPUTexture {
    const t = this.masks.get(id);
    if (!t) throw new Error(`Maske ${id.slice(0, 8)} ist nicht geladen.`);
    return t;
  }

  /** Original in der Größe width × height (volle Größe: das Original selbst, sonst gecacht verkleinert). */
  at(frame: Frame, id: string, width: number, height: number): GPUTexture {
    const full = this.original(id);
    if (full.width === width && full.height === height) return full;
    return this.derive(`scaled|${id}@${width}x${height}`, width, height, (tex) => {
      this.core.resample(frame, full, tex);
    });
  }

  /**
   * Abgeleitete Textur (persistent, LRU mit Budget). compute füllt sie beim ersten Zugriff.
   * Schlüssel müssen alle Eingaben enthalten.
   */
  derive(key: string, width: number, height: number, compute: (tex: GPUTexture) => void): GPUTexture {
    let tex = this.derived.get(key);
    if (!tex) {
      tex = this.core.device.createTexture({
        label: key.slice(0, 40),
        size: [width, height],
        format: WORK_FORMAT,
        usage: WORK_USAGE_PERSISTENT,
      });
      compute(tex);
      this.derived.set(key, tex, this.inUse);
    }
    this.inUse.add(tex);
    return tex;
  }

  /** Am Ende eines Frames: Schutz vor Verdrängung aufheben. */
  endFrame(): void {
    this.inUse.clear();
  }

  /** Gibt eine einzelne (temporäre) Maske frei. */
  retainOnlyMaskDrop(id: string): void {
    this.masks.get(id)?.destroy();
    this.masks.delete(id);
  }

  /** Gibt alles frei, was nicht zu den angegebenen Originalen/Masken gehört. */
  retainOnly(originals: Set<string>, masks: Set<string> = new Set()): void {
    for (const [id, t] of this.full)
      if (!originals.has(id)) {
        t.destroy();
        this.full.delete(id);
      }
    for (const [id, t] of this.masks)
      if (!masks.has(id)) {
        t.destroy();
        this.masks.delete(id);
      }
    this.derived.retain((key) => {
      const ids = key.split('|')[1]?.split('@')[0]?.split('+') ?? [];
      return ids.every((id) => originals.has(id) || masks.has(id));
    });
  }
}
