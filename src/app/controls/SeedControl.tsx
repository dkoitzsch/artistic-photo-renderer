// Seed (Startwert des Zufalls): Zahl eingeben oder neu würfeln. Gleicher Seed = gleiches Ergebnis.

export const MAX_SEED = 999_999;

export function randomSeed(): number {
  return 1 + Math.floor(Math.random() * MAX_SEED);
}

export function SeedControl({
  label,
  value,
  onChange,
  testId,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  testId?: string;
}) {
  return (
    <div className="control-row" data-testid={testId}>
      <span className="control-label" title="Gleicher Seed und gleiche Parameter ergeben dasselbe Bild">
        {label}
      </span>
      <span className="seed-control">
        <input
          className="seed-input"
          type="number"
          min={0}
          max={MAX_SEED}
          step={1}
          aria-label={`${label} Wert`}
          value={value}
          onChange={(e) => {
            const n = Math.floor(Number(e.target.value));
            if (Number.isFinite(n)) onChange(Math.min(MAX_SEED, Math.max(0, n)));
          }}
        />
        <button
          className="icon-button small"
          title="Neu würfeln"
          aria-label="Seed neu würfeln"
          data-testid={testId ? `${testId}-roll` : undefined}
          onClick={() => {
            onChange(randomSeed());
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
            <rect x="4" y="4" width="16" height="16" rx="3" />
            <circle cx="9" cy="9" r="1.2" fill="currentColor" />
            <circle cx="15" cy="15" r="1.2" fill="currentColor" />
            <circle cx="15" cy="9" r="1.2" fill="currentColor" />
            <circle cx="9" cy="15" r="1.2" fill="currentColor" />
          </svg>
        </button>
      </span>
    </div>
  );
}
