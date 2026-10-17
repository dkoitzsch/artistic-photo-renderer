import { renderFullResolution } from '../../io/export';
import { hasAsyncEffects } from '../../render/engine';
import { getEngine } from '../../render/runtime';
import { jumpToHistory } from '../../state/commands';
import { useAppStore, useProject } from '../../state/store';
import { ChevronDownIcon, ChevronUpIcon } from './Icons';

function HistoryList() {
  const history = useAppStore((s) => s.history);
  if (!history) return <p className="panel-empty">Kein Projekt geöffnet.</p>;
  return (
    <ol className="history-list" data-testid="history-list">
      {history.entries.map((e, i) => (
        <li key={i}>
          <button
            className={`history-item${i === history.index ? ' current' : ''}${i > history.index ? ' future' : ''}`}
            onClick={() => {
              jumpToHistory(i);
            }}
          >
            {e.label}
          </button>
        </li>
      ))}
    </ol>
  );
}

export function BottomPanel() {
  const open = useAppStore((s) => s.bottomPanelOpen);
  const tab = useAppStore((s) => s.bottomTab);
  const toggle = useAppStore((s) => s.toggleBottomPanel);
  const showTab = useAppStore((s) => s.showBottomTab);
  const notices = useAppStore((s) => s.notices);
  const gpu = useAppStore((s) => s.gpu);
  const busy = useAppStore((s) => s.busy);
  const tasks = useAppStore((s) => s.tasks);
  const asyncJobs = useAppStore((s) => s.asyncJobs);
  const project = useProject();
  const showFullRes = project !== null && hasAsyncEffects(project);
  const last = notices.at(-1);

  return (
    <footer className={`bottompanel${open ? ' open' : ''}`}>
      {open && (
        <div className="bottompanel-body">
          {tab === 'notices' ? (
            <ul className="notice-list" aria-label="Hinweise">
              {notices.length === 0 && <li className="panel-empty">Keine Hinweise.</li>}
              {[...notices].reverse().map((n) => (
                <li key={n.id} className={`notice ${n.level}`}>
                  {n.text}
                </li>
              ))}
            </ul>
          ) : (
            <HistoryList />
          )}
        </div>
      )}
      {tasks.length > 0 && (
        <ul className="task-list" data-testid="ml-tasks">
          {tasks.map((t) => (
            <li key={t.id} className="task">
              <span className="task-label">{t.label}</span>
              <span className="task-detail">{t.detail}</span>
              <span className="task-bar">
                <span
                  className={`task-fill${t.progress === null ? ' indeterminate' : ''}`}
                  style={{ width: `${Math.round((t.progress ?? 0.3) * 100)}%` }}
                />
              </span>
            </li>
          ))}
        </ul>
      )}
      {asyncJobs.length > 0 && (
        <ul className="task-list" data-testid="effect-jobs">
          {asyncJobs.map((j) => (
            <li
              key={j.key}
              className={`task${j.status === 'error' ? ' error' : ''}`}
              data-testid="effect-job"
            >
              <span className="task-label">
                {j.label} · {j.impl === 'python' ? 'Dienst' : 'Browser-CPU'}
              </span>
              <span className="task-detail">
                {j.status === 'error'
                  ? j.error
                  : j.status === 'cancelled'
                    ? 'abgebrochen'
                    : j.status === 'pending'
                      ? 'wartet …'
                      : `${Math.round(j.progress * 100)} %`}
              </span>
              {(j.status === 'pending' || j.status === 'running') && (
                <span className="task-bar">
                  <span className="task-fill" style={{ width: `${Math.round(j.progress * 100)}%` }} />
                </span>
              )}
              {j.status === 'pending' || j.status === 'running' ? (
                <button
                  className="button small"
                  data-testid="effect-job-cancel"
                  onClick={() => {
                    getEngine()?.async.cancel(j.key);
                  }}
                >
                  Abbrechen
                </button>
              ) : (
                <button
                  className="button small"
                  data-testid="effect-job-retry"
                  onClick={() => {
                    getEngine()?.async.retry(j.key);
                  }}
                >
                  Erneut
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <div className="statusbar">
        <button
          className="statusbar-toggle"
          onClick={toggle}
          aria-expanded={open}
          title="Leiste ein-/ausblenden"
        >
          {open ? <ChevronDownIcon /> : <ChevronUpIcon />}
        </button>
        <button
          className={`statusbar-tab${open && tab === 'notices' ? ' active' : ''}`}
          onClick={() => {
            showTab('notices');
          }}
        >
          Hinweise
        </button>
        <button
          className={`statusbar-tab${open && tab === 'history' ? ' active' : ''}`}
          onClick={() => {
            showTab('history');
          }}
          data-testid="history-tab"
        >
          Verlauf
        </button>
        {showFullRes && (
          <button
            className="statusbar-tab"
            disabled={busy !== null}
            title="Alle Effekte in voller Auflösung berechnen (Worker-/Dienst-Effekte im Endrender)"
            onClick={() => void renderFullResolution()}
            data-testid="render-full"
          >
            Vollauflösung rendern
          </button>
        )}
        <span className={`statusbar-last ${busy ? '' : (last?.level ?? '')}`} data-testid="last-notice">
          {busy ?? last?.text ?? ''}
        </span>
        <span className="statusbar-gpu">
          {gpu.state === 'ready'
            ? `WebGPU · ${gpu.info.vendor || 'GPU'} ${gpu.info.architecture}`.trim()
            : gpu.state === 'pending'
              ? 'WebGPU …'
              : 'keine GPU'}
        </span>
      </div>
    </footer>
  );
}
