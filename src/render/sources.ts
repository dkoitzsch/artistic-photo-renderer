// Originale auf der GPU: volle Auflösung im Arbeitsraum (linear, vormultipliziert) plus
// zwischengespeicherte verkleinerte Fassungen für die Vorschau.

import type { GpuCore } from './core';
import { dispatch2d, Frame, WORK_FORMAT } from './texturePool';

export class SourceStore {
  private readonly full = new Map<string, GPUTexture>();
  private readonly scaled = new Map<string, GPUTexture>();

  constructor(private readonly core: GpuCore) {}

  has(id: string): boolean {
    return this.full.has(id);
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
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC,
    });
    const frame = new Frame(device, this.core.pool, 'import');
    const bg = this.core.bindCompute(this.core.importPipeline, [staging.createView(), work.createView()]);
    dispatch2d(frame, this.core.importPipeline, bg, width, height, 'import');
    frame.submit();
    staging.destroy();
    this.full.set(id, work);
  }

  /** Original in der Größe width × height (volle Größe: das Original selbst, sonst gecacht verkleinert). */
  at(frame: Frame, id: string, width: number, height: number): GPUTexture {
    const full = this.full.get(id);
    if (!full) throw new Error(`Original ${id.slice(0, 8)} ist nicht geladen.`);
    if (full.width === width && full.height === height) return full;
    const key = `${id}@${width}x${height}`;
    let tex = this.scaled.get(key);
    if (!tex) {
      tex = this.core.device.createTexture({
        label: `scaled ${key.slice(0, 8)}`,
        size: [width, height],
        format: WORK_FORMAT,
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC,
      });
      this.core.resample(frame, full, tex);
      this.scaled.set(key, tex);
    }
    return tex;
  }

  /** Gibt alles frei, was nicht in keep steht. */
  retainOnly(keep: Set<string>): void {
    for (const [id, t] of this.full)
      if (!keep.has(id)) {
        t.destroy();
        this.full.delete(id);
      }
    for (const [key, t] of this.scaled)
      if (!keep.has(key.split('@')[0] ?? '')) {
        t.destroy();
        this.scaled.delete(key);
      }
  }
}
