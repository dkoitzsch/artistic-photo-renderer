import { parseHexColor } from '../../render/color';
import type { Rgb } from '../../effects/manifest';

const toHex = (c: Rgb) =>
  `#${c
    .map((x) =>
      Math.round(Math.min(1, Math.max(0, x)) * 255)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;

type EyeDropperCtor = new () => { open: () => Promise<{ sRGBHex: string }> };

/** Farbe (sRGB 0..1) mit Farbwähler und Pipette (EyeDropper-API von Chrome). */
export function ColorControl({
  label,
  value,
  onChange,
}: {
  label: string;
  value: Rgb;
  onChange: (v: Rgb) => void;
}) {
  const hex = toHex(value);
  const EyeDropper = (window as unknown as { EyeDropper?: EyeDropperCtor }).EyeDropper;
  return (
    <div className="control-row">
      <span className="control-label">{label}</span>
      <span className="color-control">
        <input
          type="color"
          className="color-swatch"
          aria-label={label}
          value={hex}
          onChange={(e) => {
            onChange(parseHexColor(e.target.value));
          }}
        />
        <span className="color-hex">{hex.toUpperCase()}</span>
        {EyeDropper && (
          <button
            className="icon-button small"
            title="Pipette: Farbe vom Bildschirm aufnehmen"
            aria-label="Pipette"
            onClick={() => {
              new EyeDropper()
                .open()
                .then((r) => {
                  onChange(parseHexColor(r.sRGBHex));
                })
                .catch(() => undefined);
            }}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
            >
              <path d="M14.5 5.5l4 4M17 3l4 4-3 3-4-4z" />
              <path d="M14 8l-9 9v3h3l9-9" />
            </svg>
          </button>
        )}
      </span>
    </div>
  );
}
