// Zweitbild-Parameter: Auswahl eines Originals aus dem Projekt („kein Bild“ = leer).

import { useProject } from '../../state/store';

export function ImageControl({
  label,
  value,
  onChange,
  testId,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  testId?: string;
}) {
  const project = useProject();
  const originals = project ? Object.values(project.originals) : [];
  return (
    <div className="control-row" data-testid={testId}>
      <span className="control-label">{label}</span>
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
    </div>
  );
}
