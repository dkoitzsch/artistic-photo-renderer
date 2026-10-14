// WebGPU-Kern für Phase 0: ein Bild im linearen, vormultiplizierten Arbeitsraum,
// Anzeige mit Zoom/Pan und Export einer Bildregion als 8-Bit-sRGB.

import colorWgsl from './shaders/color.wgsl?raw';
import importWgsl from './shaders/import.wgsl?raw';
import encodeWgsl from './shaders/encode.wgsl?raw';
import viewWgsl from './shaders/view.wgsl?raw';
import { paddedBytesPerRow, unpadRows } from './readback';
import type { View } from '../state/viewMath';

/** Arbeitsformat aller Bild-Texturen: linear, vormultipliziert. */
export const WORK_FORMAT: GPUTextureFormat = 'rgba16float';

export type Rect = { x: number; y: number; width: number; height: number };

export type ViewColors = {
  /** alle Farben linear */
  background: [number, number, number];
  checkerA: [number, number, number];
  checkerB: [number, number, number];
};

const VIEW_UNIFORM_FLOATS = 20;

export class Renderer {
  private readonly importPipeline: GPUComputePipeline;
  private readonly encodePipeline: GPUComputePipeline;
  private readonly viewPipeline: GPURenderPipeline;
  private readonly viewUniforms: GPUBuffer;
  private readonly linearSampler: GPUSampler;
  private readonly nearestSampler: GPUSampler;
  private readonly placeholder: GPUTexture;

  private image: GPUTexture | null = null;
  private context: GPUCanvasContext | null = null;
  private viewBindGroups: { linear: GPUBindGroup; nearest: GPUBindGroup } | null = null;

  constructor(private readonly device: GPUDevice) {
    const compute = (code: string, label: string) =>
      device.createComputePipeline({
        label,
        layout: 'auto',
        compute: { module: device.createShaderModule({ label, code: colorWgsl + code }), entryPoint: 'main' },
      });
    this.importPipeline = compute(importWgsl, 'import');
    this.encodePipeline = compute(encodeWgsl, 'encode');

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
    this.viewUniforms = device.createBuffer({
      label: 'view-uniforms',
      size: VIEW_UNIFORM_FLOATS * 4,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.linearSampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
    this.nearestSampler = device.createSampler({ magFilter: 'nearest', minFilter: 'nearest' });
    this.placeholder = device.createTexture({
      size: [1, 1],
      format: WORK_FORMAT,
      usage: GPUTextureUsage.TEXTURE_BINDING,
    });
  }

  get imageSize(): { width: number; height: number } | null {
    return this.image ? { width: this.image.width, height: this.image.height } : null;
  }

  /** Lädt ein dekodiertes Bild (sRGB, gerades Alpha) in den Arbeitsraum. */
  setImage(bitmap: ImageBitmap): void {
    const { device } = this;
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
      label: 'image',
      size: [width, height],
      format: WORK_FORMAT,
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC,
    });
    this.runCompute(this.importPipeline, [staging.createView(), work.createView()], width, height);
    staging.destroy();

    this.image?.destroy();
    this.image = work;
    this.viewBindGroups = null;
  }

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

  /** Zeichnet die Leinwand. Die Canvas-Größe in Geräte-Pixeln muss bereits gesetzt sein. */
  drawView(view: View, dpr: number, colors: ViewColors): void {
    if (!this.context) return;
    const { device } = this;
    const size = this.imageSize;
    const u = new Float32Array(VIEW_UNIFORM_FLOATS);
    u.set([view.offsetX, view.offsetY, view.zoom, dpr]);
    u.set([size?.width ?? 1, size?.height ?? 1, size ? 1 : 0, 8], 4);
    u.set([...colors.background, 1], 8);
    u.set([...colors.checkerA, 1], 12);
    u.set([...colors.checkerB, 1], 16);
    device.queue.writeBuffer(this.viewUniforms, 0, u);

    const groups = this.getViewBindGroups();
    const encoder = device.createCommandEncoder({ label: 'view' });
    const pass = encoder.beginRenderPass({
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
    // Ab 200 % Pixel scharf darstellen, darunter bilinear.
    pass.setBindGroup(0, view.zoom >= 2 ? groups.nearest : groups.linear);
    pass.draw(3);
    pass.end();
    device.queue.submit([encoder.finish()]);
  }

  /**
   * Rendert eine Region der Komposition in voller Auflösung in eine neue Textur (Arbeitsformat).
   * Phase 0: genau ein Bild ohne Effekte. Ab Phase 1 rendert hier der Compositor (Export in Kacheln).
   */
  renderRegion(rect: Rect): GPUTexture {
    if (!this.image) throw new Error('Kein Bild geladen.');
    const target = this.device.createTexture({
      label: 'region',
      size: [rect.width, rect.height],
      format: WORK_FORMAT,
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    const encoder = this.device.createCommandEncoder({ label: 'render-region' });
    encoder.copyTextureToTexture({ texture: this.image, origin: [rect.x, rect.y] }, { texture: target }, [
      rect.width,
      rect.height,
    ]);
    this.device.queue.submit([encoder.finish()]);
    return target;
  }

  /** Kodiert eine Arbeitstextur zu 8-Bit-sRGB mit geradem Alpha (RGBA, zeilenweise). */
  async encodeToSrgb8(texture: GPUTexture): Promise<Uint8ClampedArray<ArrayBuffer>> {
    const { device } = this;
    const { width, height } = texture;
    const out = device.createTexture({
      label: 'encode-out',
      size: [width, height],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC,
    });
    this.runCompute(this.encodePipeline, [texture.createView(), out.createView()], width, height);

    const bytesPerRow = paddedBytesPerRow(width, 4);
    const buffer = device.createBuffer({
      label: 'readback',
      size: bytesPerRow * height,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    const encoder = device.createCommandEncoder({ label: 'readback' });
    encoder.copyTextureToBuffer({ texture: out }, { buffer, bytesPerRow }, [width, height]);
    device.queue.submit([encoder.finish()]);
    await buffer.mapAsync(GPUMapMode.READ);
    const pixels = unpadRows(new Uint8Array(buffer.getMappedRange()), width, height, 4);
    buffer.unmap();
    buffer.destroy();
    out.destroy();
    return pixels;
  }

  private getViewBindGroups(): { linear: GPUBindGroup; nearest: GPUBindGroup } {
    if (!this.viewBindGroups) {
      const layout = this.viewPipeline.getBindGroupLayout(0);
      const texView = (this.image ?? this.placeholder).createView();
      const make = (sampler: GPUSampler) =>
        this.device.createBindGroup({
          layout,
          entries: [
            { binding: 0, resource: { buffer: this.viewUniforms } },
            { binding: 1, resource: texView },
            { binding: 2, resource: sampler },
          ],
        });
      this.viewBindGroups = { linear: make(this.linearSampler), nearest: make(this.nearestSampler) };
    }
    return this.viewBindGroups;
  }

  private runCompute(
    pipeline: GPUComputePipeline,
    resources: GPUBindingResource[],
    width: number,
    height: number,
  ): void {
    const bindGroup = this.device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: resources.map((resource, binding) => ({ binding, resource })),
    });
    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(Math.ceil(width / 8), Math.ceil(height / 8));
    pass.end();
    this.device.queue.submit([encoder.finish()]);
  }
}
