// Hält die GPU-Objekte außerhalb des React-/Zustand-Zustands (nicht serialisierbar).

import { usePluginStore } from '../effects/pluginStore';
import { Engine } from './engine';
import { initGpu, type GpuInit } from './gpu';

let engine: Engine | null = null;
let initPromise: Promise<GpuInit> | null = null;

export function getEngine(): Engine | null {
  return engine;
}

/** Initialisiert WebGPU genau einmal (auch unter React StrictMode) und kompiliert die Plugins. */
export function initRuntime(onLost: (message: string) => void): Promise<GpuInit> {
  initPromise ??= initGpu(onLost).then((result) => {
    if (result.kind === 'webgpu') {
      const e = new Engine(result.device);
      engine = e;
      void e.compilePlugins();
      // Neue oder geänderte Plugins (HMR) kompilieren.
      usePluginStore.subscribe(() => void e.compilePlugins());
    }
    return result;
  });
  return initPromise;
}
