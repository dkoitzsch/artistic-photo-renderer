// Abschnitte des Inspektors für Ebenen: Eigenschaften, Maske/Kantenübergang, Fokuspunkte, Schatten.

import { useState, type ReactNode } from 'react';
import { parseCondition } from '../../effects/expr';
import { usePluginStore } from '../../effects/pluginStore';
import { modelById } from '../../ml/registry';
import { detectFocusForLayer } from '../../ml/split';
import {
  endGesture,
  removeFocusPointCommand,
  setFocusMapCommand,
  setHoleFillCommand,
  setMaskEdgeCommand,
  setNodeBlendCommand,
  setNodeOpacityCommand,
  setShadowCommand,
  setShadowParamCommand,
  updateFocusPointCommand,
  resetLayerCommand,
} from '../../state/commands';
import type { BlendMode, Layer, MaskEdge, SceneNode } from '../../state/project';
import { useAppStore } from '../../state/store';
import { EnumControl } from '../controls/EnumControl';
import { ParamControl } from '../controls/ParamControl';
import { Slider } from '../controls/Slider';
import { Toggle } from '../controls/Toggle';
import { ChevronDownIcon, ChevronRightIcon, TrashIcon } from './Icons';

export const BLEND_OPTIONS: { value: BlendMode; label: string }[] = [
  { value: 'normal', label: 'Normal' },
  { value: 'multiply', label: 'Multiplizieren' },
  { value: 'screen', label: 'Negativ multiplizieren' },
  { value: 'overlay', label: 'Ineinanderkopieren' },
  { value: 'soft-light', label: 'Weiches Licht' },
  { value: 'lighten', label: 'Aufhellen' },
  { value: 'darken', label: 'Abdunkeln' },
  { value: 'difference', label: 'Differenz' },
];

export function Section({
  title,
  children,
  defaultOpen = true,
  testId,
  aside,
}: {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
  testId?: string;
  aside?: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="inspector-section" data-testid={testId}>
      <div className="inspector-section-head">
        <button
          className="inspector-section-title"
          aria-expanded={open}
          onClick={() => {
            setOpen(!open);
          }}
        >
          {open ? <ChevronDownIcon /> : <ChevronRightIcon />}
          {title}
        </button>
        {aside}
      </div>
      {open && <div className="inspector-section-body">{children}</div>}
    </section>
  );
}

export function LicenseBadge({ commercial, title }: { commercial: boolean; title?: string }) {
  return (
    <span className={`license-badge ${commercial ? 'commercial' : 'nc'}`} title={title}>
      {commercial ? 'kommerziell' : 'NC'}
    </span>
  );
}

export function NodeSection({ node, isRoot }: { node: SceneNode; isRoot: boolean }) {
  const openSplit = useAppStore((s) => s.openSplitDialog);
  const busy = useAppStore((s) => s.tasks.length > 0);
  return (
    <Section title="Eigenschaften" testId="node-section">
      {!isRoot && (
        <>
          <Slider
            label="Deckkraft"
            value={Math.round(node.opacity * 100)}
            min={0}
            max={100}
            defaultValue={100}
            step={1}
            unit="%"
            onChange={(v, g) => {
              setNodeOpacityCommand(node.id, v / 100, g);
            }}
            onGestureEnd={endGesture}
            testId="node-opacity"
          />
          <EnumControl
            label="Mischmodus"
            value={node.blendMode}
            options={BLEND_OPTIONS}
            onChange={(v) => {
              setNodeBlendCommand(node.id, v as BlendMode);
            }}
          />
        </>
      )}
      {node.kind === 'layer' && (
        <button
          className="button"
          disabled={busy}
          onClick={() => {
            openSplit(node.id);
          }}
          data-testid="split-button"
        >
          Aufteilen …
        </button>
      )}
      {node.kind === 'layer' && (
        <button
          className="button"
          onClick={() => {
            resetLayerCommand(node.id);
          }}
          data-testid="reset-layer"
          title="Maske und Effekte des Ausgangszustands wiederherstellen"
        >
          Auf Original zurücksetzen
        </button>
      )}
    </Section>
  );
}

const CURVES = [
  { value: 'linear', label: 'Linear' },
  { value: 'smooth', label: 'Weich' },
  { value: 'steep', label: 'Steil' },
];

export function MaskSection({ layer }: { layer: Layer }) {
  const mask = layer.mask;
  if (mask.kind !== 'stored') return null;
  const model = modelById(mask.provenance.modelId);
  const edge = layer.maskEdge;
  const set = (patch: Partial<MaskEdge>, gesture: boolean) => {
    setMaskEdgeCommand(layer.id, patch, gesture);
  };
  return (
    <Section
      title="Maske"
      testId="mask-section"
      aside={
        <LicenseBadge
          commercial={mask.provenance.commercialUse}
          title={`Erzeugt mit ${model?.name ?? mask.provenance.modelId}`}
        />
      }
    >
      <p className="section-note">
        {mask.inverted ? 'Invertierte ' : ''}Maske von {model?.name ?? mask.provenance.modelId}
        {model ? ` (${model.runtime === 'service' ? 'Dienst' : 'Browser'})` : ''}
      </p>
      <Toggle
        label="Lochfüllung"
        value={layer.holeFill}
        onChange={(v) => {
          setHoleFillCommand(layer.id, v);
        }}
      />
      {layer.holeFill ? (
        <p className="section-note">
          Der ausgeblendete Bereich wird aus der Umgebung aufgefüllt; die Ebene ist deckend.
        </p>
      ) : (
        <>
          <Slider
            label="Kantenhärte"
            hint="0 = hart (binär mit Antialiasing) … 100 = bis 150 px weich"
            value={edge.hardness}
            min={0}
            max={100}
            defaultValue={4}
            step={1}
            onChange={(v, g) => {
              set({ hardness: v }, g);
            }}
            onGestureEnd={endGesture}
            testId="edge-hardness"
          />
          <Slider
            label="Kantenversatz"
            hint="Maske schrumpfen (−) oder erweitern (+)"
            value={edge.offset}
            min={-30}
            max={30}
            defaultValue={0}
            step={0.5}
            unit="px"
            onChange={(v, g) => {
              set({ offset: v }, g);
            }}
            onGestureEnd={endGesture}
            testId="edge-offset"
          />
          <EnumControl
            label="Verlaufskurve"
            value={edge.curve}
            options={CURVES}
            onChange={(v) => {
              set({ curve: v as MaskEdge['curve'] }, false);
            }}
          />
        </>
      )}
    </Section>
  );
}

export function FocusSection({ layer }: { layer: Layer }) {
  const tool = useAppStore((s) => s.tool);
  const setTool = useAppStore((s) => s.setTool);
  const busy = useAppStore((s) => s.tasks.length > 0);
  const points = layer.focusMap?.points ?? [];
  return (
    <Section
      key={points.length > 0 ? 'mit' : 'ohne'}
      title="Fokuspunkte"
      testId="focus-section"
      defaultOpen={points.length > 0}
    >
      {points.length === 0 && (
        <p className="section-note">
          Noch keine Fokuspunkte. Erkennen oder mit dem Fokuspunkt-Werkzeug setzen.
        </p>
      )}
      <ul className="focus-list">
        {points.map((pt) => (
          <li key={pt.id} className="focus-item">
            <label className="focus-item-head">
              <input
                type="checkbox"
                checked={pt.enabled}
                onChange={(e) => {
                  updateFocusPointCommand(layer.id, pt.id, { enabled: e.target.checked }, false);
                }}
              />
              <span>{pt.label}</span>
              <button
                className="icon-button small"
                aria-label={`${pt.label} entfernen`}
                onClick={() => {
                  removeFocusPointCommand(layer.id, pt.id);
                }}
              >
                <TrashIcon />
              </button>
            </label>
            <Slider
              label="Radius"
              value={pt.radius}
              min={4}
              max={1500}
              defaultValue={pt.radius}
              step={1}
              unit="px"
              scale="log"
              onChange={(v, g) => {
                updateFocusPointCommand(layer.id, pt.id, { radius: v }, g);
              }}
              onGestureEnd={endGesture}
            />
          </li>
        ))}
      </ul>
      <div className="button-row">
        <button
          className="button"
          disabled={busy}
          onClick={() => void detectFocusForLayer(layer.id)}
          data-testid="detect-focus"
        >
          Erkennen
        </button>
        <button
          className={`button${tool === 'focus' ? ' active' : ''}`}
          onClick={() => {
            setTool(tool === 'focus' ? 'move' : 'focus');
          }}
        >
          {tool === 'focus' ? 'Setzen beenden' : 'Punkte setzen'}
        </button>
        {points.length > 0 && (
          <button
            className="button"
            onClick={() => {
              setFocusMapCommand(layer.id, undefined, 'Fokuspunkte entfernt');
            }}
          >
            Alle entfernen
          </button>
        )}
      </div>
    </Section>
  );
}

export function ShadowSection({ layer }: { layer: Layer }) {
  const select = useAppStore((s) => s.select);
  const has = layer.shadow !== undefined;
  return (
    <Section title="Schatten" testId="shadow-section" defaultOpen={has}>
      <Toggle
        label="Schatten-Layer"
        value={has}
        onChange={(v) => {
          setShadowCommand(layer.id, v);
        }}
      />
      {layer.shadow && (
        <>
          <ShadowParams layer={layer} />
          <button
            className="button"
            onClick={() => {
              if (layer.shadow) select(layer.shadow.id);
            }}
          >
            Effekte des Schattens …
          </button>
        </>
      )}
    </Section>
  );
}

/** Parameter des Schatten-Plugins + Deckkraft/Mischmodus des Schatten-Layers. */
export function ShadowParams({ layer }: { layer: Layer }) {
  const manifest = usePluginStore((s) => s.plugins.shadow?.manifest);
  const sh = layer.shadow;
  if (!sh) return null;
  if (!manifest) return <p className="effect-problem">Das Schatten-Plugin fehlt.</p>;
  return (
    <div className="shadow-params" data-testid="shadow-params">
      {manifest.params
        .filter((p) => {
          const cond = manifest.visibleIf?.[p.key];
          if (!cond) return true;
          const c = parseCondition(cond);
          return c.test(sh.params[c.key] ?? manifest.params.find((x) => x.key === c.key)?.default);
        })
        .map((spec) => (
          <ParamControl
            key={spec.key}
            spec={spec}
            value={sh.params[spec.key]}
            onChange={(v, g) => {
              setShadowParamCommand(layer.id, spec.key, v, g);
            }}
            onGestureEnd={endGesture}
          />
        ))}
      <Slider
        label="Deckkraft"
        value={Math.round(sh.opacity * 100)}
        min={0}
        max={100}
        defaultValue={65}
        step={1}
        unit="%"
        onChange={(v, g) => {
          setNodeOpacityCommand(sh.id, v / 100, g);
        }}
        onGestureEnd={endGesture}
        testId="shadow-opacity"
      />
      <EnumControl
        label="Mischmodus"
        value={sh.blendMode}
        options={BLEND_OPTIONS}
        onChange={(v) => {
          setNodeBlendCommand(sh.id, v as BlendMode);
        }}
      />
    </div>
  );
}
