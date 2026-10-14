import type { renderPng, exportSettings } from '../../src/io/export';
import type { usePluginStore } from '../../src/effects/pluginStore';
import type { getEngine } from '../../src/render/runtime';
import type * as commands from '../../src/state/commands';
import type { getProject, useAppStore } from '../../src/state/store';

declare global {
  interface Window {
    __bls: {
      store: typeof useAppStore;
      plugins: typeof usePluginStore;
      commands: typeof commands;
      getProject: typeof getProject;
      getEngine: typeof getEngine;
      exportSettings: typeof exportSettings;
      renderPng: typeof renderPng;
    };
  }
}
