// Nur im Dev-Server: Zugriff für Tests und Fehlersuche über window.__bls.

import { exportSettings, renderPng } from './io/export';
import { usePluginStore } from './effects/pluginStore';
import { getEngine } from './render/runtime';
import * as commands from './state/commands';
import { getProject, useAppStore } from './state/store';

export function installDebugApi(): void {
  (window as unknown as { __bls: unknown }).__bls = {
    store: useAppStore,
    plugins: usePluginStore,
    commands,
    getProject,
    getEngine,
    exportSettings,
    renderPng,
  };
}
