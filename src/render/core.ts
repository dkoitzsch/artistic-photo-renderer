// Kern-Pipelines (unabhängig von Plugins) und gemeinsam genutzte Hilfsobjekte.

import type { BlendMode, MaskEdge } from '../state/project';
import blendWgsl from './shaders/blend.wgsl?raw';
import blendModesWgsl from './shaders/blendmodes.wgsl?raw';
import colorWgsl from './shaders/color.wgsl?raw';
import encodeWgsl from './shaders/encode.wgsl?raw';
import fillWgsl from './shaders/fill.wgsl?raw';
import focusmapWgsl from './shaders/focusmap.wgsl?raw';
import gaussWgsl from './shaders/gauss.wgsl?raw';
import guidedWgsl from './shaders/guided.wgsl?raw';
import importWgsl from './shaders/import.wgsl?raw';
import maskapplyWgsl from './shaders/maskapply.wgsl?raw';
import maskopsWgsl from './shaders/maskops.wgsl?raw';
import mixWgsl from './shaders/mix.wgsl?raw';
import pushpullWgsl from './shaders/pushpull.wgsl?raw';
import resampleWgsl from './shaders/resample.wgsl?raw';
import warpWgsl from './shaders/warp.wgsl?raw';
import type { Affine } from '../state/transform';
import { dispatch2d, Frame, TexturePool, WORK_FORMAT } from './texturePool';

export const BLEND_MODE_INDEX: Record<BlendMode, number> = {
  normal: 0,
  multiply: 1,
  screen: 2,
  overlay: 3,
  'soft-light': 4,
  lighten: 5,
  darken: 6,
  difference: 7,
};

export type EdgeMode = 'mirror' | 'clamp' | 'transparent';
const EDGE_INDEX: Record<EdgeMode, number> = { mirror: 0, clamp: 1, transparent: 2 };

/** Höchstens so viele Fokuspunkte pro Ebene (Größe des Uniform-Arrays in focusmap.wgsl). */
export const MAX_FOCUS_POINTS = 64;

type Slot = 'uniform' | 'tex' | 'sampler' | 'storage';

/** Mehrere Einstiegspunkte eines Moduls mit gemeinsamem, explizitem Bindungslayout. */
class ModulePipelines {
  readonly layout: GPUBindGroupLayout;
  private readonly pipelines = new Map<string, GPUComputePipeline>();

  constructor(device: GPUDevice, label: string, code: string, slots: Slot[], entries: string[]) {
    this.layout = device.createBindGroupLayout({
      label,
      entries: slots.map((slot, binding): GPUBindGroupLayoutEntry => {
        const base = { binding, visibility: GPUShaderStage.COMPUTE };
        switch (slot) {
          case 'uniform':
            return { ...base, buffer: { type: 'uniform' } };
          case 'tex':
            return { ...base, texture: { sampleType: 'float' } };
          case 'sampler':
            return { ...base, sampler: { type: 'filtering' } };
          case 'storage':
            return { ...base, storageTexture: { access: 'write-only', format: WORK_FORMAT } };
        }
      }),
    });
    const module = device.createShaderModule({ label, code: colorWgsl + code });
    const layout = device.createPipelineLayout({ bindGroupLayouts: [this.layout] });
    for (const entryPoint of entries)
      this.pipelines.set(
        entryPoint,
        device.createComputePipeline({
          label: `${label}:${entryPoint}`,
          layout,
          compute: { module, entryPoint },
        }),
      );
  }

  run(frame: Frame, entry: string, resources: GPUBindingResource[], width: number, height: number): void {
    const pipeline = this.pipelines.get(entry);
    if (!pipeline) throw new Error(`Einstiegspunkt ${entry} fehlt`);
    const bg = frame.device.createBindGroup({
      layout: this.layout,
      entries: resources.map((resource, binding) => ({ binding, resource })),
    });
    dispatch2d(frame, pipeline, bg, width, height, entry);
  }
}

export class GpuCore {
  readonly pool: TexturePool;
  readonly linearSampler: GPUSampler;
  /** 1 × 1-Standardtexturen für fehlende Eingänge */
  readonly white: GPUTexture;
  readonly black: GPUTexture;

  readonly importPipeline: GPUComputePipeline;
  readonly encodePipeline: GPUComputePipeline;
  private readonly resamplePipeline: GPUComputePipeline;
  private readonly mixPipeline: GPUComputePipeline;
  private readonly blendPipeline: GPUComputePipeline;
  private readonly fillPipeline: GPUComputePipeline;
  private readonly focusPipeline: GPUComputePipeline;
  private readonly maskApplyPipeline: GPUComputePipeline;
  private readonly gauss: ModulePipelines;
  private readonly maskOps: ModulePipelines;
  private readonly guided: ModulePipelines;
  private readonly pushPull: ModulePipelines;
  private readonly warpPipelines: ModulePipelines;

  constructor(readonly device: GPUDevice) {
    this.pool = new TexturePool(device);
    const compute = (code: string, label: string) =>
      device.createComputePipeline({
        label,
        layout: 'auto',
        compute: { module: device.createShaderModule({ label, code: colorWgsl + code }), entryPoint: 'main' },
      });
    this.importPipeline = compute(importWgsl, 'import');
    this.encodePipeline = compute(encodeWgsl, 'encode');
    this.resamplePipeline = compute(resampleWgsl, 'resample');
    this.mixPipeline = compute(blendModesWgsl + mixWgsl, 'mix');
    this.blendPipeline = compute(blendModesWgsl + blendWgsl, 'blend');
    this.fillPipeline = compute(fillWgsl, 'fill');
    this.focusPipeline = compute(focusmapWgsl, 'focusmap');
    this.maskApplyPipeline = compute(maskapplyWgsl, 'maskapply');
    this.gauss = new ModulePipelines(
      device,
      'gauss',
      gaussWgsl,
      ['uniform', 'tex', 'sampler', 'storage'],
      ['down', 'blur', 'up', 'copy'],
    );
    this.maskOps = new ModulePipelines(
      device,
      'maskops',
      maskopsWgsl,
      ['uniform', 'tex', 'storage'],
      ['load', 'minmax', 'threshold', 'curve', 'band', 'luma'],
    );
    this.guided = new ModulePipelines(
      device,
      'guided',
      guidedWgsl,
      ['uniform', 'tex', 'tex', 'sampler', 'storage'],
      ['pack', 'box', 'coeffs', 'apply'],
    );
    this.pushPull = new ModulePipelines(
      device,
      'pushpull',
      pushpullWgsl,
      ['uniform', 'tex', 'tex', 'sampler', 'storage'],
      ['init', 'down', 'pull', 'finish'],
    );
    this.warpPipelines = new ModulePipelines(
      device,
      'warp',
      warpWgsl,
      ['uniform', 'tex', 'sampler', 'storage'],
      ['main'],
    );
    this.linearSampler = device.createSampler({
      magFilter: 'linear',
      minFilter: 'linear',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
    });
    this.white = this.constant([1, 1, 1, 1]);
    this.black = this.constant([0, 0, 0, 0]);
  }

  private constant(rgba: number[]): GPUTexture {
    const t = this.device.createTexture({
      size: [1, 1],
      format: WORK_FORMAT,
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING,
    });
    const frame = new Frame(this.device, this.pool, 'constant');
    this.fill(frame, t, rgba);
    frame.submit();
    return t;
  }

  private bind(pipeline: GPUComputePipeline, resources: GPUBindingResource[]): GPUBindGroup {
    return this.device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: resources.map((resource, binding) => ({ binding, resource })),
    });
  }

  fill(frame: Frame, dst: GPUTexture, rgba: number[]): void {
    const bg = this.bind(this.fillPipeline, [
      { buffer: frame.uniform(new Float32Array(rgba)) },
      dst.createView(),
    ]);
    dispatch2d(frame, this.fillPipeline, bg, dst.width, dst.height, 'fill');
  }

  resample(frame: Frame, src: GPUTexture, dst: GPUTexture): void {
    const bg = this.bind(this.resamplePipeline, [src.createView(), dst.createView()]);
    dispatch2d(frame, this.resamplePipeline, bg, dst.width, dst.height, 'resample');
  }

  /**
   * dst = mix(base, B(base, fx), weight · Regionsgewicht · Effektmaske); B = Mischmodus (normal: fx ersetzt base).
   * mask: Effektmaske (r) oder null.
   */
  mix(
    frame: Frame,
    base: GPUTexture,
    fx: GPUTexture,
    focus: GPUTexture,
    dst: GPUTexture,
    weight: number,
    region: number,
    mode: BlendMode = 'normal',
    mask: GPUTexture | null = null,
  ): void {
    const u = new ArrayBuffer(16);
    new Float32Array(u, 0, 1)[0] = weight;
    new Uint32Array(u, 4, 3).set([region, BLEND_MODE_INDEX[mode], mask ? 1 : 0]);
    const bg = this.bind(this.mixPipeline, [
      { buffer: frame.uniform(u) },
      base.createView(),
      fx.createView(),
      focus.createView(),
      dst.createView(),
      (mask ?? this.white).createView(),
    ]);
    dispatch2d(frame, this.mixPipeline, bg, dst.width, dst.height, 'mix');
  }

  /** dst = layer · opacity über base mit Mischmodus; base null = transparent */
  blend(
    frame: Frame,
    base: GPUTexture | null,
    layer: GPUTexture,
    dst: GPUTexture,
    opacity: number,
    mode: BlendMode = 'normal',
    offset: [number, number] = [0, 0],
  ): void {
    const u = new ArrayBuffer(32);
    new Float32Array(u, 0, 1)[0] = opacity;
    new Uint32Array(u, 4, 2).set([BLEND_MODE_INDEX[mode], base ? 1 : 0]);
    new Float32Array(u, 16, 2).set(offset);
    const bg = this.bind(this.blendPipeline, [
      { buffer: frame.uniform(u) },
      (base ?? layer).createView(),
      layer.createView(),
      dst.createView(),
    ]);
    dispatch2d(frame, this.blendPipeline, bg, dst.width, dst.height, 'blend');
  }

  /**
   * Platziert src per affiner Abbildung in dst. toLocal: Render-px (Leinwand) → Texel von src;
   * origin: Lage von dst auf der Leinwand in Render-px. Außerhalb von src transparent.
   */
  warp(frame: Frame, src: GPUTexture, dst: GPUTexture, toLocal: Affine, origin: [number, number]): void {
    const u = new Float32Array([
      toLocal.a,
      toLocal.b,
      toLocal.c,
      toLocal.d,
      toLocal.e,
      toLocal.f,
      origin[0],
      origin[1],
      src.width,
      src.height,
      0,
      0,
    ]);
    this.warpPipelines.run(
      frame,
      'main',
      [{ buffer: frame.uniform(u) }, src.createView(), this.linearSampler, dst.createView()],
      dst.width,
      dst.height,
    );
  }

  /** dst = src · mask.r */
  maskApply(frame: Frame, src: GPUTexture, mask: GPUTexture, dst: GPUTexture): void {
    const bg = this.bind(this.maskApplyPipeline, [src.createView(), mask.createView(), dst.createView()]);
    dispatch2d(frame, this.maskApplyPipeline, bg, dst.width, dst.height, 'maskapply');
  }

  bindCompute(pipeline: GPUComputePipeline, resources: GPUBindingResource[]): GPUBindGroup {
    return this.bind(pipeline, resources);
  }

  // ---------- Gauß ----------

  private gaussUniform(
    frame: Frame,
    dir: [number, number],
    sigma: number,
    edge: number,
    factor: number,
  ): GPUBuffer {
    const u = new ArrayBuffer(32);
    new Float32Array(u, 0, 3).set([dir[0], dir[1], sigma]);
    new Uint32Array(u, 12, 1)[0] = edge;
    new Float32Array(u, 16, 1)[0] = factor;
    return frame.uniform(u);
  }

  /**
   * Gauß-Unschärfe (σ = Radius / 3) mit Pyramide für große Radien; dst hat die Größe von src.
   * Temporäre Texturen kommen aus dem Pool und werden sofort zurückgegeben.
   */
  gaussian(frame: Frame, src: GPUTexture, dst: GPUTexture, radius: number, edge: EdgeMode = 'mirror'): void {
    const sigma = radius / 3;
    const e = EDGE_INDEX[edge];
    const run = (entry: string, a: GPUTexture, b: GPUTexture, u: GPUBuffer) =>
      this.gauss.run(
        frame,
        entry,
        [{ buffer: u }, a.createView(), this.linearSampler, b.createView()],
        b.width,
        b.height,
      );
    if (sigma < 0.25) {
      run('copy', src, dst, this.gaussUniform(frame, [0, 0], 1, e, 1));
      return;
    }
    let levels = 0;
    while (sigma / 2 ** levels > 6 && levels < 12) levels++;
    const f = 2 ** levels;
    const boxVariance = (f * f - 1) / 12;
    const upVariance = levels > 0 ? (f * f) / 6 : 0;
    const levelSigma = Math.sqrt(Math.max(0.0625 * f * f, sigma * sigma - boxVariance - upVariance)) / f;
    const temps: GPUTexture[] = [];
    const temp = (w: number, h: number) => {
      const t = this.pool.acquire(w, h, 'gauss');
      temps.push(t);
      return t;
    };
    let cur = src;
    let w = src.width;
    let h = src.height;
    for (let i = 0; i < levels; i++) {
      w = Math.ceil(w / 2);
      h = Math.ceil(h / 2);
      const next = temp(w, h);
      run('down', cur, next, this.gaussUniform(frame, [0, 0], 1, e, 1));
      cur = next;
    }
    const tmp = temp(w, h);
    run('blur', cur, tmp, this.gaussUniform(frame, [1, 0], levelSigma, e, 1));
    const blurred = levels === 0 ? dst : temp(w, h);
    run('blur', tmp, blurred, this.gaussUniform(frame, [0, 1], levelSigma, e, 1));
    if (levels > 0) run('up', blurred, dst, this.gaussUniform(frame, [0, 0], 1, e, f));
    for (const t of temps) this.pool.release(t);
  }

  // ---------- Masken ----------

  private maskUniform(
    frame: Frame,
    o: { dir?: [number, number]; radius?: number; mode?: number; invert?: boolean; curve?: number },
  ): GPUBuffer {
    const u = new ArrayBuffer(32);
    new Float32Array(u, 0, 3).set([o.dir?.[0] ?? 0, o.dir?.[1] ?? 0, o.radius ?? 0]);
    new Uint32Array(u, 12, 3).set([o.mode ?? 0, o.invert ? 1 : 0, o.curve ?? 0]);
    return frame.uniform(u);
  }

  private maskRun(frame: Frame, entry: string, src: GPUTexture, dst: GPUTexture, u: GPUBuffer): void {
    this.maskOps.run(
      frame,
      entry,
      [{ buffer: u }, src.createView(), dst.createView()],
      dst.width,
      dst.height,
    );
  }

  /**
   * Bereitet eine gespeicherte Maske für eine Ebene auf: auf Zielgröße skalieren, ggf. invertieren,
   * Kantenversatz (Min/Max), Kantenhärte (Schwelle bzw. Gauß bis 150 px) und Verlaufskurve.
   * pxScale: Render-px pro Leinwand-px. dst: Arbeitstextur (r = Maskenwert).
   */
  processMask(
    frame: Frame,
    mask: GPUTexture,
    invert: boolean,
    edge: MaskEdge,
    pxScale: number,
    dst: GPUTexture,
  ): void {
    const { width, height } = dst;
    const a = this.pool.acquire(width, height, 'mask-a');
    const b = this.pool.acquire(width, height, 'mask-b');
    this.maskRun(frame, 'load', mask, a, this.maskUniform(frame, { invert }));
    let cur = a;
    let other = b;
    const swap = () => {
      [cur, other] = [other, cur];
    };
    const offset = edge.offset * pxScale;
    if (Math.abs(offset) >= 0.05) {
      const mode = offset > 0 ? 0 : 1;
      const radius = Math.abs(offset);
      this.maskRun(frame, 'minmax', cur, other, this.maskUniform(frame, { dir: [1, 0], radius, mode }));
      swap();
      this.maskRun(frame, 'minmax', cur, other, this.maskUniform(frame, { dir: [0, 1], radius, mode }));
      swap();
    }
    if (edge.hardness <= 0) {
      this.maskRun(frame, 'threshold', cur, other, this.maskUniform(frame, {}));
      swap();
    } else {
      // 0 … 100 → 0 … 150 px Weichzeichnung, quadratisch (feine Kontrolle bei kleinen Werten)
      const blurPx = 150 * (edge.hardness / 100) ** 2 * pxScale;
      if (blurPx >= 0.3) {
        this.gaussian(frame, cur, other, blurPx, 'clamp');
        swap();
      }
    }
    const curveIndex = { linear: 0, smooth: 1, steep: 2 }[edge.curve];
    this.maskRun(frame, 'curve', cur, dst, this.maskUniform(frame, { curve: curveIndex }));
    this.pool.release(a);
    this.pool.release(b);
  }

  /**
   * Tiefenband als Maske: [near, far] aus der Tiefenkarte, um overlap px erweitert und weich auslaufend.
   * Ergebnis (r) in Größe von dst.
   */
  depthBand(
    frame: Frame,
    depth: GPUTexture,
    near: number,
    far: number,
    overlapPx: number,
    dst: GPUTexture,
  ): void {
    const { width, height } = dst;
    const a = this.pool.acquire(width, height, 'band-a');
    this.maskRun(frame, 'band', depth, a, this.maskUniform(frame, { dir: [near, far], radius: 0.004 }));
    if (overlapPx >= 0.5) {
      const b = this.pool.acquire(width, height, 'band-b');
      this.dilateMask(frame, a, b, overlapPx);
      this.gaussian(frame, b, dst, overlapPx, 'clamp');
      this.pool.release(b);
    } else {
      this.maskRun(frame, 'curve', a, dst, this.maskUniform(frame, {}));
    }
    this.pool.release(a);
  }

  /**
   * Wertebereich einer Karte (r, 0…1) als Maske: 1 in [from, to], weicher Rand ±feather, optional umgekehrt.
   * from ≤ 0 bzw. to ≥ 1: keine untere/obere Kante. Karte wird bilinear auf dst skaliert.
   */
  mapRange(
    frame: Frame,
    map: GPUTexture,
    from: number,
    to: number,
    feather: number,
    invert: boolean,
    dst: GPUTexture,
  ): void {
    this.maskRun(
      frame,
      'band',
      map,
      dst,
      this.maskUniform(frame, { dir: [from, to], radius: feather, invert }),
    );
  }

  /** Helligkeit (wahrgenommen, 0…1) eines Bildes; dst gleich groß wie src. */
  luma(frame: Frame, src: GPUTexture, dst: GPUTexture): void {
    this.maskRun(frame, 'luma', src, dst, this.maskUniform(frame, {}));
  }

  /** Erweitert eine Maske (r) um radius px (Max-Filter). */
  dilateMask(frame: Frame, src: GPUTexture, dst: GPUTexture, radius: number): void {
    const tmp = this.pool.acquire(dst.width, dst.height, 'dilate');
    this.maskRun(frame, 'minmax', src, tmp, this.maskUniform(frame, { dir: [1, 0], radius, mode: 0 }));
    this.maskRun(frame, 'minmax', tmp, dst, this.maskUniform(frame, { dir: [0, 1], radius, mode: 0 }));
    this.pool.release(tmp);
  }

  /** Skaliert eine Maske beliebiger Größe bilinear auf dst (r-Kanal). */
  loadMask(frame: Frame, mask: GPUTexture, dst: GPUTexture, invert = false): void {
    this.maskRun(frame, 'load', mask, dst, this.maskUniform(frame, { invert }));
  }

  /**
   * Kantenbewusstes Hochskalieren einer groben Maske (beliebige Größe) auf die Größe von image (Guided Filter).
   */
  guidedUpscale(
    frame: Frame,
    image: GPUTexture,
    coarse: GPUTexture,
    dst: GPUTexture,
    radius: number,
    eps: number,
  ): void {
    const { width, height } = dst;
    const uniform = (dir: [number, number]) => frame.uniform(new Float32Array([dir[0], dir[1], radius, eps]));
    const run = (
      entry: string,
      a: GPUTexture,
      b: GPUTexture,
      out: GPUTexture,
      dir: [number, number] = [0, 0],
    ) =>
      this.guided.run(
        frame,
        entry,
        [{ buffer: uniform(dir) }, a.createView(), b.createView(), this.linearSampler, out.createView()],
        width,
        height,
      );
    const t1 = this.pool.acquire(width, height, 'gf1');
    const t2 = this.pool.acquire(width, height, 'gf2');
    run('pack', image, coarse, t1);
    run('box', t1, t1, t2, [1, 0]);
    run('box', t2, t2, t1, [0, 1]);
    run('coeffs', t1, t1, t2);
    run('box', t2, t2, t1, [1, 0]);
    run('box', t1, t1, t2, [0, 1]);
    run('apply', t2, image, dst);
    this.pool.release(t1);
    this.pool.release(t2);
  }

  /**
   * Lochfüllung (Push-Pull): füllt die Bereiche, in denen hole.r > 0 ist, aus der Umgebung auf.
   * Ergebnis ist deckend; außerhalb des Lochs bleibt das Bild unverändert.
   */
  holeFill(frame: Frame, image: GPUTexture, hole: GPUTexture, dst: GPUTexture): void {
    const temps: GPUTexture[] = [];
    const temp = (w: number, h: number) => {
      const t = this.pool.acquire(w, h, 'pushpull');
      temps.push(t);
      return t;
    };
    const run = (entry: string, a: GPUTexture, b: GPUTexture, out: GPUTexture, factor = 1) =>
      this.pushPull.run(
        frame,
        entry,
        [
          { buffer: frame.uniform(new Float32Array([factor, 0, 0, 0])) },
          a.createView(),
          b.createView(),
          this.linearSampler,
          out.createView(),
        ],
        out.width,
        out.height,
      );
    const levels: GPUTexture[] = [temp(image.width, image.height)];
    const first = levels[0];
    if (!first) return;
    run('init', image, hole, first);
    let w = image.width;
    let h = image.height;
    while (w > 1 || h > 1) {
      w = Math.max(1, Math.ceil(w / 2));
      h = Math.max(1, Math.ceil(h / 2));
      const next = temp(w, h);
      const prev = levels[levels.length - 1];
      if (!prev) break;
      run('down', prev, prev, next);
      levels.push(next);
    }
    // Pull: von grob nach fein
    let coarse = levels[levels.length - 1];
    for (let i = levels.length - 2; i >= 0 && coarse; i--) {
      const fine = levels[i];
      if (!fine) break;
      const out = temp(fine.width, fine.height);
      run('pull', fine, coarse, out, fine.width / coarse.width);
      coarse = out;
    }
    if (coarse) run('finish', coarse, coarse, dst);
    for (const t of temps) this.pool.release(t);
  }

  // ---------- Fokuskarte ----------

  /** Zeichnet die Fokuskarte (r: 1 = scharf) für einen Ausschnitt. points in Leinwand-px. */
  focusMap(
    frame: Frame,
    points: { x: number; y: number; radius: number; enabled: boolean }[],
    dst: GPUTexture,
    origin: [number, number],
    scale: number,
  ): void {
    const u = new ArrayBuffer(16 + MAX_FOCUS_POINTS * 16);
    const f = new Float32Array(u);
    f.set([origin[0], origin[1], scale]);
    const list = points.slice(0, MAX_FOCUS_POINTS);
    new Uint32Array(u, 12, 1)[0] = list.length;
    list.forEach((p, i) => {
      f.set([p.x, p.y, p.radius, p.enabled ? 1 : 0], 4 + i * 4);
    });
    const bg = this.bind(this.focusPipeline, [{ buffer: frame.uniform(u) }, dst.createView()]);
    dispatch2d(frame, this.focusPipeline, bg, dst.width, dst.height, 'focusmap');
  }
}
