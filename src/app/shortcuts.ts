import { useEffect } from 'react';
import { exportPng } from '../io/export';
import { openImageDialog } from '../io/openDialog';
import { fitToViewport, zoomBy, zoomToActualSize } from '../state/viewActions';

type Shortcut = { key: string; meta: boolean; shift?: boolean; run: () => void };

// ⌘ = metaKey (macOS). Browser-Standardaktionen (Zoom, Suche, Öffnen) werden unterdrückt.
const SHORTCUTS: Shortcut[] = [
  { key: 'o', meta: true, run: openImageDialog },
  { key: 'e', meta: true, run: () => void exportPng() },
  { key: '0', meta: true, run: fitToViewport },
  { key: '1', meta: true, run: zoomToActualSize },
  {
    key: '=',
    meta: true,
    run: () => {
      zoomBy(1.25);
    },
  },
  {
    key: '+',
    meta: true,
    run: () => {
      zoomBy(1.25);
    },
  },
  {
    key: '-',
    meta: true,
    run: () => {
      zoomBy(1 / 1.25);
    },
  },
];

export function useShortcuts(): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      const hit = SHORTCUTS.find(
        (s) => s.key === key && s.meta === (e.metaKey || e.ctrlKey) && (s.shift ?? false) === e.shiftKey,
      );
      if (!hit) return;
      e.preventDefault();
      hit.run();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, []);
}
