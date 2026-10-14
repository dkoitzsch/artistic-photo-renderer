import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { formatValue, positionToValue, quantize, valueToPosition, type SliderScale } from './scale';

export type SliderProps = {
  label: string;
  value: number;
  min: number;
  max: number;
  defaultValue: number;
  step?: number | undefined;
  scale?: SliderScale | undefined;
  unit?: string | undefined;
  hint?: string | undefined;
  /** gesture = true während des Ziehens (für zusammengefasste History-Einträge) */
  onChange: (value: number, gesture: boolean) => void;
  onGestureEnd?: (() => void) | undefined;
  testId?: string | undefined;
};

/**
 * Eigener Regler: dünne Spur, Füllung ab Standardwert, Wert als editierbare Zahl.
 * Doppelklick = Standardwert, Shift-Ziehen = fein, Pfeiltasten (Shift = ×10).
 */
export function Slider({
  label,
  value,
  min,
  max,
  defaultValue,
  step,
  scale = 'linear',
  unit,
  hint,
  onChange,
  onGestureEnd,
  testId,
}: SliderProps) {
  const s = step ?? (max - min <= 10 ? 0.01 : max - min <= 100 ? 0.1 : 1);
  const trackRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ startX: number; startPos: number; fine: boolean } | null>(null);
  const [editing, setEditing] = useState<string | null>(null);

  const pos = valueToPosition(value, min, max, scale);
  const defPos = valueToPosition(defaultValue, min, max, scale);
  const fillFrom = Math.min(pos, defPos);
  const fillTo = Math.max(pos, defPos);

  const emit = (t: number, gesture: boolean) => {
    const v = quantize(positionToValue(t, min, max, scale), s, min, max);
    if (v !== value) onChange(v, gesture);
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    const track = trackRef.current;
    if (!track || e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const rect = track.getBoundingClientRect();
    if (e.shiftKey) {
      drag.current = { startX: e.clientX, startPos: pos, fine: true };
    } else {
      drag.current = { startX: e.clientX, startPos: (e.clientX - rect.left) / rect.width, fine: false };
      emit(drag.current.startPos, true);
    }
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    const track = trackRef.current;
    if (!d || !track) return;
    const width = track.getBoundingClientRect().width;
    const fine = e.shiftKey;
    if (fine !== d.fine) {
      // Wechsel fein/grob während des Ziehens: neuer Bezugspunkt
      drag.current = { startX: e.clientX, startPos: pos, fine };
      return;
    }
    const dx = (e.clientX - d.startX) / width;
    emit(d.startPos + (fine ? dx / 10 : dx), true);
  };
  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    drag.current = null;
    e.currentTarget.releasePointerCapture(e.pointerId);
    onGestureEnd?.();
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const dir =
      e.key === 'ArrowRight' || e.key === 'ArrowUp'
        ? 1
        : e.key === 'ArrowLeft' || e.key === 'ArrowDown'
          ? -1
          : 0;
    if (!dir) return;
    e.preventDefault();
    const v = quantize(value + dir * s * (e.shiftKey ? 10 : 1), s, min, max);
    if (v !== value) onChange(v, false);
  };

  const commitText = () => {
    if (editing === null) return;
    const v = Number(editing.replace(',', '.'));
    setEditing(null);
    if (Number.isFinite(v)) {
      const q = quantize(v, s, min, max);
      if (q !== value) onChange(q, false);
    }
  };

  const shown = editing ?? formatValue(value, s);
  return (
    <div className="slider" data-testid={testId}>
      <div className="slider-head">
        <label className="slider-label" title={hint}>
          {label}
        </label>
        <span className="slider-value">
          <input
            className="slider-input"
            aria-label={`${label} Wert`}
            value={shown}
            onFocus={(e) => {
              setEditing(formatValue(value, s));
              e.currentTarget.select();
            }}
            onChange={(e) => {
              setEditing(e.target.value);
            }}
            onBlur={commitText}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
              if (e.key === 'Escape') {
                setEditing(null);
                e.currentTarget.blur();
              }
            }}
          />
          {unit && <span className="slider-unit">{unit}</span>}
        </span>
      </div>
      <div
        ref={trackRef}
        className="slider-track"
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={() => {
          if (value !== defaultValue) onChange(defaultValue, false);
        }}
        onKeyDown={onKeyDown}
        title="Doppelklick: Standardwert · Shift-Ziehen: fein"
      >
        <div className="slider-rail" />
        <div
          className="slider-fill"
          style={{ left: `${fillFrom * 100}%`, width: `${(fillTo - fillFrom) * 100}%` }}
        />
        <div className="slider-thumb" style={{ left: `${pos * 100}%` }} />
      </div>
    </div>
  );
}
