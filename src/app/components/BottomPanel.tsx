import { jumpToHistory } from '../../state/commands';
import { useAppStore } from '../../state/store';
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
