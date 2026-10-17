// Farbpalette: Farbfelder (Klick = Farbwähler), Farbe hinzufügen/entfernen.

import { MAX_PALETTE, type Rgb } from '../../effects/manifest';
import { parseHexColor } from '../../render/color';
import { toHex } from './ColorControl';

export function PaletteControl({
  label,
  value,
  onChange,
  testId,
}: {
  label: string;
  value: Rgb[];
  onChange: (v: Rgb[]) => void;
  testId?: string;
}) {
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
      </span>
    </div>
  );
}
