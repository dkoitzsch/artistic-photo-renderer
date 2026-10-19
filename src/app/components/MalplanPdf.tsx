// PDF-Malmappe (Spec 7.8): Seiten wählen, Papierformat, erstellen und herunterladen.

import { useState } from 'react';
import { downloadBlob } from '../../io/export';
import { normalizeMalplan, PDF_PAGES, type PaperSize } from '../../malplan/model';
import { buildMalmappe } from '../../malplan/pdfBook';
import { useMalplanStore } from '../../malplan/store';
import { setMalplanCommand } from '../../state/commands';
import { useAppStore, useProject } from '../../state/store';
import { EnumControl } from '../controls/EnumControl';

export function PdfButton() {
  const project = useProject();
  const result = useMalplanStore((s) => s.result);
  const derived = useMalplanStore((s) => s.derived);
  const status = useMalplanStore((s) => s.status);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!project) return null;
  const s = normalizeMalplan(project.malplan, project.canvas);
  const setPdf = (patch: Partial<typeof s.pdf>) => {
    setMalplanCommand({ pdf: { ...s.pdf, ...patch } });
  };
  const create = async () => {
    if (!result || !derived) return;
    setBusy(true);
    try {
      const st = useMalplanStore.getState();
      const bytes = await buildMalmappe(result, derived, s, project.name, st);
      downloadBlob(
        new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'application/pdf' }),
        `${project.name} – Malmappe.pdf`,
      );
    } catch (err) {
      useAppStore.getState().notify('error', `Malmappe: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <button
        className={`button small${open ? ' active' : ''}`}
        data-testid="pdf-toggle"
        onClick={() => {
          setOpen(!open);
        }}
      >
        PDF-Malmappe …
      </button>
      {open && (
        <div className="pdf-options" data-testid="pdf-options">
          {PDF_PAGES.map((pg) => (
            <label key={pg.id} className="pdf-page">
              <input
                type="checkbox"
                checked={s.pdf.pages[pg.id]}
                data-testid={`pdf-page-${pg.id}`}
                onChange={(e) => {
                  setPdf({ pages: { ...s.pdf.pages, [pg.id]: e.target.checked } });
                }}
              />
              {pg.label}
            </label>
          ))}
          <EnumControl
            label="Papier"
            value={s.pdf.paper}
            options={[
              { value: 'A4', label: 'A4' },
              { value: 'A3', label: 'A3' },
            ]}
            onChange={(v) => {
              setPdf({ paper: v as PaperSize });
            }}
          />
          <button
            className="button primary small"
            data-testid="pdf-create"
            disabled={busy || status !== 'ready' || !result || !derived}
            onClick={() => void create()}
          >
            {busy ? 'Erstelle …' : 'PDF erstellen'}
          </button>
          <p className="section-note">
            Die Konturvorlage nutzt das unter „Konturvorlage“ gewählte Blattformat ({s.contour.paper}).
          </p>
        </div>
      )}
    </>
  );
}
