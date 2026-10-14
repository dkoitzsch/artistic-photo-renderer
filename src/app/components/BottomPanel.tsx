import { useAppStore } from '../../state/store';
import { ChevronDownIcon, ChevronUpIcon } from './Icons';

export function BottomPanel() {
  const open = useAppStore((s) => s.bottomPanelOpen);
  const toggle = useAppStore((s) => s.toggleBottomPanel);
  const notices = useAppStore((s) => s.notices);
  const gpu = useAppStore((s) => s.gpu);
  const last = notices.at(-1);

  return (
    <footer className={`bottompanel${open ? ' open' : ''}`}>
      {open && (
        <ul className="notice-list" aria-label="Hinweise">
          {notices.length === 0 && <li className="panel-empty">Keine Hinweise.</li>}
          {[...notices].reverse().map((n) => (
            <li key={n.id} className={`notice ${n.level}`}>
              {n.text}
            </li>
          ))}
        </ul>
      )}
      <div className="statusbar">
        <button
          className="statusbar-toggle"
          onClick={toggle}
          aria-expanded={open}
          title="Hinweise ein-/ausblenden"
        >
          {open ? <ChevronDownIcon /> : <ChevronUpIcon />}
          Hinweise
        </button>
        <span className={`statusbar-last ${last?.level ?? ''}`} data-testid="last-notice">
          {last?.text ?? ''}
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
