import { create } from 'zustand';
import type { GpuInfo } from '../render/gpu';
import { type Size, type View } from './viewMath';

export type GpuStatus =
  | { state: 'pending' }
  | { state: 'ready'; info: GpuInfo; maxTextureSize: number }
  | { state: 'unavailable'; webgl2: boolean; reason: string }
  | { state: 'lost'; reason: string };

/** Ein geladenes Original (unverändert, per Hash identifiziert). */
export type ImageDoc = { originalId: string; fileName: string; width: number; height: number };

export type Notice = { id: number; level: 'info' | 'error'; text: string };

export type ThemePreference = 'system' | 'light' | 'dark';

type AppState = {
  gpu: GpuStatus;
  projectName: string;
  image: ImageDoc | null;
  view: View;
  viewport: Size;
  bottomPanelOpen: boolean;
  notices: Notice[];
  theme: ThemePreference;

  setGpu: (gpu: GpuStatus) => void;
  setProjectName: (name: string) => void;
  setImage: (image: ImageDoc) => void;
  setView: (view: View) => void;
  setViewport: (viewport: Size) => void;
  toggleBottomPanel: () => void;
  notify: (level: Notice['level'], text: string) => void;
  setTheme: (theme: ThemePreference) => void;
};

let nextNoticeId = 1;
const MAX_NOTICES = 50;

export const useAppStore = create<AppState>()((set) => ({
  gpu: { state: 'pending' },
  projectName: 'Unbenanntes Projekt',
  image: null,
  view: { zoom: 1, offsetX: 0, offsetY: 0 },
  viewport: { width: 1, height: 1 },
  bottomPanelOpen: false,
  notices: [],
  theme: 'system',

  setGpu: (gpu) => set({ gpu }),
  setProjectName: (projectName) => set({ projectName }),
  setImage: (image) => set({ image }),
  setView: (view) => set({ view }),
  setViewport: (viewport) => set({ viewport }),
  toggleBottomPanel: () => set((s) => ({ bottomPanelOpen: !s.bottomPanelOpen })),
  notify: (level, text) =>
    set((s) => ({
      notices: [...s.notices, { id: nextNoticeId++, level, text }].slice(-MAX_NOTICES),
      bottomPanelOpen: level === 'error' ? true : s.bottomPanelOpen,
    })),
  setTheme: (theme) => set({ theme }),
}));
