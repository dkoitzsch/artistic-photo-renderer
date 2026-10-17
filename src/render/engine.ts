// Zentrale Render-Engine: Originale, Plugins, Compositor, Vorschau (mit Cache), Anzeige und Export.

import { defaultParams, type ParamValue } from '../effects/manifest';
import { effectReach } from '../effects/reach';
import { usePluginStore, type Plugin } from '../effects/pluginStore';
import {
  findNode,
  firstLayer,
  walk,
  type EffectMask,
  type Group,
  type Project,
  type SceneNode,
} from '../state/project';
import { getPlugin } from '../effects/pluginStore';
import type { View } from '../state/viewMath';
import { AsyncEffects } from './asyncEffects';
import { Compositor, projectReach, ResultCache, type Rect } from './compositor';
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

/** Prüfansicht über dem Ergebnis: Maske (rot = ausgeblendet) oder Fokuskarte */
export type Overlay = {
  layerId: string;
  kind: 'mask' | 'focus' | 'depth' | 'luminance' | 'edges';
  /** Deckkraft der Analysekarten-Ansicht (0..1) */
  opacity?: number;
};

const VIEW_UNIFORM_FLOATS = 32;

/**
 * Ausschnitt in voller Auflösung (Spec „Effekte“ Abschnitt 8): ab diesem Verhältnis Geräte-Pixel pro Vorschau-Pixel
 * rendert die Engine den sichtbaren Ausschnitt nach einer kurzen Ruhepause in Leinwandauflösung nach.
 */
export const DETAIL_MIN_GAIN = 1.25;
/** Größter Ausschnitt in Leinwand-Pixeln (sonst bleibt es bei der Vorschau) */
export const DETAIL_MAX_PIXELS = 8_000_000;
/** Ruhepause nach der letzten Änderung (Zoom, Verschieben, Regler), bevor der Ausschnitt gerendert wird */
export const DETAIL_DELAY_MS = 150;

type Detail = {
  project: Project;
  split: boolean;
  /** gültiger Bereich in Leinwand-px (ohne Rand) */
  rect: Rect;
  /** gerenderter Bereich inkl. Effekt-Rand; Ursprung der Texturen in Leinwand-px */
  region: Rect;
  after: GPUTexture;
  before: GPUTexture | null;
};

const contains = (a: Rect, b: Rect) =>
  b.x >= a.x && b.y >= a.y && b.x + b.width <= a.x + a.width && b.y + b.height <= a.y + a.height;

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
  /** Effekte im Web Worker bzw. im Python-Dienst */
  readonly async: AsyncEffects;
  private readonly cache: ResultCache;

  private readonly viewPipeline: GPURenderPipeline;
  private readonly nearestSampler: GPUSampler;
  private context: GPUCanvasContext | null = null;
  private lastAfter: GPUTexture | null = null;
  private lastBefore: GPUTexture | null = null;
  private lastOverlay: GPUTexture | null = null;
  private overlayKind = 0;
  private overlayOpacity = 1;
  private compiling = new Set<string>();
  private detail: Detail | null = null;
  private detailTimer: ReturnType<typeof setTimeout> | null = null;
  private lastProject: Project | null = null;
  /** Ausschnitt in voller Auflösung bei Zoom über die Vorschau hinaus (abschaltbar, z. B. für Tests) */
  detailEnabled = true;
  /** wird aufgerufen, sobald ein Ausschnitt in voller Auflösung fertig ist (Anzeige neu zeichnen) */
  onDetailReady: (() => void) | null = null;

  lastStats: FrameStats = { cpuMs: 0, gpuMs: 0, effectRuns: 0 };

  constructor(readonly device: GPUDevice) {
    this.core = new GpuCore(device);
    this.sources = new SourceStore(this.core);
    this.runner = new EffectRunner(this.core);
    this.async = new AsyncEffects(device);
    this.compositor = new Compositor(this.core, this.sources, this.runner, this.async);
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
          // Effekte ohne GPU-Ausführung (Worker/Dienst) haben keinen Shader
          const impl = p.manifest?.implementations;
          const errors =
            impl && impl.preview !== 'webgpu' && impl.final !== 'webgpu' ? [] : await this.runner.compile(p);
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
  present(
    project: Project | null,
    view: View,
    dpr: number,
    colors: ViewColors,
    splitX: number | null,
    overlay: Overlay | null = null,
    parallax: [number, number] | null = null,
  ): void {
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
        ...(parallax
          ? { parallax: [parallax[0] * base.scale, parallax[1] * base.scale] as [number, number] }
          : {}),
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
      this.lastOverlay = null;
      this.overlayKind = 0;
      if (overlay) {
        const tex = this.compositor.overlay(frame, project, overlay.layerId, overlay.kind, {
          ...base,
          ignoreEffects: false,
          variant: 'overlay',
        });
        if (tex) {
          // mit Vorschau-Cache nie „owned“: der Cache hält die Textur bis zum nächsten Frame
          this.lastOverlay = tex.tex;
          this.overlayKind = { mask: 1, focus: 2, depth: 3, luminance: 4, edges: 5 }[overlay.kind];
          this.overlayOpacity = overlay.opacity ?? 1;
        }
      }
      this.updateDetail(project, view, dpr, splitX !== null, parallax !== null);
      this.drawInto(frame, project, view, dpr, colors, splitX);
      frame.submit();
      // fehlende Ergebnisse von Worker-/Dienst-Effekten im Hintergrund berechnen (danach rendert die Vorschau neu)
      this.async.kick();
      this.cache.endFrame();
      this.sources.endFrame();
      effectRuns = this.compositor.effectRuns - runsBefore;
    } else {
      this.lastAfter = null;
      this.lastBefore = null;
      this.dropDetail();
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
    u.set([splitX ?? -1, this.overlayKind, this.overlayOpacity], 20);
    const detail = this.detail;
    if (detail) {
      u.set([detail.region.x, detail.region.y, 1, 0], 24);
      u.set(
        [detail.rect.x, detail.rect.y, detail.rect.x + detail.rect.width, detail.rect.y + detail.rect.height],
        28,
      );
    }

    const after = this.lastAfter ?? this.core.black;
    const before = this.lastBefore ?? after;
    const bindGroup = this.device.createBindGroup({
      layout: this.viewPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: frame.uniform(u) } },
        { binding: 1, resource: after.createView() },
        { binding: 2, resource: before.createView() },
        { binding: 4, resource: (this.lastOverlay ?? this.core.black).createView() },
        { binding: 5, resource: (detail?.after ?? this.core.black).createView() },
        { binding: 6, resource: (detail?.before ?? detail?.after ?? this.core.black).createView() },
        // Ausschnitt in Leinwandauflösung: ab 200 % scharfe Pixel
        {
          binding: 7,
          resource: view.zoom * dpr >= 2 ? this.nearestSampler : this.core.linearSampler,
        },
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

  /** Zustand des Ausschnitts in voller Auflösung (Tests, Statusanzeige). */
  detailInfo(): { rect: Rect } | null {
    return this.detail ? { rect: { ...this.detail.rect } } : null;
  }

  /** Sichtbarer Bereich in Leinwand-px, falls er einen Ausschnitt in voller Auflösung braucht. */
  private detailRequest(project: Project, view: View, dpr: number): Rect | null {
    const ps = previewScale(project);
    const canvas = this.context?.canvas;
    if (!this.detailEnabled || ps >= 1 || !canvas) return null;
    if (view.zoom * dpr < ps * DETAIL_MIN_GAIN) return null;
    // Worker-/Dienst-Effekte rechnen auf dem ganzen Bild – dafür bleibt es bei der Vorschau
    if (hasAsyncEffects(project)) return null;
    const { width: W, height: H } = project.canvas;
    const x0 = Math.max(0, Math.floor(-view.offsetX / view.zoom));
    const y0 = Math.max(0, Math.floor(-view.offsetY / view.zoom));
    const x1 = Math.min(W, Math.ceil((canvas.width / dpr - view.offsetX) / view.zoom));
    const y1 = Math.min(H, Math.ceil((canvas.height / dpr - view.offsetY) / view.zoom));
    if (x1 <= x0 || y1 <= y0 || (x1 - x0) * (y1 - y0) > DETAIL_MAX_PIXELS) return null;
    return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
  }

  /** Verwirft einen veralteten Ausschnitt und plant bei Bedarf einen neuen (nach einer Ruhepause). */
  private updateDetail(project: Project, view: View, dpr: number, split: boolean, parallax: boolean): void {
    this.lastProject = project;
    const want = parallax ? null : this.detailRequest(project, view, dpr);
    const d = this.detail;
    if (d && (!want || d.project !== project || d.split !== split || !contains(d.rect, want)))
      this.dropDetail();
    if (this.detailTimer !== null) clearTimeout(this.detailTimer);
    this.detailTimer = null;
    if (!want || this.detail) return;
    this.detailTimer = setTimeout(() => {
      this.detailTimer = null;
      if (this.lastProject !== project) return;
      this.renderDetail(project, want, split);
      this.onDetailReady?.();
    }, DETAIL_DELAY_MS);
  }

  private renderDetail(project: Project, visible: Rect, split: boolean): void {
    const { width: W, height: H } = project.canvas;
    // etwas Vorrat zum Verschieben, solange er ins Budget passt
    const mx = Math.round(visible.width * 0.25);
    const my = Math.round(visible.height * 0.25);
    let rect: Rect = {
      x: Math.max(0, visible.x - mx),
      y: Math.max(0, visible.y - my),
      width: 0,
      height: 0,
    };
    rect.width = Math.min(W, visible.x + visible.width + mx) - rect.x;
    rect.height = Math.min(H, visible.y + visible.height + my) - rect.y;
    if (rect.width * rect.height > DETAIL_MAX_PIXELS) rect = visible;
    // Rand für die Effekt-Reichweite, ausgerichtet wie beim Export (gleiche Pyramiden-Lage → gleiches Ergebnis)
    const ALIGN = 64;
    const pad =
      Math.ceil((projectReach(project.root, (fx) => effectReach(fx, project.canvas)) + 8) / ALIGN) * ALIGN;
    const x0 = Math.max(0, Math.floor((rect.x - pad) / ALIGN) * ALIGN);
    const y0 = Math.max(0, Math.floor((rect.y - pad) / ALIGN) * ALIGN);
    const region: Rect = {
      x: x0,
      y: y0,
      width: Math.min(W, rect.x + rect.width + pad) - x0,
      height: Math.min(H, rect.y + rect.height + pad) - y0,
    };
    const frame = new Frame(this.device, this.core.pool, 'detail');
    const opts = { scale: 1, canvasSize: [W, H] as [number, number], region, cache: null };
    const own = (res: { tex: GPUTexture; owned: boolean }): GPUTexture => {
      if (res.owned) return res.tex;
      // fremde Textur (z. B. Original): kopieren, damit der Ausschnitt unabhängig von Caches bleibt
      const copy = this.core.pool.acquire(res.tex.width, res.tex.height, 'detail');
      frame.encoder.copyTextureToTexture({ texture: res.tex }, { texture: copy }, [
        res.tex.width,
        res.tex.height,
      ]);
      return copy;
    };
    const after = own(
      this.compositor.render(frame, project, { ...opts, ignoreEffects: false, variant: 'detail' }),
    );
    const before = split
      ? own(
          this.compositor.render(frame, project, { ...opts, ignoreEffects: true, variant: 'detail-before' }),
        )
      : null;
    frame.submit();
    this.sources.endFrame();
    this.detail = { project, split, rect, region, after, before };
  }

  private dropDetail(): void {
    const d = this.detail;
    if (!d) return;
    this.core.pool.release(d.after);
    if (d.before) this.core.pool.release(d.before);
    this.detail = null;
  }

  /** Verwirft Vorschau-Caches (z. B. beim Projektwechsel). */
  resetPreview(): void {
    this.dropDetail();
    this.cache.clear();
    this.async.clear();
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
    // Worker-/Dienst-Effekte brauchen das ganze Bild: dann am Stück statt in Kacheln
    if (hasAsyncEffects(project)) tileSize = Math.max(W, H);
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

        const res = await this.renderResolved(project, {
          scale: 1,
          canvasSize: [W, H],
          region,
          ignoreEffects: false,
          cache: null,
          variant: 'export',
          final: true,
        });
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

  /**
   * Prüfwerte des Ergebnisses in voller Auflösung (für Tests): Anzahl nicht endlicher Werte (NaN/Inf) und Wertebereich
   * im linearen, vormultiplizierten Arbeitsformat. Ohne Kacheln; nur für kleine Testbilder gedacht.
   */
  async floatStats(project: Project): Promise<{ nonFinite: number; min: number; max: number }> {
    const { width: W, height: H } = project.canvas;
    const res = await this.renderResolved(project, {
      scale: 1,
      canvasSize: [W, H],
      region: { x: 0, y: 0, width: W, height: H },
      ignoreEffects: false,
      cache: null,
      variant: 'stats',
      final: true,
    });
    const data = await this.readFloat(res.tex);
    if (res.owned) this.core.pool.release(res.tex);
    let nonFinite = 0;
    let min = Infinity;
    let max = -Infinity;
    for (const v of data) {
      if (!Number.isFinite(v)) nonFinite++;
      else {
        if (v < min) min = v;
        if (v > max) max = v;
      }
    }
    return { nonFinite, min, max };
  }

  /** Liest eine Arbeitstextur (rgba16float) vollständig als Float32-Werte (RGBA je Pixel). */
  async readFloat(tex: GPUTexture): Promise<Float32Array> {
    const { width: W, height: H } = tex;
    const bytesPerRow = paddedBytesPerRow(W, 8);
    const buffer = this.device.createBuffer({
      size: bytesPerRow * H,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    const enc = this.device.createCommandEncoder({ label: 'read-float' });
    enc.copyTextureToBuffer({ texture: tex }, { buffer, bytesPerRow }, [W, H]);
    this.device.queue.submit([enc.finish()]);
    await buffer.mapAsync(GPUMapMode.READ);
    const half = new Uint16Array(buffer.getMappedRange());
    const out = new Float32Array(W * H * 4);
    const stride = bytesPerRow / 2;
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W * 4; x++) out[y * W * 4 + x] = halfToFloat(half[y * stride + x] ?? 0);
    buffer.unmap();
    buffer.destroy();
    return out;
  }

  /** Analysekarte einer Ebene in voller Leinwandauflösung (Tests, Fehlersuche). */
  async readMap(
    project: Project,
    layerId: string,
    kind: 'luminance' | 'edges',
  ): Promise<Float32Array | null> {
    const { width: W, height: H } = project.canvas;
    const frame = new Frame(this.device, this.core.pool, 'read-map');
    const res = this.compositor.overlay(frame, project, layerId, kind, {
      scale: 1,
      canvasSize: [W, H],
      region: { x: 0, y: 0, width: W, height: H },
      ignoreEffects: false,
      cache: null,
      variant: 'read-map',
    });
    frame.submit();
    this.sources.endFrame();
    if (!res) return null;
    const data = await this.readFloat(res.tex);
    if (res.owned) this.core.pool.release(res.tex);
    return data;
  }

  /**
   * Rendert, bis alle Worker-/Dienst-Effekte ihr Ergebnis haben (je verketteter Effekt ein Durchlauf).
   * Fehler oder Abbruch eines solchen Effekts brechen ab.
   */
  async renderResolved(
    project: Project,
    opts: Parameters<Compositor['render']>[2],
  ): Promise<RenderResultLike> {
    for (let pass = 0; ; pass++) {
      const frame = new Frame(this.device, this.core.pool, opts.variant);
      const res = this.compositor.render(frame, project, opts);
      const missing = [...this.compositor.missingAsync];
      frame.submit();
      this.sources.endFrame();
      if (missing.length === 0) return res;
      if (res.owned) this.core.pool.release(res.tex);
      if (pass >= 16) throw new Error('Zu viele verkettete Worker-/Dienst-Effekte.');
      await this.async.waitFor(missing);
      const failed = this.async.failures(missing);
      const first = failed[0];
      if (first) {
        for (const f of failed) this.async.retry(f.key);
        throw new Error(
          first.status === 'cancelled'
            ? `${first.label}: abgebrochen`
            : `${first.label}: ${first.error ?? 'fehlgeschlagen'}`,
        );
      }
    }
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

  /** Original verkleinert (lange Kante edge) als 8-Bit-sRGB – z. B. für die Palettengewinnung. */
  async originalImageData(originalId: string, edge = 256): Promise<ImageData | null> {
    if (!this.sources.has(originalId)) return null;
    const full = this.sources.original(originalId);
    const s = Math.min(1, edge / Math.max(full.width, full.height));
    const w = Math.max(1, Math.round(full.width * s));
    const h = Math.max(1, Math.round(full.height * s));
    const frame = new Frame(this.device, this.core.pool, 'original-small');
    const src = this.sources.at(frame, originalId, w, h);
    frame.submit();
    this.sources.endFrame();
    return new ImageData(await this.encode(src, [0, 0], w, h), w, h);
  }

  /** Live-Miniatur: ein Effekt mit Standardwerten (oder values) auf der ersten Ebene des Projekts. */
  async effectThumbnail(
    project: Project,
    plugin: Plugin,
    edge = 160,
    values: Record<string, ParamValue> = {},
  ): Promise<ImageData | null> {
    const layer = firstLayer(project);
    if (!layer || !plugin.manifest || plugin.status !== 'ok' || !this.runner.isCompiled(plugin)) return null;
    if (!this.sources.has(layer.originalId)) return null;
    // Ausschnitt aus der Bildmitte in Originalauflösung (Spec „Effekte“ 3.3): feine Effekte wirken wie im Export
    const full = this.sources.original(layer.originalId);
    const cw = Math.min(full.width, Math.round(edge * 1.5));
    const ch = Math.min(full.height, Math.round(cw * 0.75));
    const cx = Math.floor((full.width - cw) / 2);
    const cy = Math.floor((full.height - ch) / 2);
    const s = edge / Math.max(cw, ch * (4 / 3));
    const w = Math.max(1, Math.round(cw * s));
    const h = Math.max(1, Math.round(ch * s));
    const frame = new Frame(this.device, this.core.pool, 'thumbnail');
    const crop = this.core.pool.acquire(cw, ch, 'thumb-crop');
    frame.encoder.copyTextureToTexture({ texture: full, origin: [cx, cy] }, { texture: crop }, [cw, ch]);
    const src = this.core.pool.acquire(w, h, 'thumb-src');
    this.core.resample(frame, crop, src);
    // Analysekarten, falls der Effekt sie anfordert
    const need = plugin.manifest.requires;
    const temps: GPUTexture[] = [];
    let luminance: GPUTexture | undefined;
    let edges: GPUTexture | undefined;
    if (need.includes('luminance') || need.includes('edges')) {
      luminance = this.core.pool.acquire(w, h, 'thumb-luma');
      temps.push(luminance);
      this.core.luma(frame, src, luminance);
      if (need.includes('edges')) {
        edges = this.core.pool.acquire(w, h, 'thumb-edges');
        temps.push(edges);
        this.core.edgeMap(frame, luminance, s, edges);
      }
    }
    const out = this.runner.apply(
      frame,
      plugin,
      {
        instanceId: 'thumbnail',
        effectId: plugin.folder,
        effectVersion: plugin.manifest.version,
        enabled: true,
        strength: 1,
        params: { ...defaultParams(plugin.manifest), ...values },
        region: 'whole',
      },
      src,
      {
        mask: this.core.white,
        focus: this.core.black,
        depth: this.core.black,
        ...(luminance ? { luminance } : {}),
        ...(edges ? { edges } : {}),
      },
      {
        scale: s,
        origin: [cx * s, cy * s],
        canvasSize: [project.canvas.width * s, project.canvas.height * s],
      },
    );
    frame.submit();
    for (const t of temps) this.core.pool.release(t);
    this.core.pool.release(crop);
    this.core.pool.release(src);
    const pixels = await this.encode(out, [0, 0], w, h);
    this.core.pool.release(out);
    return new ImageData(pixels, w, h);
  }

  // ---------- Masken ----------

  /**
   * Verfeinert eine grobe Maske (z. B. 1024 px aus dem Modell) kantenbewusst auf die volle Größe des Originals
   * (Guided Filter mit dem Bild als Führung) und liefert sie als 16-Bit-Werte.
   */
  async refineMask(
    originalId: string,
    coarse: { data: Float32Array; width: number; height: number },
  ): Promise<{ data: Uint16Array; width: number; height: number }> {
    const image = this.sources.original(originalId);
    const { width, height } = image;
    const tmpId = `__coarse-${crypto.randomUUID()}`;
    const u16 = new Uint16Array(coarse.data.length);
    for (let i = 0; i < u16.length; i++)
      u16[i] = Math.round(Math.min(1, Math.max(0, coarse.data[i] ?? 0)) * 65535);
    this.sources.addMask(tmpId, coarse.width, coarse.height, u16);
    const coarseTex = this.sources.mask(tmpId);
    const out = this.core.pool.acquire(width, height, 'refined');
    const frame = new Frame(this.device, this.core.pool, 'refine-mask');
    const ratio = width / coarse.width;
    if (ratio <= 1.05) {
      this.core.loadMask(frame, coarseTex, out);
    } else {
      this.core.guidedUpscale(frame, image, coarseTex, out, Math.max(4, Math.round(2 * ratio + 2)), 1e-3);
    }
    frame.submit();
    const data = await this.readR16(out);
    this.core.pool.release(out);
    this.sources.retainOnlyMaskDrop(tmpId);
    return { data, width, height };
  }

  /** Liest den r-Kanal einer Arbeitstextur (rgba16float) als 16-Bit-Werte (0…65535). */
  async readR16(tex: GPUTexture): Promise<Uint16Array> {
    const { width, height } = tex;
    const bytesPerRow = paddedBytesPerRow(width, 8);
    const buffer = this.device.createBuffer({
      size: bytesPerRow * height,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    const enc = this.device.createCommandEncoder({ label: 'read-r16' });
    enc.copyTextureToBuffer({ texture: tex }, { buffer, bytesPerRow }, [width, height]);
    this.device.queue.submit([enc.finish()]);
    await buffer.mapAsync(GPUMapMode.READ);
    const src = new Uint16Array(buffer.getMappedRange());
    const out = new Uint16Array(width * height);
    const stride = bytesPerRow / 2;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        out[y * width + x] = Math.round(
          Math.min(1, Math.max(0, halfToFloat(src[y * stride + x * 4] ?? 0))) * 65535,
        );
      }
    }
    buffer.unmap();
    buffer.destroy();
    return out;
  }

  /**
   * Aufbereitete Maske einer Ebene in voller Auflösung als 8-Bit-Werte (für PSD-Ebenenmasken);
   * null bei Ebenen ohne Maske.
   */
  async layerMask(project: Project, layerId: string): Promise<Uint8Array | null> {
    const layer = findNode(project.root, layerId);
    if (layer?.kind !== 'layer' || layer.mask.kind === 'full') return null;
    const { width: W, height: H } = project.canvas;
    const frame = new Frame(this.device, this.core.pool, 'psd-mask');
    const tex = this.compositor.overlay(frame, project, layerId, 'mask', {
      scale: 1,
      canvasSize: [W, H],
      region: { x: 0, y: 0, width: W, height: H },
      ignoreEffects: false,
      cache: null,
      variant: 'psd',
    });
    frame.submit();
    this.sources.endFrame();
    if (!tex) return null;
    const u16 = await this.readR16(tex.tex);
    if (tex.owned) this.core.pool.release(tex.tex);
    const out = new Uint8Array(u16.length);
    for (let i = 0; i < u16.length; i++) out[i] = Math.round((u16[i] ?? 0) / 257);
    return out;
  }

  /** Rendert das Projekt in voller Auflösung am Stück als Arbeitstextur (z. B. Eingang einer Gruppenmaske). */
  async renderTexture(project: Project): Promise<{ tex: GPUTexture; owned: boolean }> {
    const { width: W, height: H } = project.canvas;
    return this.renderResolved(project, {
      scale: 1,
      canvasSize: [W, H],
      region: { x: 0, y: 0, width: W, height: H },
      ignoreEffects: false,
      cache: null,
      variant: 'psd',
      final: true,
    });
  }

  /**
   * Maske (Effekt- oder Gruppenmaske) in voller Auflösung als 8-Bit-Werte. hostLayerId: Ebene des Effekts;
   * inputProject: bei Gruppen das Projekt, dessen Ergebnis der Eingang ist (Kartenbereiche); null = keine Einschränkung.
   */
  async maskPixels(
    project: Project,
    mask: EffectMask,
    hostLayerId: string | null,
    input?: { project: Project; group: Group },
  ): Promise<Uint8Array | null> {
    const { width: W, height: H } = project.canvas;
    const inputTex = input ? await this.renderTexture(input.project) : null;
    const frame = new Frame(this.device, this.core.pool, 'psd-mask');
    const tex = this.compositor.maskTexture(
      frame,
      project,
      mask,
      hostLayerId,
      {
        scale: 1,
        canvasSize: [W, H],
        region: { x: 0, y: 0, width: W, height: H },
        ignoreEffects: false,
        cache: null,
        variant: 'psd',
        final: true,
      },
      inputTex && input ? { tex: inputTex.tex, group: input.group } : undefined,
    );
    frame.submit();
    this.sources.endFrame();
    if (inputTex?.owned) this.core.pool.release(inputTex.tex);
    if (!tex) return null;
    const u16 = await this.readR16(tex.tex);
    if (tex.owned) this.core.pool.release(tex.tex);
    const out = new Uint8Array(u16.length);
    for (let i = 0; i < u16.length; i++) out[i] = Math.round((u16[i] ?? 0) / 257);
    return out;
  }

  /** Miniaturen einzelner Knoten (Ebene bzw. zusammengesetzte Gruppe), unabhängig von der Sichtbarkeit. */
  async nodeThumbnails(project: Project, ids: string[], edge = 44): Promise<Map<string, ImageData>> {
    const out = new Map<string, ImageData>();
    const s = Math.min(1, edge / Math.max(project.canvas.width, project.canvas.height));
    const w = Math.max(1, Math.round(project.canvas.width * s));
    const h = Math.max(1, Math.round(project.canvas.height * s));
    for (const id of ids) {
      const node = findNode(project.root, id);
      if (!node) continue;
      const visible = { ...node, visible: true } as SceneNode;
      const root: Group =
        visible.kind === 'group'
          ? visible
          : {
              ...project.root,
              id: `thumb-${id}`,
              children: [visible],
              effects: [],
              opacity: 1,
              visible: true,
            };
      const frame = new Frame(this.device, this.core.pool, 'thumbnail');
      const res = this.compositor.render(
        frame,
        { ...project, root },
        {
          scale: s,
          canvasSize: [w, h],
          region: { x: 0, y: 0, width: w, height: h },
          ignoreEffects: false,
          cache: null,
          variant: 'thumb',
        },
      );
      frame.submit();
      this.sources.endFrame();
      const pixels = await this.encode(res.tex, [0, 0], w, h);
      if (res.owned) this.core.pool.release(res.tex);
      out.set(id, new ImageData(pixels, w, h));
    }
    return out;
  }
}

function halfToFloat(h: number): number {
  const e = (h >> 10) & 0x1f;
  const m = h & 0x3ff;
  const s = h & 0x8000 ? -1 : 1;
  if (e === 0) return s * 2 ** -14 * (m / 1024);
  if (e === 31) return m ? NaN : s * Infinity;
  return s * 2 ** (e - 15) * (1 + m / 1024);
}

type RenderResultLike = { tex: GPUTexture; key: string; owned: boolean };

/** Enthält das Projekt (sichtbare) Effekte, deren Endrender im Worker oder Dienst läuft? */
export function hasAsyncEffects(project: Project): boolean {
  for (const n of walk(project.root)) {
    if (!n.visible) continue;
    const lists = n.kind === 'layer' && n.shadow ? [n.effects, n.shadow.effects] : [n.effects];
    for (const list of lists)
      for (const fx of list) {
        const impl = getPlugin(fx.effectId)?.manifest?.implementations;
        if (fx.enabled && impl && (impl.final !== 'webgpu' || impl.preview !== 'webgpu')) return true;
      }
  }
  return false;
}
