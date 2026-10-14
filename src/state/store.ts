import { create } from 'zustand';
import type { GpuInfo } from '../render/gpu';
import { createHistory, present, type History } from './history';
import type { Project } from './project';
import { type Size, type View } from './viewMath';

export type GpuStatus =
  | { state: 'pending' }
  | { state: 'ready'; info: GpuInfo; maxTextureSize: number }
  | { state: 'unavailable'; webgl2: boolean; reason: string }
  | { state: 'lost'; reason: string };

export type Notice = { id: number; level: 'info' | 'error'; text: string };

export type ThemePreference = 'system' | 'light' | 'dark';

export type SaveState = 'saved' | 'pending' | 'saving' | 'error';

type AppState = {
  gpu: GpuStatus;
  screen: 'overview' | 'editor';
  history: History<Project> | null;
  selectedNodeId: string | null;
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

  setGpu: (gpu: GpuStatus) => void;
  setScreen: (screen: AppState['screen']) => void;
  setHistory: (history: History<Project> | null) => void;
  select: (id: string | null) => void;
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
};

let nextNoticeId = 1;
const MAX_NOTICES = 100;

export const useAppStore = create<AppState>()((set) => ({
  gpu: { state: 'pending' },
  screen: 'editor',
  history: null,
  selectedNodeId: null,
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

  setGpu: (gpu) => set({ gpu }),
  setScreen: (screen) => set({ screen }),
  setHistory: (history) => set({ history }),
  select: (selectedNodeId) => set({ selectedNodeId }),
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
