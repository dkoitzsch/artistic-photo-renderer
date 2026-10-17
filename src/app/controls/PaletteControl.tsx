// Farbpalette: Farbfelder (Klick = Farbwähler), Farbe hinzufügen/entfernen.

import { MAX_PALETTE, type Rgb } from '../../effects/manifest';
import { parseHexColor } from '../../render/color';
import { toHex } from './ColorControl';

export function PaletteControl({
  label,
  value,
  onChange,
  testId,
  extract,
}: {
  label: string;
  value: Rgb[];
  onChange: (v: Rgb[]) => void;
  testId?: string;
  /** Palette gleicher Größe aus der Ebene (ohne Datei) oder aus einer Bilddatei gewinnen */
  extract?: (count: number, file?: File) => Promise<Rgb[] | null>;
}) {
  const fromFile = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/jpeg,image/png,image/webp';
    input.addEventListener('change', () => {
      const f = input.files?.[0];
      if (f && extract) void extract(value.length, f).then((p) => p && onChange(p));
    });
    input.click();
  };
  return (
    <div className="control-row palette-row" data-testid={testId}>
      <span className="control-label">{label}</span>
      <span className="palette-control">
        {value.map((c, i) => (
          <input
            key={i}
            type="color"
            className="color-swatch palette-swatch"
            aria-label={`${label} Farbe ${i + 1}`}
            title={`${toHex(c).toUpperCase()} – Klick ändert, ⌥-Klick entfernt`}
            value={toHex(c)}
            onClick={(e) => {
              if (!e.altKey || value.length <= 1) return;
              e.preventDefault();
              onChange(value.filter((_, k) => k !== i));
            }}
            onChange={(e) => {
              onChange(value.map((x, k) => (k === i ? parseHexColor(e.target.value) : x)));
            }}
          />
        ))}
        {value.length < MAX_PALETTE && (
          <button
            className="icon-button small"
            title="Farbe hinzufügen"
            aria-label="Farbe hinzufügen"
            onClick={() => {
              onChange([...value, value[value.length - 1] ?? [0.5, 0.5, 0.5]]);
            }}
          >
            +
          </button>
        )}
        {value.length > 1 && (
          <button
            className="icon-button small"
            title="Letzte Farbe entfernen"
            aria-label="Letzte Farbe entfernen"
            onClick={() => {
              onChange(value.slice(0, -1));
            }}
          >
            −
          </button>
        )}
        {extract && (
          <>
            <button
              className="button small"
              title={`${value.length} Farben aus dem Bild dieser Ebene gewinnen`}
              data-testid={testId ? `${testId}-from-layer` : undefined}
              onClick={() => {
                void extract(value.length).then((p) => p && onChange(p));
              }}
            >
              Aus Ebene
            </button>
            <button
              className="button small"
              title={`${value.length} Farben aus einem Referenzbild gewinnen`}
              onClick={fromFile}
            >
              Aus Bild …
            </button>
          </>
        )}
      </span>
    </div>
  );
}
