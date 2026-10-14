// Dialoge für Phase 2: Aufteilen, Einstellungen (Lizenz- und ML-Modus), Lizenzhinweis, Export-Warnung.

import * as Dialog from '@radix-ui/react-dialog';
import { useState, type ReactNode } from 'react';
import { DEFAULT_EXPORT, exportAs, exportConfirmed, type ExportFormat } from '../../io/export';
import { checkService } from '../../ml/backend';
import { familiesFor, modelFor } from '../../ml/registry';
import { SERVICE_URL } from '../../ml/serviceBackend';
import { recomputeWithCommercialModels, splitForeground } from '../../ml/split';
import { findNode, type LicenseMode } from '../../state/project';
import { useAppStore, useProject, type MlMode } from '../../state/store';
import { licenseNoticeShown, markLicenseNoticeShown, setLicenseMode, setMlMode } from '../settings';
import { DepthSplitPanel } from './DepthSplit';
import { Slider } from '../controls/Slider';
import { LicenseBadge } from './LayerSections';

function Modal({
  open,
  onOpenChange,
  title,
  children,
  testId,
  wide = false,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  children: ReactNode;
  testId: string;
  wide?: boolean;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content
          className={`dialog${wide ? '' : ' narrow'}`}
          data-testid={testId}
          aria-describedby={undefined}
        >
          <div className="dialog-head">
            <Dialog.Title className="dialog-title">{title}</Dialog.Title>
          </div>
          <div className="dialog-body">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// ---------- Aufteilen ----------

export function SplitDialog() {
  const layerId = useAppStore((s) => s.splitDialogLayerId);
  const close = useAppStore((s) => s.openSplitDialog);
  const licenseMode = useAppStore((s) => s.licenseMode);
  const mlMode = useAppStore((s) => s.mlMode);
  const service = useAppStore((s) => s.service);
  const project = useProject();
  const families = familiesFor('foreground');
  const [family, setFamily] = useState('birefnet');
  const [landmarks, setLandmarks] = useState(true);
  const [mode, setMode] = useState<'fg' | 'depth'>('fg');
  const node = project && layerId ? findNode(project.root, layerId) : undefined;
  const selected = families.find((f) => f.family === family);
  const allowed = selected ? selected.commercialUse || licenseMode === 'all' : false;

  const runtimeText = (fam: string) => {
    const svc = modelFor(fam, 'service', 'foreground');
    const brw = modelFor(fam, 'browser', 'foreground');
    const svcAvail =
      service.state === 'online' && service.info?.models.some((m) => m.id === svc?.id && m.available);
    if (mlMode === 'browser' || (mlMode === 'auto' && !svcAvail)) return brw ? `${brw.name} im Browser` : '–';
    return svc ? `${svc.name} im Dienst` : '–';
  };

  return (
    <Modal
      open={layerId !== null}
      onOpenChange={(o) => {
        if (!o) close(null);
      }}
      title={`Aufteilen: ${node?.name ?? ''}`}
      testId="split-dialog"
    >
      <fieldset className="choice-list">
        <legend className="control-label">Modus</legend>
        <label className="choice">
          <input
            type="radio"
            name="split-mode"
            checked={mode === 'fg'}
            onChange={() => {
              setMode('fg');
            }}
            data-testid="mode-fg"
          />
          <span>Vordergrund / Hintergrund</span>
        </label>
        <label className="choice">
          <input
            type="radio"
            name="split-mode"
            checked={mode === 'depth'}
            onChange={() => {
              setMode('depth');
            }}
            data-testid="mode-depth"
          />
          <span>Tiefenebenen (2–8)</span>
        </label>
      </fieldset>
      {mode === 'depth' && layerId ? (
        <DepthSplitPanel
          layerId={layerId}
          onDone={() => {
            close(null);
          }}
        />
      ) : (
        <>
          <fieldset className="choice-list">
            <legend className="control-label">Modell</legend>
            {families.map((f) => {
              const ok = f.commercialUse || licenseMode === 'all';
              return (
                <label
                  key={f.family}
                  className={`choice${ok ? '' : ' disabled'}`}
                  title={ok ? f.license : 'Nur nicht-kommerziell – im Lizenzmodus „Kommerziell“ gesperrt'}
                >
                  <input
                    type="radio"
                    name="family"
                    disabled={!ok}
                    checked={family === f.family}
                    onChange={() => {
                      setFamily(f.family);
                    }}
                    data-testid={`family-${f.family}`}
                  />
                  <span>{f.name}</span>
                  <LicenseBadge commercial={f.commercialUse} title={f.license} />
                  <span className="choice-note">{runtimeText(f.family)}</span>
                </label>
              );
            })}
          </fieldset>
          <label className="choice">
            <input
              type="checkbox"
              checked={landmarks}
              onChange={(e) => {
                setLandmarks(e.target.checked);
              }}
            />
            <span>Personen: Fokuspunkte erkennen (Augen, Gesicht, Brust, Hände)</span>
          </label>
          <div className="dialog-actions">
            <button
              className="button"
              onClick={() => {
                close(null);
              }}
            >
              Abbrechen
            </button>
            <button
              className="button primary"
              disabled={!allowed || !node}
              data-testid="split-start"
              onClick={() => {
                if (!layerId) return;
                close(null);
                void splitForeground(layerId, family, landmarks);
              }}
            >
              Aufteilen
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}

// ---------- Einstellungen ----------

const ML_MODES: { value: MlMode; label: string; note: string }[] = [
  { value: 'auto', label: 'Auto', note: 'Dienst, sobald er antwortet; sonst Browser' },
  { value: 'browser', label: 'Browser', note: 'nur Modelle im Browser' },
  { value: 'service', label: 'Dienst', note: `nur lokaler Python-Dienst (${SERVICE_URL})` },
];

export function SettingsDialog() {
  const open = useAppStore((s) => s.settingsOpen);
  const setOpen = useAppStore((s) => s.setSettingsOpen);
  const licenseMode = useAppStore((s) => s.licenseMode);
  const mlMode = useAppStore((s) => s.mlMode);
  const service = useAppStore((s) => s.service);
  const [confirmAll, setConfirmAll] = useState(false);

  const chooseLicense = (mode: LicenseMode) => {
    if (mode === 'all' && !licenseNoticeShown()) {
      setConfirmAll(true);
      return;
    }
    setLicenseMode(mode);
  };

  return (
    <>
      <Modal open={open} onOpenChange={setOpen} title="Einstellungen" testId="settings-dialog">
        <fieldset className="choice-list">
          <legend className="control-label">Lizenzmodus</legend>
          <label className="choice">
            <input
              type="radio"
              name="license"
              checked={licenseMode === 'commercial'}
              onChange={() => {
                chooseLicense('commercial');
              }}
              data-testid="license-commercial"
            />
            <span>Kommerziell</span>
            <span className="choice-note">
              nur Modelle, deren Lizenz kommerzielle Nutzung erlaubt (Standard)
            </span>
          </label>
          <label className="choice">
            <input
              type="radio"
              name="license"
              checked={licenseMode === 'all'}
              onChange={() => {
                chooseLicense('all');
              }}
              data-testid="license-all"
            />
            <span>Alle Modelle (nicht-kommerziell)</span>
            <span className="choice-note">auch NC-Modelle; Ergebnisse werden markiert</span>
          </label>
        </fieldset>
        <fieldset className="choice-list">
          <legend className="control-label">ML-Modus</legend>
          {ML_MODES.map((m) => (
            <label key={m.value} className="choice">
              <input
                type="radio"
                name="mlmode"
                checked={mlMode === m.value}
                onChange={() => {
                  setMlMode(m.value);
                }}
                data-testid={`mlmode-${m.value}`}
              />
              <span>{m.label}</span>
              <span className="choice-note">{m.note}</span>
            </label>
          ))}
        </fieldset>
        <div className="service-status" data-testid="service-status">
          <span className={`status-dot ${service.state}`} />
          Dienst:{' '}
          {service.state === 'online'
            ? `verbunden (${service.info?.device ?? ''})`
            : service.state === 'offline'
              ? 'nicht erreichbar'
              : '–'}
          <button className="button small" onClick={() => void checkService()}>
            Prüfen
          </button>
        </div>
        {service.state === 'online' && service.info && (
          <table className="model-table">
            <thead>
              <tr>
                <th>Modell im Dienst</th>
                <th>Lizenz</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {service.info.models.map((m) => (
                <tr key={m.id}>
                  <td>{m.id}</td>
                  <td>
                    <LicenseBadge commercial={m.commercialUse} title={m.license} />
                  </td>
                  <td>{m.loaded ? 'geladen' : m.available ? 'bereit' : (m.note ?? 'nicht verfügbar')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="button-row">
          <button
            className="button"
            data-testid="open-models"
            onClick={() => {
              setOpen(false);
              useAppStore.getState().setModelsOpen(true);
            }}
          >
            Modelle verwalten …
          </button>
        </div>
        <p className="section-note">Modelle und Lizenzen: models/registry.json und MODELS.md.</p>
      </Modal>
      <Modal
        open={confirmAll}
        onOpenChange={setConfirmAll}
        title="Nicht-kommerzielle Modelle"
        testId="license-notice"
      >
        <p>
          Im Modus „Alle Modelle“ stehen auch Modelle zur Verfügung, deren Lizenz{' '}
          <strong>nur nicht-kommerzielle Nutzung</strong> erlaubt (z. B. BRIA RMBG). Bilder, die mit ihnen
          erzeugte Masken enthalten, dürfen ohne gesonderte Lizenz des Herstellers nicht verkauft oder
          kommerziell ausgestellt werden.
        </p>
        <p>
          Betroffene Ebenen tragen ein „NC“-Badge, und der Export warnt, solange solche Ergebnisse enthalten
          sind.
        </p>
        <div className="dialog-actions">
          <button
            className="button"
            onClick={() => {
              setConfirmAll(false);
            }}
          >
            Abbrechen
          </button>
          <button
            className="button primary"
            data-testid="license-notice-confirm"
            onClick={() => {
              markLicenseNoticeShown();
              setLicenseMode('all');
              setConfirmAll(false);
            }}
          >
            Verstanden, alle Modelle erlauben
          </button>
        </div>
      </Modal>
    </>
  );
}

// ---------- Export-Warnung ----------

export function ExportWarningDialog() {
  const warning = useAppStore((s) => s.exportWarning);
  const setWarning = useAppStore((s) => s.setExportWarning);
  const [working, setWorking] = useState(false);
  return (
    <Modal
      open={warning !== null}
      onOpenChange={(o) => {
        if (!o) setWarning(null);
      }}
      title="Export enthält nicht-kommerzielle Ergebnisse"
      testId="export-warning"
    >
      <p>Diese Ebenen verwenden Ergebnisse von Modellen, die nur nicht-kommerziell genutzt werden dürfen:</p>
      <ul className="warning-list">
        {warning?.layers.map((l) => (
          <li key={l.id}>
            <strong>{l.name}</strong> – {l.modelId} <LicenseBadge commercial={false} />
          </li>
        ))}
      </ul>
      <div className="dialog-actions">
        <button
          className="button"
          onClick={() => {
            setWarning(null);
          }}
        >
          Abbrechen
        </button>
        <button
          className="button"
          disabled={working}
          data-testid="export-recompute"
          onClick={() => {
            setWorking(true);
            const options = warning?.options;
            void recomputeWithCommercialModels().then((ok) => {
              setWorking(false);
              setWarning(null);
              if (ok) void exportConfirmed(options);
            });
          }}
        >
          Mit kommerziellen Modellen neu berechnen
        </button>
        <button
          className="button primary"
          data-testid="export-anyway"
          onClick={() => {
            const options = warning?.options;
            setWarning(null);
            void exportConfirmed(options);
          }}
        >
          Trotzdem exportieren
        </button>
      </div>
    </Modal>
  );
}

// ---------- Export ----------

const FORMATS: { value: ExportFormat; label: string; note: string }[] = [
  { value: 'png', label: 'PNG', note: 'verlustfrei, mit Transparenz' },
  { value: 'jpeg', label: 'JPEG', note: 'klein, ohne Transparenz (auf Weiß)' },
  { value: 'webp', label: 'WebP', note: 'klein, mit Transparenz' },
  { value: 'psd', label: 'PSD', note: 'Ebenen, Gruppen, Masken, Mischmodi' },
];

export function ExportDialog() {
  const open = useAppStore((s) => s.exportOpen);
  const setOpen = useAppStore((s) => s.setExportOpen);
  const [format, setFormat] = useState<ExportFormat>('png');
  const [quality, setQuality] = useState(92);
  const [originals, setOriginals] = useState(false);
  return (
    <Modal open={open} onOpenChange={setOpen} title="Exportieren" testId="export-dialog">
      <fieldset className="choice-list">
        <legend className="control-label">Format</legend>
        {FORMATS.map((f) => (
          <label key={f.value} className="choice">
            <input
              type="radio"
              name="export-format"
              checked={format === f.value}
              onChange={() => {
                setFormat(f.value);
              }}
              data-testid={`export-${f.value}`}
            />
            <span>{f.label}</span>
            <span className="choice-note">{f.note}</span>
          </label>
        ))}
      </fieldset>
      {(format === 'jpeg' || format === 'webp') && (
        <Slider
          label="Qualität"
          value={quality}
          min={10}
          max={100}
          defaultValue={92}
          step={1}
          unit="%"
          onChange={setQuality}
        />
      )}
      {format === 'psd' && (
        <label className="choice">
          <input
            type="checkbox"
            checked={originals}
            onChange={(e) => {
              setOriginals(e.target.checked);
            }}
            data-testid="export-originals"
          />
          <span>Unbearbeitete Originale als ausgeblendete Ebenen</span>
        </label>
      )}
      {format === 'psd' && (
        <p className="section-note">
          Ebenen enthalten ihre Effekte; Masken liegen zusätzlich als deaktivierte Ebenenmasken bei. Gruppen
          mit eigenen Effekten werden als eine Ebene gerendert.
        </p>
      )}
      <div className="dialog-actions">
        <button
          className="button"
          onClick={() => {
            setOpen(false);
          }}
        >
          Abbrechen
        </button>
        <button
          className="button primary"
          data-testid="export-start"
          onClick={() => {
            setOpen(false);
            void exportAs({ ...DEFAULT_EXPORT, format, quality: quality / 100, includeOriginals: originals });
          }}
        >
          Exportieren
        </button>
      </div>
    </Modal>
  );
}
