import type { renderPng, exportSettings } from '../../src/io/export';
import type { usePluginStore } from '../../src/effects/pluginStore';
import type { getEngine } from '../../src/render/runtime';
import type * as commands from '../../src/state/commands';
import type { getProject, useAppStore } from '../../src/state/store';
import type { detectLandmarks } from '../../src/ml/backend';
import type { browserDepth } from '../../src/ml/browserBackend';
import type { modelById } from '../../src/ml/registry';
import type * as split from '../../src/ml/split';

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
      ml: {
        detectLandmarks: typeof detectLandmarks;
        split: typeof split;
        splitWithMask: (layerId: string, data: Uint16Array, width: number, height: number) => Promise<string>;
        browserDepth: typeof browserDepth;
        modelById: typeof modelById;
      };
    };
  }
}
