// Übersicht aller Modelle: Status (nicht geladen / lädt / pausiert / geladen), Fortschritt, Steuerung.

import * as Dialog from '@radix-ui/react-dialog';
import { browserDownload } from '../../ml/browserBackend';
import { checkService } from '../../ml/backend';
import { isAllowed, MODELS, type ModelEntry } from '../../ml/registry';
import { serviceModelCommand } from '../../ml/serviceBackend';
import { useAppStore } from '../../state/store';
import { LicenseBadge } from './LayerSections';

type Status = 'missing' | 'downloading' | 'paused' | 'verifying' | 'done' | 'error' | 'offline' | 'unknown';
type Row = { status: Status; loaded: number; total: number; error?: string | undefined };

const LABEL: Record<Status, string> = {
  missing: 'nicht heruntergeladen',
  downloading: 'lädt …',
  paused: 'pausiert',
  verifying: 'wird geprüft …',
  done: 'heruntergeladen',
  error: 'Fehler',
  offline: 'Dienst nicht verbunden',
  unknown: '–',
};

const mb = (n: number) => `${(n / 1e6).toFixed(n >= 1e8 ? 0 : 1)} MB`;

function useRow(model: ModelEntry): Row {
  const downloads = useAppStore((s) => s.downloads);
  const service = useAppStore((s) => s.service);
  if (model.runtime === 'browser') {
    const files = model.files ?? [];
    const states = files.map((f) => downloads[f.name]);
    const total = files.reduce((a, f) => a + f.size, 0);
    const loaded = states.reduce((a, s) => a + (s?.loaded ?? 0), 0);
    if (states.some((s) => s === undefined)) return { status: 'unknown', loaded, total };
    const order: Status[] = ['error', 'downloading', 'verifying', 'paused', 'missing', 'done'];
    const status = order.find((o) => states.some((s) => s?.status === o)) ?? 'missing';
    return { status, loaded, total, error: states.find((s) => s?.error)?.error };
  }
  if (service.state !== 'online') return { status: 'offline', loaded: 0, total: 0 };
  const info = service.info?.models.find((m) => m.id === model.id);
  const d = info?.download;
  if (!d) return { status: 'unknown', loaded: 0, total: 0 };
  return {
    status: d.status,
    loaded: d.loaded,
    total: d.total,
    error: d.error ?? (d.status === 'missing' ? info.note : undefined),
  };
}

async function run(model: ModelEntry, cmd: 'start' | 'pause' | 'stop' | 'delete') {
  const { notify, licenseMode } = useAppStore.getState();
  try {
    if (model.runtime === 'browser') await browserDownload(cmd, model.id);
    else {
      await serviceModelCommand(model.id, cmd === 'start' ? 'download' : cmd, licenseMode);
      await checkService();
    }
  } catch (e) {
    notify('error', `${model.name}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

function ModelRow({ model }: { model: ModelEntry }) {
  const licenseMode = useAppStore((s) => s.licenseMode);
  const row = useRow(model);
  const allowed = isAllowed(model, licenseMode);
  const pct = row.total > 0 ? Math.min(100, (100 * row.loaded) / row.total) : 0;
  const size = model.files?.reduce((a, f) => a + f.size, 0) ?? row.total;
  const showBar = row.status === 'downloading' || row.status === 'paused' || row.status === 'verifying';
  return (
    <li className={`model-row ${row.status}`} data-testid={`model-${model.id}`} data-status={row.status}>
      <div className="model-head">
        <span className="model-name">{model.name}</span>
        <LicenseBadge commercial={model.commercialUse} title={model.license} />
        <span className="model-meta">{size > 0 ? mb(size) : ''}</span>
      </div>
      <div className="model-status">
        <span className="model-status-text" title={row.error}>
          {LABEL[row.status]}
          {showBar && row.total > 0 ? ` ${mb(row.loaded)} von ${mb(row.total)} (${Math.floor(pct)} %)` : ''}
          {row.status === 'error' && row.error ? `: ${row.error}` : ''}
          {row.status === 'missing' && row.error && allowed ? ` – ${row.error}` : ''}
          {!allowed && row.status === 'missing' ? ' – im Lizenzmodus „Kommerziell“ gesperrt' : ''}
        </span>
        <span className="model-actions">
          {(row.status === 'missing' || row.status === 'error') && (
            <button
              className="button small"
              disabled={!allowed}
              onClick={() => void run(model, 'start')}
              data-testid="model-start"
            >
              Herunterladen
            </button>
          )}
          {row.status === 'downloading' && (
            <button
              className="button small"
              onClick={() => void run(model, 'pause')}
              data-testid="model-pause"
            >
              Pausieren
            </button>
          )}
          {row.status === 'paused' && (
            <button
              className="button small"
              disabled={!allowed}
              onClick={() => void run(model, 'start')}
              data-testid="model-resume"
            >
              Fortsetzen
            </button>
          )}
          {(row.status === 'downloading' || row.status === 'paused') && (
            <button className="button small" onClick={() => void run(model, 'stop')} data-testid="model-stop">
              Stoppen
            </button>
          )}
          {row.status === 'done' && (
            <button
              className="button small"
              onClick={() => {
                if (
                  window.confirm(
                    `${model.name} aus dem lokalen Speicher löschen? Es wird bei Bedarf erneut geladen.`,
                  )
                )
                  void run(model, 'delete');
              }}
              data-testid="model-delete"
            >
              Löschen
            </button>
          )}
        </span>
      </div>
      {showBar && (
        <span className="task-bar model-bar">
          <span
            className={`task-fill${row.status === 'paused' ? ' paused' : ''}`}
            style={{ width: `${pct}%` }}
          />
        </span>
      )}
    </li>
  );
}

export function ModelsDialog() {
  const open = useAppStore((s) => s.modelsOpen);
  const setOpen = useAppStore((s) => s.setModelsOpen);
  const service = useAppStore((s) => s.service.state);
  const browser = MODELS.filter((m) => m.runtime === 'browser');
  const svc = MODELS.filter((m) => m.runtime === 'service');
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog" data-testid="models-dialog" aria-describedby={undefined}>
          <div className="dialog-head">
            <Dialog.Title className="dialog-title">Modelle</Dialog.Title>
          </div>
          <div className="dialog-body">
            <h3 className="section-title">Im Browser (lokaler Speicher dieses Browsers)</h3>
            <ul className="model-list">
              {browser.map((m) => (
                <ModelRow key={m.id} model={m} />
              ))}
            </ul>
            <h3 className="section-title">Im ML-Dienst {service === 'online' ? '' : '(nicht verbunden)'}</h3>
            <ul className="model-list">
              {svc.map((m) => (
                <ModelRow key={m.id} model={m} />
              ))}
            </ul>
            <p className="section-note">
              Pausierte Downloads werden beim Fortsetzen an derselben Stelle weitergeführt. Fertige Dateien
              werden per SHA-256 geprüft. Lizenzen: MODELS.md.
            </p>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** Anzeige in der oberen Leiste, solange Modelle laden (Klick öffnet die Übersicht). */
export function DownloadChip() {
  const downloads = useAppStore((s) => s.downloads);
  const service = useAppStore((s) => s.service);
  const setOpen = useAppStore((s) => s.setModelsOpen);
  const active = [
    ...Object.values(downloads).filter((d) => d.status === 'downloading' || d.status === 'verifying'),
    ...(service.state === 'online'
      ? (service.info?.models ?? []).flatMap((m) =>
          m.download?.status === 'downloading' ? [m.download] : [],
        )
      : []),
  ];
  const paused =
    Object.values(downloads).some((d) => d.status === 'paused') ||
    (service.info?.models ?? []).some((m) => m.download?.status === 'paused');
  if (!active.length && !paused) return null;
  const loaded = active.reduce((a, d) => a + d.loaded, 0);
  const total = active.reduce((a, d) => a + d.total, 0);
  const pct = total > 0 ? Math.floor((100 * loaded) / total) : 0;
  return (
    <button
      className="download-chip"
      onClick={() => {
        setOpen(true);
      }}
      title="Modell-Downloads anzeigen"
      data-testid="download-chip"
    >
      {active.length ? `Modelle laden · ${pct} %` : 'Download pausiert'}
      <span className="download-chip-bar">
        <span style={{ width: `${pct}%` }} />
      </span>
    </button>
  );
}
