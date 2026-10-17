import { useEffect } from 'react';
import { startAutosave } from '../io/autosave';
import { loadPresets } from '../presets/store';
import { startServiceMonitor } from '../ml/backend';
import { browserDownload } from '../ml/browserBackend';
import { openStoredProject } from '../io/import';
import { rememberedProjectId, startSessionMemory } from '../io/session';
import { listProjects } from '../io/storage';
import { initRuntime } from '../render/runtime';
import { useAppStore } from '../state/store';
import { BottomPanel } from './components/BottomPanel';
import { CanvasView } from './components/CanvasView';
import { ExportDialog, ExportWarningDialog, SettingsDialog, SplitDialog } from './components/Dialogs';
import { EffectBrowser } from './components/EffectBrowser';
import { ModelsDialog } from './components/ModelsDialog';
import { ProjectOverview } from './components/ProjectOverview';
import { SidePanel } from './components/SidePanel';
import { ToolBar } from './components/ToolBar';
import { TopBar } from './components/TopBar';
import { useShortcuts } from './shortcuts';
import { useApplyTheme } from './theme/theme';

let started: Promise<void> | null = null;

/** Einmalige Initialisierung (auch unter React StrictMode nur einmal). */
function startup(): Promise<void> {
  started ??= (async () => {
    const { setGpu, setScreen } = useAppStore.getState();
    const remembered = rememberedProjectId();
    const result = await initRuntime((reason) => {
      setGpu({ state: 'lost', reason });
    });
    if (result.kind === 'webgpu') {
      setGpu({ state: 'ready', info: result.info, maxTextureSize: result.limits.maxTextureDimension2D });
      // Zustand der Browser-Modelle aus dem lokalen Speicher lesen (für die Modell-Übersicht)
      void browserDownload('scan').catch(() => undefined);
      // Nach einem Neuladen des Tabs das zuletzt offene Projekt wieder öffnen.
      if (remembered && (await openStoredProject(remembered))) return;
    } else {
      setGpu({ state: 'unavailable', webgl2: result.kind === 'webgl2', reason: result.reason });
    }
    // Sonst Projektübersicht, wenn es gespeicherte Projekte gibt.
    const list = await listProjects().catch(() => []);
    if (list.length > 0 && !useAppStore.getState().history) setScreen('overview');
  })();
  return started;
}

export function App() {
  const theme = useApplyTheme();
  const screen = useAppStore((s) => s.screen);
  useShortcuts();

  useEffect(() => {
    void startup();
    void loadPresets().then((err) => {
      if (err) useAppStore.getState().notify('error', err);
    });
    const stopSession = startSessionMemory();
    const stopMonitor = startServiceMonitor();
    const stopAutosave = startAutosave();
    return () => {
      stopSession();
      stopAutosave();
      stopMonitor();
    };
  }, []);

  return (
    <div className="app">
      <TopBar theme={theme} />
      <div className="workspace">
        <ToolBar />
        <CanvasView theme={theme} />
        <SidePanel />
        {screen === 'overview' && <ProjectOverview />}
      </div>
      <BottomPanel />
      <EffectBrowser />
      <SplitDialog />
      <SettingsDialog />
      <ExportWarningDialog />
      <ExportDialog />
      <ModelsDialog />
    </div>
  );
}
