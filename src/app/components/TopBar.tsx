import { flushAutosave } from '../../io/autosave';
import { exportPng } from '../../io/export';
import { openFileDialog } from '../../io/openDialog';
import { saveProjectFile } from '../../io/saveProjectFile';
import { canRedo, canUndo } from '../../state/history';
import { closeProject, redoCommand, renameProject, undoCommand } from '../../state/commands';
import { useAppStore, useProject } from '../../state/store';
import { fitToViewport, toggleCompare, zoomBy } from '../../state/viewActions';
import { toggleTheme } from '../theme/theme';
import {
  CompareIcon,
  ExportIcon,
  FitIcon,
  GridIcon,
  MinusIcon,
  MoonIcon,
  OpenIcon,
  PlusIcon,
  RedoIcon,
  SaveIcon,
  SunIcon,
  UndoIcon,
} from './Icons';

const SAVE_LABEL = {
  saved: 'Gespeichert',
  pending: 'Ungespeichert',
  saving: 'Speichert …',
  error: 'Speicherfehler',
};

export function TopBar({ theme }: { theme: 'light' | 'dark' }) {
  const project = useProject();
  const history = useAppStore((s) => s.history);
  const zoom = useAppStore((s) => s.view.zoom);
  const gpuReady = useAppStore((s) => s.gpu.state === 'ready');
  const compare = useAppStore((s) => s.compareSplit !== null);
  const saveState = useAppStore((s) => s.saveState);
  const setScreen = useAppStore((s) => s.setScreen);
  const hasImage = project !== null;

  return (
    <header className="topbar">
      <div className="topbar-group">
        <button
          className="icon-button"
          title="Projektübersicht"
          aria-label="Projektübersicht"
          data-testid="overview-button"
          onClick={() => {
            void flushAutosave().then(() => {
              closeProject();
              setScreen('overview');
            });
          }}
        >
          <GridIcon />
        </button>
        <input
          className="project-name"
          aria-label="Projektname"
          value={project?.name ?? ''}
          placeholder="Kein Projekt"
          disabled={!project}
          onChange={(e) => {
            renameProject(e.target.value);
          }}
          spellCheck={false}
        />
        {project && (
          <span className={`save-state ${saveState}`} data-testid="save-state">
            {SAVE_LABEL[saveState]}
          </span>
        )}
        <div className="divider" />
        <button
          className="icon-button"
          disabled={!history || !canUndo(history)}
          onClick={undoCommand}
          title="Rückgängig (⌘Z)"
          aria-label="Rückgängig"
          data-testid="undo"
        >
          <UndoIcon />
        </button>
        <button
          className="icon-button"
          disabled={!history || !canRedo(history)}
          onClick={redoCommand}
          title="Wiederholen (⇧⌘Z)"
          aria-label="Wiederholen"
          data-testid="redo"
        >
          <RedoIcon />
        </button>
      </div>

      <div className="topbar-group">
        <button
          className={`icon-button${compare ? ' active' : ''}`}
          onClick={toggleCompare}
          disabled={!hasImage}
          title="Vorher/Nachher (\)"
          aria-label="Vorher/Nachher"
          aria-pressed={compare}
          data-testid="compare-toggle"
        >
          <CompareIcon />
        </button>
        <div className="divider" />
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
        <button
          className="button"
          onClick={openFileDialog}
          disabled={!gpuReady}
          title="Bild oder Projektdatei öffnen (⌘O)"
        >
          <OpenIcon />
          Öffnen
        </button>
        <button
          className="button"
          onClick={() => void saveProjectFile()}
          disabled={!hasImage}
          title="Projektdatei sichern (⌘S)"
          data-testid="save-file-button"
        >
          <SaveIcon />
          Sichern
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
