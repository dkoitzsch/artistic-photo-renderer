import { useEffect } from 'react';
import { exportPng } from '../io/export';
import { openFileDialog } from '../io/openDialog';
import { saveProjectFile } from '../io/saveProjectFile';
import { redoCommand, undoCommand } from '../state/commands';
import { fitToViewport, toggleCompare, zoomBy, zoomToActualSize } from '../state/viewActions';

type Shortcut = { key: string; meta: boolean; shift?: boolean; inText?: boolean; run: () => void };

// ⌘ = metaKey (macOS). Browser-Standardaktionen (Zoom, Suche, Öffnen, Sichern) werden unterdrückt.
const SHORTCUTS: Shortcut[] = [
  { key: 'o', meta: true, inText: true, run: openFileDialog },
  { key: 's', meta: true, inText: true, run: () => void saveProjectFile() },
  { key: 'e', meta: true, inText: true, run: () => void exportPng() },
  { key: 'z', meta: true, run: undoCommand },
  { key: 'z', meta: true, shift: true, run: redoCommand },
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
  { key: '\\', meta: false, run: toggleCompare },
];

function isEditable(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))
  );
}

export function useShortcuts(): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      const meta = e.metaKey || e.ctrlKey;
      const hit = SHORTCUTS.find(
        (s) => s.key === key && s.meta === meta && (s.shift ?? false) === e.shiftKey,
      );
      if (!hit) return;
      // In Textfeldern gelten die Standardaktionen (z. B. ⌘Z im Eingabefeld), außer bei globalen Befehlen.
      if (isEditable(e.target) && !hit.inText) return;
      e.preventDefault();
      hit.run();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, []);
}
