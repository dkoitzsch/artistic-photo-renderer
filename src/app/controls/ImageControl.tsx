// Zweitbild-Parameter: Auswahl eines Originals aus dem Projekt („kein Bild“ = leer) oder neues Bild laden.

import { ACCEPTED_TYPES, importOriginal } from '../../io/import';
import { useAppStore, useProject } from '../../state/store';

export function ImageControl({
  label,
  value,
  onChange,
  testId,
  notice,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  testId?: string;
  /** Hinweis beim Laden eines Bildes (z. B. Lizenz von Stilbildern) */
  notice?: string | undefined;
}) {
  const project = useProject();
  const originals = project ? Object.values(project.originals) : [];
  const load = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = ACCEPTED_TYPES.join(',');
    input.addEventListener('change', () => {
      const f = input.files?.[0];
      if (f)
        void importOriginal(f).then((o) => {
          if (!o) return;
          onChange(o.id);
          if (notice) useAppStore.getState().notify('info', notice);
        });
    });
    input.click();
  };
  return (
    <div className="control-row" data-testid={testId}>
      <span className="control-label">{label}</span>
      <span className="image-control">
        <select
          className="select"
          aria-label={label}
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
          }}
        >
          <option value="">– kein Bild –</option>
          {originals.map((o) => (
            <option key={o.id} value={o.id}>
              {o.fileName}
            </option>
          ))}
        </select>
        <button
          className="button small"
          title="Weiteres Bild laden (wird im Projekt gespeichert)"
          data-testid={testId ? `${testId}-load` : undefined}
          onClick={load}
        >
          Laden …
        </button>
      </span>
    </div>
  );
}
