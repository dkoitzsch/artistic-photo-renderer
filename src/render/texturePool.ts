// Wiederverwendbare Arbeitstexturen (rgba16float). Freigegebene Texturen dürfen im selben Frame
// erneut vergeben werden: WebGPU ordnet Pässe innerhalb eines Encoders sequenziell.

export const WORK_FORMAT: GPUTextureFormat = 'rgba16float';
export const WORK_USAGE =
  GPUTextureUsage.TEXTURE_BINDING |
  GPUTextureUsage.STORAGE_BINDING |
  GPUTextureUsage.COPY_SRC |
  GPUTextureUsage.COPY_DST;

const BYTES_PER_PIXEL = 8;

export class TexturePool {
  private readonly free = new Map<string, GPUTexture[]>();
  private freeBytes = 0;
  private live = 0;

  constructor(
    private readonly device: GPUDevice,
    /** Obergrenze für ungenutzte, vorgehaltene Texturen */
    private readonly maxFreeBytes = 768 * 1024 * 1024,
  ) {}

  acquire(width: number, height: number, label = 'work'): GPUTexture {
    const w = Math.max(1, Math.round(width));
    const h = Math.max(1, Math.round(height));
    const list = this.free.get(`${w}x${h}`);
    const tex = list?.pop();
    this.live++;
    if (tex) {
      this.freeBytes -= w * h * BYTES_PER_PIXEL;
      return tex;
    }
    return this.device.createTexture({ label, size: [w, h], format: WORK_FORMAT, usage: WORK_USAGE });
  }

  release(tex: GPUTexture): void {
    this.live--;
    const key = `${tex.width}x${tex.height}`;
    const list = this.free.get(key) ?? [];
    list.push(tex);
    this.free.set(key, list);
    this.freeBytes += tex.width * tex.height * BYTES_PER_PIXEL;
    if (this.freeBytes > this.maxFreeBytes) this.trim(this.maxFreeBytes / 2);
  }

  /** Zerstört ungenutzte Texturen, bis höchstens targetBytes vorgehalten werden. */
  trim(targetBytes = 0): void {
    for (const [key, list] of this.free) {
      while (list.length && this.freeBytes > targetBytes) {
        const t = list.pop();
        if (!t) break;
        this.freeBytes -= t.width * t.height * BYTES_PER_PIXEL;
        t.destroy();
      }
      if (!list.length) this.free.delete(key);
    }
  }

  stats(): { live: number; freeBytes: number } {
    return { live: this.live, freeBytes: this.freeBytes };
  }
}

/**
 * Ein Frame bündelt alle GPU-Befehle bis zum submit. Uniform-Puffer werden pro Pass neu angelegt
 * (writeBuffer wirkt vor dem submit, daher braucht jeder Pass seinen eigenen Puffer).
 */
export class Frame {
  readonly encoder: GPUCommandEncoder;
  private readonly buffers: GPUBuffer[] = [];

  constructor(
    readonly device: GPUDevice,
    readonly pool: TexturePool,
    label = 'frame',
  ) {
    this.encoder = device.createCommandEncoder({ label });
  }

  uniform(data: ArrayBuffer | ArrayBufferView<ArrayBuffer>): GPUBuffer {
    const size = Math.max(16, Math.ceil(data.byteLength / 16) * 16);
    const buf = this.device.createBuffer({ size, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.device.queue.writeBuffer(buf, 0, data);
    this.buffers.push(buf);
    return buf;
  }

  submit(): void {
    this.device.queue.submit([this.encoder.finish()]);
    for (const b of this.buffers) b.destroy();
    this.buffers.length = 0;
  }
}

export function dispatch2d(
  frame: Frame,
  pipeline: GPUComputePipeline,
  bindGroup: GPUBindGroup,
  width: number,
  height: number,
  label?: string,
): void {
  const pass = frame.encoder.beginComputePass(label ? { label } : undefined);
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bindGroup);
  pass.dispatchWorkgroups(Math.ceil(width / 8), Math.ceil(height / 8));
  pass.end();
}
