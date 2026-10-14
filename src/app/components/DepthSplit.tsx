// Aufteilen in Tiefenebenen: Histogramm mit verschiebbaren Grenzen, farbige Vorschau der Bänder, Preset.

import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { depthForDialog, splitDepth, type DepthResult } from '../../ml/depth';
import {
  histogram,
  kmeansBoundaries,
  MAX_LAYERS,
  MIN_LAYERS,
  moveBoundary,
  quantileBoundaries,
  type DepthPreset,
} from '../../ml/depthBands';
import { familiesFor, modelFor } from '../../ml/registry';
import { useAppStore } from '../../state/store';
import { EnumControl } from '../controls/EnumControl';
import { Slider } from '../controls/Slider';
import { LicenseBadge } from './LayerSections';

// Farben der Bänder (nah → fern), in Vorschau und Histogramm gleich
const BAND_COLORS = ['#e4572e', '#f3a712', '#a8c256', '#29bf9f', '#3e8ed0', '#6f5dd3', '#b05bc4', '#8a8f98'];

function Histogram({
  hist,
  boundaries,
  onMove,
}: {
  hist: Float64Array;
  boundaries: number[];
  onMove: (index: number, value: number) => void;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const W = 460;
  const H = 110;
  useEffect(() => {
    const c = ref.current;
    const ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = W * dpr;
    c.height = H * dpr;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, W, H);
    // Bänder
    for (let k = 0; k < boundaries.length - 1; k++) {
      ctx.fillStyle = `${BAND_COLORS[k % BAND_COLORS.length] ?? '#888'}22`;
      ctx.fillRect((boundaries[k] ?? 0) * W, 0, ((boundaries[k + 1] ?? 1) - (boundaries[k] ?? 0)) * W, H);
    }
    // Histogramm (Wurzel-Skala, damit kleine Klassen sichtbar bleiben)
    const max = Math.sqrt(Math.max(1, ...hist));
    const bw = W / hist.length;
    ctx.fillStyle = getComputedStyle(c).color;
    hist.forEach((v, i) => {
      const h = (Math.sqrt(v) / max) * (H - 6);
      ctx.fillRect(i * bw, H - h, Math.max(1, bw - 0.2), h);
    });
  }, [hist, boundaries]);

  const toValue = (e: PointerEvent<HTMLElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
  };

  return (
    <div
      className="histogram"
      style={{ width: W, height: H }}
      onPointerMove={(e) => {
        if (drag !== null) onMove(drag, toValue(e));
      }}
      onPointerUp={() => {
        setDrag(null);
      }}
      onPointerLeave={() => {
        setDrag(null);
      }}
      data-testid="depth-histogram"
    >
      <canvas ref={ref} style={{ width: W, height: H }} />
      {boundaries.slice(1, -1).map((b, i) => (
        <span
          key={i}
          className="histogram-handle"
          style={{ left: `${b * 100}%` }}
          title={`Grenze ${i + 1}: ${(b * 100).toFixed(0)} % (ziehen)`}
          data-testid={`boundary-${i + 1}`}
          onPointerDown={(e) => {
            e.currentTarget.parentElement?.setPointerCapture(e.pointerId);
            setDrag(i + 1);
          }}
        />
      ))}
      <span className="histogram-axis left">nah</span>
      <span className="histogram-axis right">fern</span>
    </div>
  );
}

function BandPreview({ depth, boundaries }: { depth: DepthResult; boundaries: number[] }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    const ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    const { data, width, height } = depth.preview;
    c.width = width;
    c.height = height;
    const img = ctx.createImageData(width, height);
    const rgb = BAND_COLORS.map((hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)));
    for (let i = 0; i < data.length; i++) {
      const d = data[i] ?? 0;
      let k = 0;
      while (k < boundaries.length - 2 && d >= (boundaries[k + 1] ?? 1)) k++;
      const col = rgb[k % rgb.length] ?? [128, 128, 128];
      // Helligkeit nach Tiefe, damit Struktur sichtbar bleibt
      const shade = 0.55 + 0.45 * (1 - d);
      img.data.set([(col[0] ?? 0) * shade, (col[1] ?? 0) * shade, (col[2] ?? 0) * shade, 255], i * 4);
    }
    ctx.putImageData(img, 0, 0);
  }, [depth, boundaries]);
  return <canvas ref={ref} className="band-preview" data-testid="band-preview" />;
}

const PRESETS = [
  { value: 'atmosphere', label: 'Unschärfe + Dunst' },
  { value: 'blur', label: 'Nur Unschärfe' },
  { value: 'none', label: 'Keine' },
];

export function DepthSplitPanel({ layerId, onDone }: { layerId: string; onDone: () => void }) {
  const licenseMode = useAppStore((s) => s.licenseMode);
  const service = useAppStore((s) => s.service);
  const families = familiesFor('depth');
  const [family, setFamily] = useState('depth-anything-small');
  const [depth, setDepth] = useState<DepthResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [n, setN] = useState(4);
  const [method, setMethod] = useState<'quantile' | 'kmeans'>('quantile');
  const [boundaries, setBoundaries] = useState<number[]>([]);
  const [overlap, setOverlap] = useState(16);
  const [preset, setPreset] = useState<DepthPreset>('atmosphere');
  const [maxBlur, setMaxBlur] = useState(40);
  const [maxHaze, setMaxHaze] = useState(50);

  const hist = useMemo(() => (depth ? histogram(depth.preview.data, 128) : null), [depth]);

  const resetBoundaries = (h: Float64Array, count: number, m: 'quantile' | 'kmeans') => {
    setBoundaries(m === 'quantile' ? quantileBoundaries(h, count) : kmeansBoundaries(h, count));
  };

  const compute = async (fam: string) => {
    setBusy(true);
    const r = await depthForDialog(layerId, fam);
    setBusy(false);
    if (!r) return;
    setDepth(r);
    resetBoundaries(histogram(r.preview.data, 128), n, method);
  };

  const available = (fam: string) => {
    const f = families.find((x) => x.family === fam);
    if (!f) return false;
    if (!f.commercialUse && licenseMode !== 'all') return false;
    if (modelFor(fam, 'browser', 'depth')) return true;
    const svc = modelFor(fam, 'service', 'depth');
    return (
      service.state === 'online' &&
      (service.info?.models.some((m) => m.id === svc?.id && m.available) ?? false)
    );
  };

  return (
    <div className="depth-split" data-testid="depth-split">
      <fieldset className="choice-list">
        <legend className="control-label">Tiefenmodell</legend>
        {families.map((f) => {
          const ok = available(f.family);
          return (
            <label key={f.family} className={`choice${ok ? '' : ' disabled'}`}>
              <input
                type="radio"
                name="depth-family"
                disabled={!ok}
                checked={family === f.family}
                onChange={() => {
                  setFamily(f.family);
                  setDepth(null);
                }}
                data-testid={`depth-family-${f.family}`}
              />
              <span>{f.name}</span>
              <LicenseBadge commercial={f.commercialUse} title={f.license} />
              <span className="choice-note">
                {modelFor(f.family, 'browser', 'depth') ? 'Browser oder Dienst' : 'nur im ML-Dienst'}
              </span>
            </label>
          );
        })}
      </fieldset>

      {!depth ? (
        <button
          className="button primary"
          disabled={busy || !available(family)}
          onClick={() => void compute(family)}
          data-testid="depth-compute"
        >
          {busy ? 'Tiefe wird berechnet …' : 'Tiefe berechnen'}
        </button>
      ) : (
        <>
          <div className="depth-preview-row">
            <BandPreview depth={depth} boundaries={boundaries} />
          </div>
          {hist && (
            <Histogram
              hist={hist}
              boundaries={boundaries}
              onMove={(i, v) => {
                setBoundaries((b) => moveBoundary(b, i, v));
              }}
            />
          )}
          <Slider
            label="Ebenen"
            value={n}
            min={MIN_LAYERS}
            max={MAX_LAYERS}
            defaultValue={4}
            step={1}
            onChange={(v) => {
              setN(v);
              if (hist) resetBoundaries(hist, v, method);
            }}
            testId="depth-layers"
          />
          <EnumControl
            label="Grenzen"
            value={method}
            options={[
              { value: 'quantile', label: 'Quantile' },
              { value: 'kmeans', label: 'k-Means' },
            ]}
            onChange={(v) => {
              const m = v as 'quantile' | 'kmeans';
              setMethod(m);
              if (hist) resetBoundaries(hist, n, m);
            }}
          />
          <Slider
            label="Ebenen-Überlappung"
            hint="Weicher Übergang zwischen den Ebenen, damit keine Lücken entstehen"
            value={overlap}
            min={0}
            max={64}
            defaultValue={16}
            step={1}
            unit="px"
            onChange={setOverlap}
          />
          <EnumControl
            label="Tiefen-Preset"
            value={preset}
            options={PRESETS}
            onChange={(v) => {
              setPreset(v as DepthPreset);
            }}
          />
          {preset !== 'none' && (
            <Slider
              label="Unschärfe fern"
              value={maxBlur}
              min={0}
              max={300}
              defaultValue={40}
              step={1}
              unit="px"
              scale="log"
              onChange={setMaxBlur}
            />
          )}
          {preset === 'atmosphere' && (
            <Slider
              label="Dunst fern"
              value={maxHaze}
              min={0}
              max={100}
              defaultValue={50}
              step={1}
              unit="%"
              onChange={setMaxHaze}
            />
          )}
          <p className="section-note">
            {depth.ref.provenance.modelId} · {(depth.ms / 1000).toFixed(1)} s · Grenzen im Histogramm ziehen
          </p>
        </>
      )}
      <div className="dialog-actions">
        <button className="button" onClick={onDone}>
          Abbrechen
        </button>
        <button
          className="button primary"
          disabled={!depth || boundaries.length < 3}
          data-testid="depth-start"
          onClick={() => {
            if (!depth) return;
            splitDepth(layerId, depth, { boundaries, overlap, preset, maxBlur, maxHaze });
            onDone();
          }}
        >
          In {boundaries.length > 1 ? boundaries.length - 1 : n} Ebenen aufteilen
        </button>
      </div>
    </div>
  );
}
