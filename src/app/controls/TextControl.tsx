import { useState } from 'react';

/** Freier Text (Parametertyp "text"): übernimmt beim Verlassen des Felds oder mit Enter. */
export function TextControl({
  label,
  value,
  maxLength,
  onChange,
  testId,
}: {
  label: string;
  value: string;
  maxLength: number;
  onChange: (v: string) => void;
  testId?: string | undefined;
}) {
  // null = nicht in Bearbeitung (Anzeige folgt dem Projektwert, z. B. nach Undo)
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft === null) return;
    const v = Array.from(draft).slice(0, maxLength).join('');
    setDraft(null);
    if (v !== value) onChange(v);
  };
  return (
    <label className="control-row text-control" data-testid={testId}>
      <span className="control-label">{label}</span>
      <input
        className="text-input"
        type="text"
        value={draft ?? value}
        maxLength={maxLength}
        aria-label={label}
        onChange={(e) => {
          setDraft(e.target.value);
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit();
          }
        }}
      />
    </label>
  );
}
