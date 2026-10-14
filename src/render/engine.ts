// Zentrale Render-Engine: Originale, Plugins, Compositor, Vorschau (mit Cache), Anzeige und Export.

import { defaultParams } from '../effects/manifest';
import { usePluginStore, type Plugin } from '../effects/pluginStore';
import { firstLayer, type Project } from '../state/project';
import type { View } from '../state/viewMath';
import { Compositor, ResultCache, type Rect } from './compositor';
import { GpuCore } from './core';
import { EffectRunner } from './effectRunner';
import { paddedBytesPerRow, unpadRows } from './readback';
import colorWgsl from './shaders/color.wgsl?raw';
import viewWgsl from './shaders/view.wgsl?raw';
import { SourceStore } from './sources';
import { dispatch2d, Frame } from './texturePool';

/** Lange Kante der Vorschau in px (SPEC: max. 2048). */
export const PREVIEW_MAX_EDGE = 2048;

export type ViewColors = {
  /** alle Farben linear */
  background: [number, number, number];
  checkerA: [number, number, number];
  checkerB: [number, number, number];
};

export type FrameStats = { cpuMs: number; gpuMs: number; effectRuns: number };

const VIEW_UNIFORM_FLOATS = 24;

export function previewScale(project: Project): number {
  return Math.min(1, PREVIEW_MAX_EDGE / Math.max(project.canvas.width, project.canvas.height));
}

export function previewSize(project: Project): [number, number] {
  const s = previewScale(project);
  return [
    Math.max(1, Math.round(project.canvas.width * s)),
    Math.max(1, Math.round(project.canvas.height * s)),
  ];
}

export class Engine {
  readonly core: GpuCore;
  readonly sources: SourceStore;
  readonly runner: EffectRunner;
  readonly compositor: Compositor;
  private readonly cache: ResultCache;

  private readonly viewPipeline: GPURenderPipeline;
  private readonly nearestSampler: GPUSampler;
  private context: GPUCanvasContext | null = null;
  private lastAfter: GPUTexture | null = null;
  private lastBefore: GPUTexture | null = null;
  private compiling = new Set<string>();

  lastStats: FrameStats = { cpuMs: 0, gpuMs: 0, effectRuns: 0 };

  constructor(readonly device: GPUDevice) {
    this.core = new GpuCore(device);
    this.sources = new SourceStore(this.core);
    this.runner = new EffectRunner(this.core);
    this.compositor = new Compositor(this.core, this.sources, this.runner);
    this.cache = new ResultCache(this.core.pool);

    const viewModule = device.createShaderModule({ label: 'view', code: colorWgsl + viewWgsl });
    this.viewPipeline = device.createRenderPipeline({
      label: 'view',
      layout: 'auto',
      vertex: { module: viewModule, entryPoint: 'vs' },
      fragment: {
        module: viewModule,
        entryPoint: 'fs',
        targets: [{ format: navigator.gpu.getPreferredCanvasFormat() }],
      },
      primitive: { topology: 'triangle-list' },
    });
    this.nearestSampler = device.createSampler({ magFilter: 'nearest', minFilter: 'nearest' });
  }

  // ---------- Plugins ----------

  /** Kompiliert alle Plugins, deren Revision noch nicht kompiliert ist; Ergebnis landet im Plugin-Store. */
  async compilePlugins(): Promise<void> {
    const { plugins, updatePlugin } = usePluginStore.getState();
    const todo = Object.values(plugins).filter(
      (p: Plugin) =>
        p.status === 'pending' &&
        (!p.hasScript || p.module !== null) &&
        !this.compiling.has(`${p.folder}#${p.revision}`),
    );
    await Promise.all(
      todo.map(async (p) => {
        const tag = `${p.folder}#${p.revision}`;
        this.compiling.add(tag);
        try {
          const errors = await this.runner.compile(p);
          const current = usePluginStore.getState().plugins[p.folder];
          if (current?.revision !== p.revision) return; // inzwischen neu geladen
          updatePlugin(p.folder, errors.length ? { status: 'error', errors } : { status: 'ok', errors: [] });
        } finally {
          this.compiling.delete(tag);
        }
      }),
    );
  }

  // ---------- Anzeige ----------

  attachCanvas(canvas: HTMLCanvasElement): void {
    const context = canvas.getContext('webgpu');
    if (!context) throw new Error('Leinwand unterstützt keinen WebGPU-Kontext.');
    context.configure({
      device: this.device,
      format: navigator.gpu.getPreferredCanvasFormat(),
      alphaMode: 'opaque',
    });
    this.context = context;
  }

  detachCanvas(): void {
    this.context?.unconfigure();
    this.context = null;
  }

  /** Rendert die Vorschau (nur Geändertes) und zeichnet die Leinwand. */
  present(project: Project | null, view: View, dpr: number, colors: ViewColors, splitX: number | null): void {
    const t0 = performance.now();
    let effectRuns = 0;
    if (project) {
      const runsBefore = this.compositor.effectRuns;
      const frame = new Frame(this.device, this.core.pool, 'preview');
      this.cache.beginFrame();
      const [w, h] = previewSize(project);
      const base = {
        scale: previewScale(project),
        canvasSize: [w, h] as [number, number],
        region: { x: 0, y: 0, width: w, height: h },
        cache: this.cache,
      };
      const after = this.compositor.render(frame, project, {
        ...base,
        ignoreEffects: false,
        variant: 'after',
      });
      const before =
        splitX !== null
          ? this.compositor.render(frame, project, { ...base, ignoreEffects: true, variant: 'before' })
          : null;
      // Ergebnisse sind gecacht oder Originale; eigene Texturen (z. B. leere Leinwand) übernimmt der Cache.
      if (after.owned) this.cache.set('after:final', after.key, after.tex);
      if (before?.owned) this.cache.set('before:final', before.key, before.tex);
      this.lastAfter = after.tex;
      this.lastBefore = before?.tex ?? null;
      this.drawInto(frame, project, view, dpr, colors, splitX);
      frame.submit();
      this.cache.endFrame();
      effectRuns = this.compositor.effectRuns - runsBefore;
    } else {
      this.lastAfter = null;
      this.lastBefore = null;
      this.cache.clear();
      const frame = new Frame(this.device, this.core.pool, 'empty');
      this.drawInto(frame, null, view, dpr, colors, null);
      frame.submit();
    }
    const cpuMs = performance.now() - t0;
    void this.device.queue.onSubmittedWorkDone().then(() => {
      this.lastStats = { cpuMs, gpuMs: performance.now() - t0, effectRuns };
    });
  }

  private drawInto(
    frame: Frame,
    project: Project | null,
    view: View,
    dpr: number,
    colors: ViewColors,
    splitX: number | null,
  ): void {
    if (!this.context) return;
    const u = new Float32Array(VIEW_UNIFORM_FLOATS);
    u.set([view.offsetX, view.offsetY, view.zoom, dpr]);
    u.set([project?.canvas.width ?? 1, project?.canvas.height ?? 1, project ? 1 : 0, 8], 4);
    u.set([...colors.background, 1], 8);
    u.set([...colors.checkerA, 1], 12);
    u.set([...colors.checkerB, 1], 16);
    u.set([splitX ?? -1], 20);

    const after = this.lastAfter ?? this.core.black;
    const before = this.lastBefore ?? after;
    const bindGroup = this.device.createBindGroup({
      layout: this.viewPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: frame.uniform(u) } },
        { binding: 1, resource: after.createView() },
        { binding: 2, resource: before.createView() },
        // Ab 200 % (bezogen auf die Vorschau-Pixel) Pixel scharf darstellen, darunter bilinear.
        {
          binding: 3,
          resource:
            project && view.zoom * (project.canvas.width / after.width) >= 2
              ? this.nearestSampler
              : this.core.linearSampler,
        },
      ],
    });
    const pass = frame.encoder.beginRenderPass({
      colorAttachments: [
        {
          view: this.context.getCurrentTexture().createView(),
          loadOp: 'clear',
          storeOp: 'store',
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
        },
      ],
    });
    pass.setPipeline(this.viewPipeline);
    pass.setBindGroup(0, bindGroup);
    pass.draw(3);
    pass.end();
  }

  /** Verwirft Vorschau-Caches (z. B. beim Projektwechsel). */
  resetPreview(): void {
    this.cache.clear();
    this.lastAfter = null;
    this.lastBefore = null;
  }

  // ---------- Export ----------

  /**
   * Rendert das Projekt in voller Auflösung in Kacheln und liefert 8-Bit-sRGB-RGBA (gerades Alpha).
   * overlap: Reichweite der Effekte in px; die Kacheln werden um sie erweitert und danach beschnitten.
   */
  async renderFull(
    project: Project,
    overlap: number,
    tileSize = 2048,
    onProgress?: (done: number, total: number) => void,
  ): Promise<Uint8ClampedArray<ArrayBuffer>> {
    const { width: W, height: H } = project.canvas;
    const out = new Uint8ClampedArray(W * H * 4);
    // Ausrichtung auf 64 px, damit Pyramiden (Downsampling ×2) in allen Kacheln gleich liegen.
    const ALIGN = 64;
    const pad = Math.ceil((overlap + 8) / ALIGN) * ALIGN;
    const tilesX = Math.ceil(W / tileSize);
    const tilesY = Math.ceil(H / tileSize);
    let done = 0;
    for (let ty = 0; ty < tilesY; ty++) {
      for (let tx = 0; tx < tilesX; tx++) {
        const tile: Rect = {
          x: tx * tileSize,
          y: ty * tileSize,
          width: Math.min(tileSize, W - tx * tileSize),
          height: Math.min(tileSize, H - ty * tileSize),
        };
        const x0 = Math.max(0, Math.floor((tile.x - pad) / ALIGN) * ALIGN);
        const y0 = Math.max(0, Math.floor((tile.y - pad) / ALIGN) * ALIGN);
        const x1 = Math.min(W, tile.x + tile.width + pad);
        const y1 = Math.min(H, tile.y + tile.height + pad);
        const region: Rect = { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };

        const frame = new Frame(this.device, this.core.pool, 'export');
        const res = this.compositor.render(frame, project, {
          scale: 1,
          canvasSize: [W, H],
          region,
          ignoreEffects: false,
          cache: null,
          variant: 'export',
        });
        frame.submit();
        const pixels = await this.encode(res.tex, [tile.x - x0, tile.y - y0], tile.width, tile.height);
        if (res.owned) this.core.pool.release(res.tex);

        const row = tile.width * 4;
        for (let y = 0; y < tile.height; y++) {
          out.set(pixels.subarray(y * row, (y + 1) * row), ((tile.y + y) * W + tile.x) * 4);
        }
        onProgress?.(++done, tilesX * tilesY);
      }
    }
    this.core.pool.trim();
    return out;
  }

  /** Kodiert einen Ausschnitt einer Arbeitstextur zu 8-Bit-sRGB (gerades Alpha). */
  async encode(
    texture: GPUTexture,
    origin: [number, number],
    width: number,
    height: number,
  ): Promise<Uint8ClampedArray<ArrayBuffer>> {
    const { device } = this;
    const out = device.createTexture({
      label: 'encode-out',
      size: [width, height],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC,
    });
    const frame = new Frame(device, this.core.pool, 'encode');
    const bg = this.core.bindCompute(this.core.encodePipeline, [
      texture.createView(),
      out.createView(),
      { buffer: frame.uniform(new Int32Array([origin[0], origin[1], 0, 0])) },
    ]);
    dispatch2d(frame, this.core.encodePipeline, bg, width, height, 'encode');
    const bytesPerRow = paddedBytesPerRow(width, 4);
    const buffer = device.createBuffer({
      label: 'readback',
      size: bytesPerRow * height,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    frame.encoder.copyTextureToBuffer({ texture: out }, { buffer, bytesPerRow }, [width, height]);
    frame.submit();
    await buffer.mapAsync(GPUMapMode.READ);
    const pixels = unpadRows(new Uint8Array(buffer.getMappedRange()), width, height, 4);
    buffer.unmap();
    buffer.destroy();
    out.destroy();
    return pixels;
  }

  /** Aktuelle Vorschau („nachher“) als 8-Bit-RGBA, z. B. für Miniaturen. */
  async readPreview(): Promise<{
    pixels: Uint8ClampedArray<ArrayBuffer>;
    width: number;
    height: number;
  } | null> {
    const t = this.lastAfter;
    if (!t) return null;
    return { pixels: await this.encode(t, [0, 0], t.width, t.height), width: t.width, height: t.height };
  }

  /** Live-Miniatur: ein Effekt mit Standardwerten auf der ersten Ebene des Projekts. */
  async effectThumbnail(project: Project, plugin: Plugin, edge = 160): Promise<ImageData | null> {
    const layer = firstLayer(project);
    if (!layer || !plugin.manifest || plugin.status !== 'ok' || !this.runner.isCompiled(plugin)) return null;
    if (!this.sources.has(layer.originalId)) return null;
    const s = Math.min(1, edge / Math.max(project.canvas.width, project.canvas.height));
    const w = Math.max(1, Math.round(project.canvas.width * s));
    const h = Math.max(1, Math.round(project.canvas.height * s));
    const frame = new Frame(this.device, this.core.pool, 'thumbnail');
    const src = this.sources.at(frame, layer.originalId, w, h);
    const out = this.runner.apply(
      frame,
      plugin,
      {
        instanceId: 'thumbnail',
        effectId: plugin.folder,
        effectVersion: plugin.manifest.version,
        enabled: true,
        strength: 1,
        params: defaultParams(plugin.manifest),
        region: 'whole',
      },
      src,
      { mask: this.core.white, focus: this.core.white, depth: this.core.black },
      { scale: s, origin: [0, 0], canvasSize: [w, h] },
    );
    frame.submit();
    const pixels = await this.encode(out, [0, 0], w, h);
    this.core.pool.release(out);
    return new ImageData(pixels, w, h);
  }
}
