import { useEffect } from 'react';
import { addImageDialog, openFileDialog } from '../io/openDialog';
import { saveProjectFile } from '../io/saveProjectFile';
import {
  deleteNodeCommand,
  edgeNodeCommand,
  redoCommand,
  stepNodeCommand,
  undoCommand,
} from '../state/commands';
import { useAppStore } from '../state/store';
import { fitToViewport, toggleCompare, zoomBy, zoomToActualSize } from '../state/viewActions';

type Shortcut = { key: string; meta: boolean; shift?: boolean; inText?: boolean; run: () => void };

const withProject = (fn: () => void) => () => {
  if (useAppStore.getState().history) fn();
};

// ⌘ = metaKey (macOS). Browser-Standardaktionen (Zoom, Suche, Öffnen, Sichern) werden unterdrückt.
const SHORTCUTS: Shortcut[] = [
  { key: 'o', meta: true, inText: true, run: openFileDialog },
  { key: 's', meta: true, inText: true, run: () => void saveProjectFile() },
  {
    key: 'e',
    meta: true,
    inText: true,
    run: () => {
      if (useAppStore.getState().history) useAppStore.getState().setExportOpen(true);
    },
  },
  {
    key: 'o',
    meta: true,
    shift: true,
    inText: true,
    run: withProject(addImageDialog),
  },
  // Reihenfolge (Spec f): ⌘] / ⌘[ eine Ebene, ⇧⌘] / ⇧⌘[ ganz nach vorn/hinten
  { key: ']', meta: true, run: withProject(() => stepNodeCommand(1)) },
  { key: '[', meta: true, run: withProject(() => stepNodeCommand(-1)) },
  { key: ']', meta: true, shift: true, run: withProject(() => edgeNodeCommand(1)) },
  { key: '[', meta: true, shift: true, run: withProject(() => edgeNodeCommand(-1)) },
  {
    key: 'backspace',
    meta: true,
    run: withProject(() => {
      const id = useAppStore.getState().selectedNodeId;
      if (id) deleteNodeCommand(id);
    }),
  },
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
  {
    key: 'p',
    meta: false,
    run: () => {
      const s = useAppStore.getState();
      if (s.history) s.setParallax({ enabled: !s.parallax.enabled, pointer: [0, 0] });
    },
  },
  {
    key: '1',
    meta: false,
    run: () => {
      useAppStore.getState().setViewMode('result');
    },
  },
  {
    key: '2',
    meta: false,
    run: () => {
      useAppStore.getState().setViewMode('mask');
    },
  },
  {
    key: '3',
    meta: false,
    run: () => {
      useAppStore.getState().setViewMode('focus');
    },
  },
  {
    key: '4',
    meta: false,
    run: () => {
      useAppStore.getState().setViewMode('depth');
    },
  },
  {
    key: '5',
    meta: false,
    run: () => {
      useAppStore.getState().setViewMode('analysis');
    },
  },
  {
    key: 'v',
    meta: false,
    run: () => {
      useAppStore.getState().setTool('move');
    },
  },
  {
    key: 'f',
    meta: false,
    run: () => {
      useAppStore.getState().setTool('focus');
    },
  },
  {
    key: 'w',
    meta: false,
    run: () => {
      useAppStore.getState().setTool('smart');
    },
  },
  {
    key: 'b',
    meta: false,
    run: () => {
      useAppStore.getState().setTool('brush');
    },
  },
  {
    // Pinselgröße (Basis-Spec g: Tastatur [ und ])
    key: ']',
    meta: false,
    run: () => {
      const s = useAppStore.getState();
      s.setBrush({ size: Math.min(800, Math.round(s.brush.size * 1.2 + 1)) });
    },
  },
  {
    key: '[',
    meta: false,
    run: () => {
      const s = useAppStore.getState();
      s.setBrush({ size: Math.max(1, Math.round(s.brush.size / 1.2)) });
    },
  },
  {
    key: 'escape',
    meta: false,
    run: () => {
      useAppStore.getState().setTool('move');
    },
  },
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
      // Klammern nach dem Zeichen (nicht der Taste: auf deutscher Tastatur liegt dort „+“ = Zoom);
      // mit ⇧ liefert die US-Tastatur { }, auf deutscher Tastatur ⌥5/⌥6
      const bracket = e.key === ']' || e.key === '}' ? ']' : e.key === '[' || e.key === '{' ? '[' : null;
      const key = (e.metaKey || e.ctrlKey) && bracket ? bracket : e.key.toLowerCase();
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
