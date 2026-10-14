// Hält die GPU-Objekte außerhalb des React-/Zustand-Zustands (nicht serialisierbar).

import { initGpu, type GpuInit } from './gpu';
import { Renderer } from './renderer';

let renderer: Renderer | null = null;
let initPromise: Promise<GpuInit> | null = null;

export function getRenderer(): Renderer | null {
  return renderer;
}

/** Initialisiert WebGPU genau einmal (auch unter React StrictMode). */
export function initRuntime(onLost: (message: string) => void): Promise<GpuInit> {
  initPromise ??= initGpu(onLost).then((result) => {
    if (result.kind === 'webgpu') renderer = new Renderer(result.device);
    return result;
  });
  return initPromise;
}
