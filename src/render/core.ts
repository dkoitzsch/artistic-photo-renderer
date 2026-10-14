// Kern-Pipelines (unabhängig von Plugins) und gemeinsam genutzte Hilfsobjekte.

import blendWgsl from './shaders/blend.wgsl?raw';
import colorWgsl from './shaders/color.wgsl?raw';
import encodeWgsl from './shaders/encode.wgsl?raw';
import fillWgsl from './shaders/fill.wgsl?raw';
import importWgsl from './shaders/import.wgsl?raw';
import mixWgsl from './shaders/mix.wgsl?raw';
import resampleWgsl from './shaders/resample.wgsl?raw';
import { dispatch2d, Frame, TexturePool, WORK_FORMAT } from './texturePool';

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
    this.mixPipeline = compute(mixWgsl, 'mix');
    this.blendPipeline = compute(blendWgsl, 'blend');
    this.fillPipeline = compute(fillWgsl, 'fill');
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

  /** dst = mix(base, fx, weight · Regionsgewicht) */
  mix(
    frame: Frame,
    base: GPUTexture,
    fx: GPUTexture,
    focus: GPUTexture,
    dst: GPUTexture,
    weight: number,
    region: number,
  ): void {
    const u = new ArrayBuffer(16);
    new Float32Array(u, 0, 1)[0] = weight;
    new Uint32Array(u, 4, 1)[0] = region;
    const bg = this.bind(this.mixPipeline, [
      { buffer: frame.uniform(u) },
      base.createView(),
      fx.createView(),
      focus.createView(),
      dst.createView(),
    ]);
    dispatch2d(frame, this.mixPipeline, bg, dst.width, dst.height, 'mix');
  }

  /** dst = layer · opacity über base (normal, vormultipliziert); base null = transparent */
  blend(frame: Frame, base: GPUTexture | null, layer: GPUTexture, dst: GPUTexture, opacity: number): void {
    const u = new ArrayBuffer(16);
    new Float32Array(u, 0, 1)[0] = opacity;
    new Uint32Array(u, 4, 2).set([0, base ? 1 : 0]);
    const bg = this.bind(this.blendPipeline, [
      { buffer: frame.uniform(u) },
      (base ?? layer).createView(),
      layer.createView(),
      dst.createView(),
    ]);
    dispatch2d(frame, this.blendPipeline, bg, dst.width, dst.height, 'blend');
  }

  bindCompute(pipeline: GPUComputePipeline, resources: GPUBindingResource[]): GPUBindGroup {
    return this.bind(pipeline, resources);
  }
}
