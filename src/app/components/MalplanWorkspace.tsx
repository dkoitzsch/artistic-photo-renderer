// Arbeitsbereich „Malplan“ (Spec „Effekte & Malvorlagen“, Abschnitt 7): links die Hilfen, in der Mitte die gewählte
// Hilfe, rechts die Einstellungen. Die Analyse läuft im Worker (src/malplan/store.ts).

import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { downloadBlob } from '../../io/export';
import { getEngine } from '../../render/runtime';
import { setMalplanCommand } from '../../state/commands';
import { useAppStore, useProject } from '../../state/store';
import {
  adaptCrop,
  clampCrop,
  COLORS_RANGE,
  FORMAT_PRESETS,
  HELPS,
  normalizeMalplan,
  orientFormat,
  SHAPES_RANGE,
  TECHNIQUES,
  type HelpId,
  type MalplanSettings,
  type Rect01,
} from '../../malplan/model';
import { renderHelp } from '../../malplan/render';
import { resetMalplan, updateMalplan, useMalplanStore } from '../../malplan/store';
import { EnumControl } from '../controls/EnumControl';
import { Slider } from '../controls/Slider';
import { Section } from './LayerSections';
import { BeamerButton, useBeamerSync } from './MalplanBeamer';
import { MyColorsSection, RecipeList } from './MalplanColors';
import { StepsSection, StrokesSection } from './MalplanPlan';
import { PdfButton } from './MalplanPdf';

function useSettings(): MalplanSettings | null {
  const project = useProject();
  return useMemo(() => (project ? normalizeMalplan(project.malplan, project.canvas) : null), [project]);
}

export function MalplanWorkspace() {
  const project = useProject();
  const projectId = project?.id ?? null;
  // Analyse nachführen (zusammengefasst, 250 ms Ruhe)
  useEffect(() => {
    if (!project) return;
    useMalplanStore.setState({ status: 'pending' });
    const t = setTimeout(() => void updateMalplan(project), 250);
    return () => {
      clearTimeout(t);
    };
  }, [project]);
  useEffect(() => resetMalplan, [projectId]);
  useBeamerSync();
  return (
    <div className="malplan-workspace" data-testid="malplan">
      <HelpList />
      <MalplanView />
      <aside className="sidepanel malplan-panel">
        <section className="panel-section">
          <h2 className="panel-title">Malplan</h2>
          <MalplanPanel />
        </section>
      </aside>
    </div>
  );
}

function HelpList() {
  const help = useAppStore((s) => s.malplanHelp);
  const setHelp = useAppStore((s) => s.setMalplanHelp);
  return (
    <nav className="malplan-helps" aria-label="Hilfen">
      {HELPS.map((h) => (
        <button
          key={h.id}
          className={`malplan-help${h.id === help ? ' active' : ''}`}
          aria-pressed={h.id === help}
          data-testid={`help-${h.id}`}
          onClick={() => {
            setHelp(h.id);
          }}
        >
          {h.label}
        </button>
      ))}
    </nav>
  );
}

function MalplanView() {
  const help = useAppStore((s) => s.malplanHelp);
  const cropEdit = useAppStore((s) => s.malplanCropEdit);
  const result = useMalplanStore((s) => s.result);
  const derived = useMalplanStore((s) => s.derived);
  const palette = useMalplanStore((s) => s.palette);
  const edges = useMalplanStore((s) => s.edges);
  const plan = useMalplanStore((s) => s.plan);
  const guide = useMalplanStore((s) => s.guide);
  const step = useAppStore((s) => s.malplanStep);
  const status = useMalplanStore((s) => s.status);
  const progress = useMalplanStore((s) => s.progress);
  const error = useMalplanStore((s) => s.error);
  const settings = useSettings();
  const ref = useRef<HTMLCanvasElement>(null);
  const image = useMemo(
    () =>
      settings ? renderHelp(help, result, derived, settings, { palette, edges, plan, guide, step }) : null,
    [help, result, derived, settings, palette, edges, plan, guide, step],
  );
  useEffect(() => {
    const c = ref.current;
    if (!c || !image) return;
    c.width = image.width;
    c.height = image.height;
    c.getContext('2d')?.drawImage(image, 0, 0);
  }, [image]);
  if (cropEdit && settings) return <CropEditor settings={settings} />;
  return (
    <div className="malplan-view">
      {image ? (
        <canvas ref={ref} className="malplan-image" data-testid="malplan-image" data-help={help} />
      ) : (
        <p className="panel-empty">{status === 'error' ? `Fehler: ${error ?? ''}` : 'Analyse läuft …'}</p>
      )}
      {(status === 'rendering' || status === 'analyzing') && (
        <div className="malplan-status" data-testid="malplan-busy">
          {status === 'rendering' ? 'Bild wird gerendert …' : `Analyse ${Math.round(progress * 100)} %`}
        </div>
      )}
      {status === 'ready' && <span hidden data-testid="malplan-ready" />}
    </div>
  );
}

/** Zuschnitt auf das Seitenverhältnis des Untergrunds: Rahmen verschieben (Fläche) oder skalieren (Ecken). */
function CropEditor({ settings }: { settings: MalplanSettings }) {
  const project = useProject();
  const [full, setFull] = useState<ImageData | null>(null);
  const ref = useRef<HTMLCanvasElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const drag = useRef<{ mode: 'move' | 'scale'; start: [number, number]; crop: Rect01 } | null>(null);
  const [crop, setCrop] = useState(settings.crop);
  useEffect(() => {
    if (!project) return;
    let alive = true;
    void getEngine()
      ?.renderRegionImage(project, { x: 0, y: 0, width: 1, height: 1 }, 1200)
      .then((img) => {
        if (alive) setFull(img);
      });
    return () => {
      alive = false;
    };
    // nur beim Öffnen
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    const c = ref.current;
    if (!c || !full) return;
    c.width = full.width;
    c.height = full.height;
    c.getContext('2d')?.putImageData(full, 0, 0);
  }, [full]);
  if (!project) return null;
  const aspect = settings.format.widthCm / settings.format.heightCm;
  const pos = (e: PointerEvent): [number, number] => {
    const r = box.current?.getBoundingClientRect();
    if (!r) return [0, 0];
    return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height];
  };
  const onDown = (e: PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    const mode = (e.target as HTMLElement).dataset.handle === 'scale' ? 'scale' : 'move';
    drag.current = { mode, start: pos(e), crop };
  };
  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const [x, y] = pos(e);
    const dx = x - d.start[0];
    const dy = y - d.start[1];
    if (d.mode === 'move') {
      setCrop(clampCrop({ ...d.crop, x: d.crop.x + dx, y: d.crop.y + dy }));
    } else {
      // Ecke rechts unten: Breite folgt der Maus, Höhe aus dem Seitenverhältnis
      const rel = aspect / (project.canvas.width / project.canvas.height);
      let w = Math.max(0.05, Math.min(1 - d.crop.x, d.crop.width + dx));
      let h = w / rel;
      if (d.crop.y + h > 1) {
        h = 1 - d.crop.y;
        w = h * rel;
      }
      setCrop(clampCrop({ ...d.crop, width: w, height: h }));
    }
  };
  const onUp = () => {
    if (!drag.current) return;
    drag.current = null;
    setMalplanCommand({ crop }, false, 'Zuschnitt geändert');
  };
  return (
    <div className="malplan-view">
      <div
        ref={box}
        className="malplan-crop"
        style={{ aspectRatio: `${project.canvas.width} / ${project.canvas.height}` }}
        onPointerMove={onMove}
        onPointerUp={onUp}
        data-testid="crop-editor"
      >
        <canvas ref={ref} className="malplan-crop-image" />
        <div
          className="malplan-crop-rect"
          data-testid="crop-rect"
          style={{
            left: `${crop.x * 100}%`,
            top: `${crop.y * 100}%`,
            width: `${crop.width * 100}%`,
            height: `${crop.height * 100}%`,
          }}
          onPointerDown={onDown}
        >
          <div className="malplan-crop-handle" data-testid="crop-handle" data-handle="scale" />
        </div>
      </div>
    </div>
  );
}

function MalplanPanel() {
  const project = useProject();
  const settings = useSettings();
  const help = useAppStore((s) => s.malplanHelp);
  const cropEdit = useAppStore((s) => s.malplanCropEdit);
  const setCropEdit = useAppStore((s) => s.setMalplanCropEdit);
  const result = useMalplanStore((s) => s.result);
  const derived = useMalplanStore((s) => s.derived);
  if (!project || !settings) return <p className="panel-empty">Kein Projekt geöffnet.</p>;
  const set = (patch: Partial<MalplanSettings>, gesture = false) => {
    setMalplanCommand(patch, gesture);
  };
  const canvasLandscape =
    settings.crop.width * project.canvas.width >= settings.crop.height * project.canvas.height;
  /** neues Format: Zuschnitt auf das neue Seitenverhältnis anpassen */
  const setFormat = (widthCm: number, heightCm: number, presetId: string | null) => {
    set({
      format: { widthCm, heightCm, presetId },
      crop: adaptCrop(settings.crop, project.canvas, widthCm / heightCm),
    });
  };
  const savePng = () => {
    const st = useMalplanStore.getState();
    const c = renderHelp(help, result, derived, settings, {
      ...st,
      step: useAppStore.getState().malplanStep,
    });
    if (!c) return;
    c.toBlob((blob) => {
      if (blob)
        downloadBlob(blob, `${project.name} – ${HELPS.find((h) => h.id === help)?.label ?? help}.png`);
    }, 'image/png');
  };
  const groups = [...new Set(FORMAT_PRESETS.map((f) => f.group))];
  return (
    <div className="malplan-settings">
      <Section title="Grundeinstellungen" testId="malplan-basics">
        <EnumControl
          label="Maltechnik"
          value={settings.technique}
          options={TECHNIQUES}
          onChange={(v) => {
            set({ technique: v as MalplanSettings['technique'] });
          }}
        />
        <div className="control-row">
          <span className="control-label">Format</span>
          <select
            className="select"
            aria-label="Format"
            data-testid="malplan-format"
            value={settings.format.presetId ?? 'custom'}
            onChange={(e) => {
              const f = FORMAT_PRESETS.find((p) => p.id === e.target.value);
              if (!f) return;
              const [w, h] = orientFormat(f.w, f.h, canvasLandscape);
              setFormat(w, h, f.id);
            }}
          >
            {groups.map((g) => (
              <optgroup key={g} label={g}>
                {FORMAT_PRESETS.filter((f) => f.group === g).map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.label}
                  </option>
                ))}
              </optgroup>
            ))}
            <option value="custom">Eigenes Format</option>
          </select>
        </div>
        <div className="control-row">
          <span className="control-label">Breite × Höhe</span>
          <span className="point-control">
            <input
              className="number-input"
              type="number"
              min={5}
              max={500}
              step={0.1}
              aria-label="Breite in cm"
              data-testid="malplan-width"
              value={settings.format.widthCm}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (v >= 5) setFormat(v, settings.format.heightCm, null);
              }}
            />
            ×
            <input
              className="number-input"
              type="number"
              min={5}
              max={500}
              step={0.1}
              aria-label="Höhe in cm"
              data-testid="malplan-height"
              value={settings.format.heightCm}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (v >= 5) setFormat(settings.format.widthCm, v, null);
              }}
            />
            cm
          </span>
        </div>
        <div className="button-row">
          <button
            className="button small"
            onClick={() => {
              setFormat(settings.format.heightCm, settings.format.widthCm, settings.format.presetId);
            }}
          >
            Hoch/Quer tauschen
          </button>
          <button
            className={`button small${cropEdit ? ' active' : ''}`}
            data-testid="crop-toggle"
            onClick={() => {
              setCropEdit(!cropEdit);
            }}
          >
            {cropEdit ? 'Zuschnitt fertig' : 'Zuschnitt wählen'}
          </button>
        </div>
      </Section>
      <Section title="Vereinfachung" testId="malplan-simplify">
        <Slider
          label="Anzahl Formen"
          value={settings.shapes}
          min={SHAPES_RANGE[0]}
          max={SHAPES_RANGE[1]}
          defaultValue={200}
          step={1}
          scale="log"
          onChange={(v, g) => {
            set({ shapes: Math.round(v) }, g);
          }}
          testId="malplan-shapes"
        />
        <Slider
          label="Anzahl Farben"
          value={settings.colors}
          min={COLORS_RANGE[0]}
          max={COLORS_RANGE[1]}
          defaultValue={12}
          step={1}
          onChange={(v, g) => {
            set({ colors: Math.round(v) }, g);
          }}
          testId="malplan-colors"
        />
        <p className="section-note">
          Wirkt auf alle Hilfen. Die Flächen werden aus dem aktuellen Ergebnis berechnet.
        </p>
      </Section>
      <MyColorsSection settings={settings} set={set} />
      <HelpSettings help={help} settings={settings} set={set} median={result?.median ?? null} />
      <Section title="Ausgabe" testId="malplan-output">
        <div className="button-row">
          <button className="button small" data-testid="malplan-png" onClick={savePng} disabled={!result}>
            Als PNG speichern
          </button>
          <PdfButton />
        </div>
      </Section>
      <Section title="Beamer" testId="malplan-beamer">
        <BeamerButton />
      </Section>
    </div>
  );
}

function HelpSettings({
  help,
  settings,
  set,
  median,
}: {
  help: HelpId;
  settings: MalplanSettings;
  set: (patch: Partial<MalplanSettings>, gesture?: boolean) => void;
  median: number | null;
}) {
  switch (help) {
    case 'steps':
      return <StepsSection />;
    case 'strokes':
      return <StrokesSection settings={settings} />;
    case 'edges':
      return (
        <Section title="Kanten-Karte" testId="malplan-edges">
          <p className="section-note edge-legend">
            <span className="edge-key hard" /> hart <span className="edge-key soft" /> weich{' '}
            <span className="edge-key lost" /> verloren – wo scharf und wo weich gemalt werden soll.
          </p>
          <Slider
            label="Verloren unter Kontrast"
            value={Math.round(settings.edges.lost * 100)}
            min={0}
            max={30}
            defaultValue={4}
            step={1}
            unit="%"
            onChange={(v, g) => {
              set({ edges: { ...settings.edges, lost: v / 100 } }, g);
            }}
            testId="malplan-edges-lost"
          />
          <Slider
            label="Hart bis Übergangsbreite"
            hint="Breite des Übergangs in % der langen Bildkante"
            value={settings.edges.hard}
            min={0.05}
            max={2}
            defaultValue={0.25}
            step={0.05}
            unit="%"
            onChange={(v, g) => {
              set({ edges: { ...settings.edges, hard: v } }, g);
            }}
            testId="malplan-edges-hard"
          />
        </Section>
      );
    case 'palette':
    case 'numbers':
      return (
        <Section title="Palette und Mischrezepte" testId="malplan-recipes">
          <p className="section-note">
            {settings.colors} Farben, gemischt aus „Meine Farben“. Farbfeld: links Soll, rechts Mischung.
          </p>
          <RecipeList />
        </Section>
      );
    case 'notan':
      return (
        <Section title="Notan" testId="malplan-notan">
          <Slider
            label="Schwelle"
            value={Math.round(settings.notan.threshold * 100)}
            min={0}
            max={100}
            defaultValue={50}
            step={1}
            unit="%"
            onChange={(v, g) => {
              set({ notan: { threshold: v / 100 } }, g);
            }}
            testId="malplan-threshold"
          />
          <button
            className="button small"
            disabled={median === null}
            onClick={() => {
              if (median !== null) set({ notan: { threshold: Math.round(median * 100) / 100 } });
            }}
          >
            Automatisch (Hälfte hell, Hälfte dunkel)
          </button>
          <MinArea settings={settings} set={set} />
        </Section>
      );
    case 'values':
    case 'scale':
      return (
        <Section title="Werteskizze" testId="malplan-values">
          <EnumControl
            label="Tonwertstufen"
            value={String(settings.values.levels)}
            options={[
              { value: '3', label: '3' },
              { value: '4', label: '4' },
              { value: '5', label: '5' },
            ]}
            onChange={(v) => {
              set({ values: { ...settings.values, levels: Number(v) as 3 | 4 | 5 } });
            }}
          />
          <MinArea settings={settings} set={set} />
        </Section>
      );
    case 'grid':
      return (
        <Section title="Proportionsraster" testId="malplan-grid">
          <EnumControl
            label="Teilung"
            value={settings.grid.mode}
            options={[
              { value: 'divisions', label: 'Felder' },
              { value: 'spacing', label: 'Abstand' },
            ]}
            onChange={(v) => {
              set({ grid: { ...settings.grid, mode: v as 'divisions' | 'spacing' } });
            }}
          />
          {settings.grid.mode === 'divisions' ? (
            <>
              <Slider
                label="Spalten"
                value={settings.grid.cols}
                min={1}
                max={12}
                defaultValue={4}
                step={1}
                onChange={(v, g) => {
                  set({ grid: { ...settings.grid, cols: Math.round(v) } }, g);
                }}
                testId="malplan-cols"
              />
              <Slider
                label="Zeilen"
                value={settings.grid.rows}
                min={1}
                max={12}
                defaultValue={4}
                step={1}
                onChange={(v, g) => {
                  set({ grid: { ...settings.grid, rows: Math.round(v) } }, g);
                }}
              />
            </>
          ) : (
            <Slider
              label="Abstand"
              value={settings.grid.spacingCm}
              min={1}
              max={20}
              defaultValue={5}
              step={0.5}
              unit="cm"
              onChange={(v, g) => {
                set({ grid: { ...settings.grid, spacingCm: v } }, g);
              }}
            />
          )}
        </Section>
      );
    case 'contour':
      return (
        <Section title="Konturvorlage" testId="malplan-contour">
          <Slider
            label="Linienstärke"
            value={settings.contour.lineWidthMm}
            min={0.1}
            max={1.5}
            defaultValue={0.35}
            step={0.05}
            unit="mm"
            onChange={(v, g) => {
              set({ contour: { ...settings.contour, lineWidthMm: v } }, g);
            }}
          />
          <EnumControl
            label="Kacheln auf"
            value={settings.contour.paper}
            options={[
              { value: 'A4', label: 'A4' },
              { value: 'A3', label: 'A3' },
            ]}
            onChange={(v) => {
              set({ contour: { ...settings.contour, paper: v as 'A4' | 'A3' } });
            }}
          />
          <Slider
            label="Überlappung"
            value={settings.contour.overlapCm}
            min={0}
            max={3}
            defaultValue={1}
            step={0.1}
            unit="cm"
            onChange={(v, g) => {
              set({ contour: { ...settings.contour, overlapCm: v } }, g);
            }}
          />
          <p className="section-note">
            Die Konturvorlage wird im PDF in Originalgröße ({settings.format.widthCm} ×{' '}
            {settings.format.heightCm} cm) auf {settings.contour.paper}-Blätter verteilt – beim Drucken
            „Tatsächliche Größe“ wählen.
          </p>
        </Section>
      );
    default:
      return null;
  }
}

function MinArea({
  settings,
  set,
}: {
  settings: MalplanSettings;
  set: (patch: Partial<MalplanSettings>, gesture?: boolean) => void;
}) {
  return (
    <Slider
      label="Mindestfläche"
      hint="Kleinere Flächen gehen in der Umgebung auf (Anteil der Bildfläche)"
      value={settings.values.minArea}
      min={0}
      max={3}
      defaultValue={0.2}
      step={0.05}
      unit="%"
      onChange={(v, g) => {
        set({ values: { ...settings.values, minArea: v } }, g);
      }}
      testId="malplan-minarea"
    />
  );
}
