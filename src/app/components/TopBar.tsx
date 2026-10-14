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
  SettingsIcon,
  SunIcon,
  UndoIcon,
} from './Icons';

const VIEW_MODES = [
  { value: 'result', label: 'Ergebnis', key: '1' },
  { value: 'mask', label: 'Maske', key: '2' },
  { value: 'focus', label: 'Fokus', key: '3' },
] as const;

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
  const licenseMode = useAppStore((s) => s.licenseMode);
  const service = useAppStore((s) => s.service.state);
  const mlMode = useAppStore((s) => s.mlMode);
  const viewMode = useAppStore((s) => s.viewMode);
  const setViewMode = useAppStore((s) => s.setViewMode);
  const setSettingsOpen = useAppStore((s) => s.setSettingsOpen);
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
        <span className="segmented view-modes" role="radiogroup" aria-label="Ansicht">
          {VIEW_MODES.map((m) => (
            <button
              key={m.value}
              role="radio"
              aria-checked={viewMode === m.value}
              className={viewMode === m.value ? 'active' : ''}
              disabled={!hasImage}
              title={`${m.label} (${m.key})`}
              onClick={() => {
                setViewMode(m.value);
              }}
              data-testid={`view-${m.value}`}
            >
              {m.label}
            </button>
          ))}
        </span>
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
          className={`license-pill ${licenseMode}`}
          onClick={() => {
            setSettingsOpen(true);
          }}
          title="Lizenzmodus (Einstellungen)"
          data-testid="license-pill"
        >
          {licenseMode === 'commercial' ? 'Kommerziell' : 'Alle Modelle (NC)'}
        </button>
        <span
          className={`status-dot ${mlMode === 'browser' ? 'unknown' : service}`}
          title={
            mlMode === 'browser'
              ? 'ML: nur Browser'
              : service === 'online'
                ? 'ML-Dienst verbunden'
                : 'ML-Dienst nicht erreichbar – Browser-Modelle'
          }
          data-testid="service-dot"
        />
        <button
          className="icon-button"
          onClick={() => {
            setSettingsOpen(true);
          }}
          title="Einstellungen"
          aria-label="Einstellungen"
          data-testid="settings-button"
        >
          <SettingsIcon />
        </button>
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
