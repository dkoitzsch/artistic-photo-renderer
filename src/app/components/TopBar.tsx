import { exportPng } from '../../io/export';
import { openImageDialog } from '../../io/openDialog';
import { useAppStore } from '../../state/store';
import { fitToViewport, zoomBy } from '../../state/viewActions';
import { toggleTheme } from '../theme/theme';
import {
  ExportIcon,
  FitIcon,
  MinusIcon,
  MoonIcon,
  OpenIcon,
  PlusIcon,
  RedoIcon,
  SunIcon,
  UndoIcon,
} from './Icons';

export function TopBar({ theme }: { theme: 'light' | 'dark' }) {
  const projectName = useAppStore((s) => s.projectName);
  const setProjectName = useAppStore((s) => s.setProjectName);
  const zoom = useAppStore((s) => s.view.zoom);
  const hasImage = useAppStore((s) => s.image !== null);
  const gpuReady = useAppStore((s) => s.gpu.state === 'ready');

  return (
    <header className="topbar">
      <div className="topbar-group">
        <span className="app-mark" aria-hidden="true" />
        <input
          className="project-name"
          aria-label="Projektname"
          value={projectName}
          onChange={(e) => {
            setProjectName(e.target.value);
          }}
          spellCheck={false}
        />
        <div className="divider" />
        <button className="icon-button" disabled title="Rückgängig (⌘Z) – ab Phase 1">
          <UndoIcon />
        </button>
        <button className="icon-button" disabled title="Wiederholen (⇧⌘Z) – ab Phase 1">
          <RedoIcon />
        </button>
      </div>

      <div className="topbar-group">
        <button
          className="icon-button"
          onClick={() => {
            zoomBy(1 / 1.25);
          }}
          disabled={!hasImage}
          title="Verkleinern (⌘−)"
        >
          <MinusIcon />
        </button>
        <span className="zoom-value" data-testid="zoom-value">
          {hasImage ? `${Math.round(zoom * 100)} %` : '–'}
        </span>
        <button
          className="icon-button"
          onClick={() => {
            zoomBy(1.25);
          }}
          disabled={!hasImage}
          title="Vergrößern (⌘+)"
        >
          <PlusIcon />
        </button>
        <button className="icon-button" onClick={fitToViewport} disabled={!hasImage} title="Einpassen (⌘0)">
          <FitIcon />
        </button>
      </div>

      <div className="topbar-group">
        <button
          className="icon-button"
          onClick={toggleTheme}
          title={theme === 'dark' ? 'Helles Design' : 'Dunkles Design'}
          aria-label="Design umschalten"
          data-testid="theme-toggle"
        >
          {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
        </button>
        <button className="button" onClick={openImageDialog} disabled={!gpuReady} title="Bild öffnen (⌘O)">
          <OpenIcon />
          Öffnen
        </button>
        <button
          className="button primary"
          onClick={() => void exportPng()}
          disabled={!hasImage}
          title="Als PNG exportieren (⌘E)"
          data-testid="export-button"
        >
          <ExportIcon />
          Export
        </button>
      </div>
    </header>
  );
}
