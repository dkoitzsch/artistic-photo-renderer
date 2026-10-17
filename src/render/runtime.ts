// Hält die GPU-Objekte außerhalb des React-/Zustand-Zustands (nicht serialisierbar).

import { usePluginStore } from '../effects/pluginStore';
import { useAppStore } from '../state/store';
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
      // Worker-/Dienst-Effekte: Job-Liste in den Store, bei neuen Ergebnissen Vorschau neu rendern
      e.async.licenseMode = () => useAppStore.getState().licenseMode;
      e.async.onChange = () => {
        const s = useAppStore.getState();
        s.setAsyncJobs(e.async.jobs());
        if (e.async.takeNewResults()) s.bumpRenderTick();
      };
      // Ausschnitt in voller Auflösung fertig → neu zeichnen
      e.onDetailReady = () => {
        useAppStore.getState().bumpRenderTick();
      };
      void e.compilePlugins();
      // Neue oder geänderte Plugins (HMR) kompilieren.
      usePluginStore.subscribe(() => void e.compilePlugins());
    }
    return result;
  });
  return initPromise;
}
