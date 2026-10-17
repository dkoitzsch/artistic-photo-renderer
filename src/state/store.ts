import { create } from 'zustand';
import type { DownloadState } from '../ml/protocol';
import type { AsyncJobInfo } from '../render/asyncEffects';
import type { GpuInfo } from '../render/gpu';
import { createHistory, present, type History } from './history';
import type { LicenseMode, Project } from './project';
import { type Size, type View } from './viewMath';

export type GpuStatus =
  | { state: 'pending' }
  | { state: 'ready'; info: GpuInfo; maxTextureSize: number }
  | { state: 'unavailable'; webgl2: boolean; reason: string }
  | { state: 'lost'; reason: string };

export type Notice = { id: number; level: 'info' | 'error'; text: string };

export type ThemePreference = 'system' | 'light' | 'dark';

export type SaveState = 'saved' | 'pending' | 'saving' | 'error';

export type MlMode = 'auto' | 'browser' | 'service';

export type ServiceModel = {
  id: string;
  license: string;
  commercialUse: boolean;
  loaded: boolean;
  available: boolean;
  note?: string;
  /** Download-Zustand im Dienst */
  download?: {
    status: 'missing' | 'downloading' | 'paused' | 'done' | 'error';
    loaded: number;
    total: number;
    error?: string | null;
  };
};
/** Effekt mit Python-Implementierung im Dienst */
export type ServiceEffect = {
  id: string;
  version: string;
  commercialUse: boolean;
  available: boolean;
  note?: string | null;
};
export type ServiceInfo = {
  device: string;
  version: string;
  models: ServiceModel[];
  effects?: ServiceEffect[];
};
export type ServiceStatus = { state: 'unknown' | 'online' | 'offline'; info?: ServiceInfo };

/** Laufende ML-Aufgabe (Fortschritt in der unteren Leiste) */
export type MlTask = { id: number; label: string; detail: string; progress: number | null };

export type ViewMode = 'result' | 'mask' | 'focus' | 'depth' | 'analysis';

/** Ansicht „Analysekarte“: welche Karte, mit welcher Deckkraft (0..1) */
export type AnalysisView = { map: 'luminance' | 'edges'; opacity: number };

/** Parallax-Vorschau (verändert das Projekt nicht) */
export type ParallaxState = {
  enabled: boolean;
  /** 0…100 % */
  strength: number;
  axis: 'both' | 'horizontal' | 'vertical';
  /** Zeigerposition relativ zur Leinwandmitte, −1…1 */
  pointer: [number, number];
};
export type Tool = 'move' | 'focus';

export type ExportWarning = {
  layers: { id: string; name: string; modelId: string }[];
  /** gewählter Export, der nach Bestätigung ausgeführt wird */
  options?: import('../io/export').ExportOptions;
};

type AppState = {
  gpu: GpuStatus;
  screen: 'overview' | 'editor';
  history: History<Project> | null;
  selectedNodeId: string | null;
  /** zusätzlich ausgewählte Knoten (⌘-/⇧-Klick in der Ebenenliste), z. B. zum Gruppieren */
  extraSelection: string[];
  view: View;
  viewport: Size;
  /** Vorher/Nachher: Teilung als Anteil der Leinwandbreite (0..1), null = aus */
  compareSplit: number | null;
  effectBrowserOpen: boolean;
  bottomPanelOpen: boolean;
  bottomTab: 'notices' | 'history';
  notices: Notice[];
  theme: ThemePreference;
  saveState: SaveState;
  /** Ein Bild/Projekt wird gerade geladen */
  busy: string | null;
  licenseMode: LicenseMode;
  mlMode: MlMode;
  service: ServiceStatus;
  tasks: MlTask[];
  viewMode: ViewMode;
  tool: Tool;
  splitDialogLayerId: string | null;
  settingsOpen: boolean;
  exportWarning: ExportWarning | null;
  /** Browser-Modelldateien (Download-Manager im ML-Worker) */
  downloads: Record<string, DownloadState>;
  modelsOpen: boolean;
  parallax: ParallaxState;
  exportOpen: boolean;
  analysisView: AnalysisView;
  /** laufende/fehlgeschlagene Worker- und Dienst-Effekte */
  asyncJobs: AsyncJobInfo[];
  /** zählt hoch, wenn neue Effekt-Ergebnisse vorliegen (Vorschau neu rendern) */
  renderTick: number;

  setGpu: (gpu: GpuStatus) => void;
  setScreen: (screen: AppState['screen']) => void;
  setHistory: (history: History<Project> | null) => void;
  select: (id: string | null) => void;
  setExtraSelection: (ids: string[]) => void;
  setView: (view: View) => void;
  setViewport: (viewport: Size) => void;
  setCompareSplit: (split: number | null) => void;
  setEffectBrowserOpen: (open: boolean) => void;
  toggleBottomPanel: () => void;
  showBottomTab: (tab: AppState['bottomTab']) => void;
  notify: (level: Notice['level'], text: string) => void;
  setTheme: (theme: ThemePreference) => void;
  setSaveState: (s: SaveState) => void;
  setBusy: (b: string | null) => void;
  setLicenseMode: (m: LicenseMode) => void;
  setMlMode: (m: MlMode) => void;
  setService: (s: ServiceStatus) => void;
  upsertTask: (t: MlTask) => void;
  removeTask: (id: number) => void;
  setViewMode: (m: ViewMode) => void;
  setTool: (t: Tool) => void;
  openSplitDialog: (layerId: string | null) => void;
  setSettingsOpen: (open: boolean) => void;
  setExportWarning: (w: ExportWarning | null) => void;
  setDownloads: (states: DownloadState[]) => void;
  setModelsOpen: (open: boolean) => void;
  setParallax: (patch: Partial<ParallaxState>) => void;
  setExportOpen: (open: boolean) => void;
  setAnalysisView: (patch: Partial<AnalysisView>) => void;
  setAsyncJobs: (jobs: AsyncJobInfo[]) => void;
  bumpRenderTick: () => void;
};

let nextNoticeId = 1;
const MAX_NOTICES = 100;

export const useAppStore = create<AppState>()((set) => ({
  gpu: { state: 'pending' },
  screen: 'editor',
  history: null,
  selectedNodeId: null,
  extraSelection: [],
  view: { zoom: 1, offsetX: 0, offsetY: 0 },
  viewport: { width: 1, height: 1 },
  compareSplit: null,
  effectBrowserOpen: false,
  bottomPanelOpen: false,
  bottomTab: 'notices',
  notices: [],
  theme: 'system',
  saveState: 'saved',
  busy: null,
  licenseMode: 'commercial',
  mlMode: 'auto',
  service: { state: 'unknown' },
  tasks: [],
  viewMode: 'result',
  tool: 'move',
  splitDialogLayerId: null,
  settingsOpen: false,
  exportWarning: null,
  downloads: {},
  modelsOpen: false,
  parallax: { enabled: false, strength: 50, axis: 'both', pointer: [0, 0] },
  exportOpen: false,
  analysisView: { map: 'edges', opacity: 0.85 },
  asyncJobs: [],
  renderTick: 0,

  setGpu: (gpu) => set({ gpu }),
  setScreen: (screen) => set({ screen }),
  setHistory: (history) => set({ history }),
  select: (selectedNodeId) => set({ selectedNodeId, extraSelection: [] }),
  setExtraSelection: (extraSelection) => set({ extraSelection }),
  setView: (view) => set({ view }),
  setViewport: (viewport) => set({ viewport }),
  setCompareSplit: (compareSplit) => set({ compareSplit }),
  setEffectBrowserOpen: (effectBrowserOpen) => set({ effectBrowserOpen }),
  toggleBottomPanel: () => set((s) => ({ bottomPanelOpen: !s.bottomPanelOpen })),
  showBottomTab: (bottomTab) => set({ bottomTab, bottomPanelOpen: true }),
  notify: (level, text) =>
    set((s) => ({
      notices: [...s.notices, { id: nextNoticeId++, level, text }].slice(-MAX_NOTICES),
      bottomPanelOpen: level === 'error' ? true : s.bottomPanelOpen,
      bottomTab: level === 'error' ? 'notices' : s.bottomTab,
    })),
  setTheme: (theme) => set({ theme }),
  setSaveState: (saveState) => set({ saveState }),
  setBusy: (busy) => set({ busy }),
  setLicenseMode: (licenseMode) => set({ licenseMode }),
  setMlMode: (mlMode) => set({ mlMode }),
  setService: (service) => set({ service }),
  upsertTask: (t) =>
    set((s) => ({ tasks: [...s.tasks.filter((x) => x.id !== t.id), t].sort((a, b) => a.id - b.id) })),
  removeTask: (id) => set((s) => ({ tasks: s.tasks.filter((t) => t.id !== id) })),
  setViewMode: (viewMode) => set({ viewMode }),
  setTool: (tool) => set({ tool }),
  openSplitDialog: (splitDialogLayerId) => set({ splitDialogLayerId }),
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
  setExportWarning: (exportWarning) => set({ exportWarning }),
  setDownloads: (states) => set({ downloads: Object.fromEntries(states.map((d) => [d.name, d])) }),
  setModelsOpen: (modelsOpen) => set({ modelsOpen }),
  setParallax: (patch) => set((s) => ({ parallax: { ...s.parallax, ...patch } })),
  setExportOpen: (exportOpen) => set({ exportOpen }),
  setAnalysisView: (patch) => set((s) => ({ analysisView: { ...s.analysisView, ...patch } })),
  setAsyncJobs: (asyncJobs) => set({ asyncJobs }),
  bumpRenderTick: () => set((s) => ({ renderTick: s.renderTick + 1 })),
}));

/** Aktuelles Projekt (Gegenwart der History) oder null. */
export function selectProject(s: { history: History<Project> | null }): Project | null {
  return s.history ? present(s.history) : null;
}

export function useProject(): Project | null {
  return useAppStore(selectProject);
}

export function getProject(): Project | null {
  return selectProject(useAppStore.getState());
}

export function newHistory(project: Project, label = 'Geöffnet'): History<Project> {
  return createHistory(project, label);
}
