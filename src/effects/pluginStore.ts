import { create } from 'zustand';
import type { EffectModule } from './api';
import type { UniformLayout } from './layout';
import type { EffectManifest } from './manifest';

export type PluginStatus = 'pending' | 'ok' | 'error';

export type Plugin = {
  /** Ordnername = Effekt-ID */
  folder: string;
  manifest: EffectManifest | null;
  wgsl: string | null;
  layout: UniformLayout | null;
  /** effect.ts vorhanden → mehrstufig */
  hasScript: boolean;
  module: EffectModule | null;
  previewUrl: string | null;
  status: PluginStatus;
  errors: string[];
  /** steigt bei jedem (Neu-)Laden; macht Caches und Pipelines ungültig */
  revision: number;
};

type PluginState = {
  plugins: Record<string, Plugin>;
  setPlugins: (plugins: Record<string, Plugin>) => void;
  updatePlugin: (folder: string, patch: Partial<Plugin>) => void;
};

export const usePluginStore = create<PluginState>()((set) => ({
  plugins: {},
  setPlugins: (plugins) => set({ plugins }),
  updatePlugin: (folder, patch) =>
    set((s) => {
      const p = s.plugins[folder];
      return p ? { plugins: { ...s.plugins, [folder]: { ...p, ...patch } } } : s;
    }),
}));

export function getPlugin(id: string): Plugin | undefined {
  return usePluginStore.getState().plugins[id];
}
