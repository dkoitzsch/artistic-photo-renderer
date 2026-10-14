// Parallax-Vorschau: Regler für Stärke und Achse; die Maus über der Leinwand verschiebt die Ebenen nach Tiefe.

import { useAppStore } from '../../state/store';
import { EnumControl } from '../controls/EnumControl';
import { Slider } from '../controls/Slider';

export function ParallaxPanel() {
  const parallax = useAppStore((s) => s.parallax);
  const setParallax = useAppStore((s) => s.setParallax);
  if (!parallax.enabled) return null;
  return (
    <div className="parallax-panel" data-testid="parallax-panel">
      <span className="parallax-title">Parallax-Vorschau</span>
      <Slider
        label="Stärke"
        value={parallax.strength}
        min={0}
        max={100}
        defaultValue={50}
        step={1}
        unit="%"
        onChange={(v) => {
          setParallax({ strength: v });
        }}
        testId="parallax-strength"
      />
      <EnumControl
        label="Achse"
        value={parallax.axis}
        options={[
          { value: 'both', label: 'Beide' },
          { value: 'horizontal', label: 'Horizontal' },
          { value: 'vertical', label: 'Vertikal' },
        ]}
        onChange={(v) => {
          setParallax({ axis: v as 'both' | 'horizontal' | 'vertical' });
        }}
      />
      <button
        className="button small"
        onClick={() => {
          setParallax({ enabled: false, pointer: [0, 0] });
        }}
      >
        Beenden
      </button>
    </div>
  );
}

/** Versatz-Vektor in Leinwand-px für die Engine (null = aus). */
export function parallaxVector(
  p: {
    enabled: boolean;
    strength: number;
    axis: 'both' | 'horizontal' | 'vertical';
    pointer: [number, number];
  },
  canvas: { width: number; height: number },
): [number, number] | null {
  if (!p.enabled) return null;
  // bis 8 % der langen Kante zwischen nächster und fernster Ebene
  const max = (p.strength / 100) * 0.08 * Math.max(canvas.width, canvas.height);
  const x = p.axis === 'vertical' ? 0 : p.pointer[0] * max;
  const y = p.axis === 'horizontal' ? 0 : p.pointer[1] * max;
  return [x, y];
}
