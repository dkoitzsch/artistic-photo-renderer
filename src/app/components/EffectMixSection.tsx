// Mischmodus und eigene Maske eines Effekts (Spec „Effekte“ 2.2) sowie die Maske einer Gruppe (2.2a):
// Maske aus einem Bereich der Helligkeit/Kantenstärke/Tiefe/Salienz/Gesichter, aus einem Segment oder aus der Maske einer
// anderen Ebene, umkehrbar. Fehlende Karten aus Modellen werden automatisch berechnet (ml/analysis.ts).
// Bei Gruppen (und Effekten auf Gruppen) stammen Helligkeit und Kanten aus dem zusammengeführten Ergebnis.

import {
  endGesture,
  setEffectBlendCommand,
  setEffectMaskCommand,
  setGroupMaskCommand,
} from '../../state/commands';
import {
  findHost,
  walk,
  walkLayers,
  type BlendMode,
  type EffectInstance,
  type EffectMask,
  type Group,
  type Layer,
  type MaskMapId,
  type Project,
} from '../../state/project';
import { useProject } from '../../state/store';
import { EnumControl } from '../controls/EnumControl';
import { Slider } from '../controls/Slider';
import { Toggle } from '../controls/Toggle';
import { BLEND_OPTIONS, Section } from './LayerSections';

const MAP_LABEL: Record<MaskMapId, string> = {
  luminance: 'Helligkeit',
  edges: 'Kantenstärke',
  depth: 'Tiefe',
  saliency: 'Salienz',
  faces: 'Gesichter',
};

const MAP_HINT: Record<MaskMapId, string> = {
  luminance: '0 % = schwarz, 100 % = weiß',
  edges: '0 % = keine Kante, 100 % = starke Kante',
  depth: '0 % = nah, 100 % = fern',
  saliency: '0 % = unauffällig, 100 % = zieht den Blick an',
  faces: '0 % = kein Gesicht, 100 % = Gesicht',
};

/** Standardbereich je Karte beim Auswählen */
const MAP_DEFAULT: Record<MaskMapId, [number, number]> = {
  luminance: [0, 0.3],
  edges: [0, 0.3],
  depth: [0, 0.3],
  saliency: [0.5, 1],
  faces: [0.5, 1],
};

function encode(m: EffectMask | undefined): string {
  if (!m) return '';
  return m.kind === 'map'
    ? `map:${m.map}`
    : m.kind === 'segment'
      ? `segment:${m.segmentId}`
      : `layer:${m.layerId}`;
}

/** Auswahlmöglichkeiten der Maske: Kartenbereiche der Ebene bzw. des Gruppenergebnisses, Masken anderer Ebenen. */
function maskOptions(project: Project, ctx: { layer: Layer | null; group: Group | null }) {
  const options = [{ value: '', label: 'Keine' }];
  const suffix = ctx.group ? ' (Gruppenergebnis)' : '';
  options.push({ value: 'map:luminance', label: `Helligkeitsbereich${suffix}` });
  options.push({ value: 'map:edges', label: `Kantenbereich${suffix}` });
  const layers = ctx.layer
    ? [ctx.layer]
    : ctx.group
      ? [...walk(ctx.group)].filter((n) => n.kind === 'layer')
      : [];
  if (layers.length) {
    // Karten aus Modellen: werden bei Bedarf berechnet
    options.push({ value: 'map:depth', label: 'Tiefenbereich' });
    options.push({ value: 'map:saliency', label: 'Salienz (Blickfang)' });
    options.push({ value: 'map:faces', label: 'Gesichter' });
  }
  const originals = new Set(layers.map((l) => l.originalId));
  for (const seg of project.segments ?? [])
    if (originals.has(seg.originalId))
      options.push({ value: `segment:${seg.id}`, label: `Segment: ${seg.name}` });
  for (const l of walkLayers(project.root))
    if (l.id !== ctx.layer?.id) options.push({ value: `layer:${l.id}`, label: `Ebene: ${l.name}` });
  return options;
}

/** Auswahl und Einstellung einer Maske (Effekt oder Gruppe). */
export function MaskEditor({
  value,
  onChange,
  options,
  testId,
}: {
  value: EffectMask | undefined;
  onChange: (m: EffectMask | undefined, gesture: boolean) => void;
  options: { value: string; label: string }[];
  testId: string;
}) {
  const set = (m: EffectMask | undefined, gesture = false) => {
    onChange(m, gesture);
  };
  return (
    <>
      <div className="control-row">
        <span className="control-label">Maske</span>
        <select
          className="select"
          aria-label="Maske"
          data-testid={`${testId}-select`}
          value={encode(value)}
          onChange={(e) => {
            const v = e.target.value;
            if (!v) set(undefined);
            else if (v.startsWith('map:')) {
              const map = v.slice(4) as MaskMapId;
              const [from, to] = MAP_DEFAULT[map];
              set({ kind: 'map', map, from, to, feather: 0.05, invert: false });
            } else if (v.startsWith('segment:'))
              set({ kind: 'segment', segmentId: v.slice(8), invert: false });
            else set({ kind: 'layer', layerId: v.slice(6), invert: false });
          }}
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
      {value?.kind === 'map' && (
        <>
          <Slider
            label={`${MAP_LABEL[value.map]} von`}
            hint={MAP_HINT[value.map]}
            value={Math.round(value.from * 100)}
            min={0}
            max={100}
            defaultValue={Math.round(MAP_DEFAULT[value.map][0] * 100)}
            step={1}
            unit="%"
            onChange={(v, g) => {
              set({ ...value, from: Math.min(v / 100, value.to) }, g);
            }}
            onGestureEnd={endGesture}
            testId={`${testId}-from`}
          />
          <Slider
            label={`${MAP_LABEL[value.map]} bis`}
            value={Math.round(value.to * 100)}
            min={0}
            max={100}
            defaultValue={Math.round(MAP_DEFAULT[value.map][1] * 100)}
            step={1}
            unit="%"
            onChange={(v, g) => {
              set({ ...value, to: Math.max(v / 100, value.from) }, g);
            }}
            onGestureEnd={endGesture}
            testId={`${testId}-to`}
          />
          <Slider
            label="Weicher Rand"
            value={Math.round(value.feather * 100)}
            min={0}
            max={30}
            defaultValue={5}
            step={1}
            unit="%"
            onChange={(v, g) => {
              set({ ...value, feather: v / 100 }, g);
            }}
            onGestureEnd={endGesture}
          />
        </>
      )}
      {value && (
        <Toggle
          label="Maske umkehren"
          value={value.invert}
          onChange={(b) => {
            set({ ...value, invert: b });
          }}
        />
      )}
    </>
  );
}

export function EffectMixSection({ nodeId, effect }: { nodeId: string; effect: EffectInstance }) {
  const project = useProject();
  if (!project) return null;
  const found = findHost(project.root, nodeId);
  const host = found?.host;
  const hostLayer = found?.layer ?? (host && 'kind' in host && host.kind === 'layer' ? host : null);
  const hostGroup = !found?.layer && host && 'kind' in host && host.kind === 'group' ? host : null;
  return (
    <div className="effect-mix" data-testid="effect-mix">
      <EnumControl
        label="Mischmodus"
        value={effect.blendMode ?? 'normal'}
        options={BLEND_OPTIONS}
        onChange={(v) => {
          setEffectBlendCommand(nodeId, effect.instanceId, v as BlendMode);
        }}
      />
      <MaskEditor
        value={effect.mask}
        options={maskOptions(project, { layer: hostLayer, group: hostGroup })}
        testId="effect-mask"
        onChange={(m, g) => {
          setEffectMaskCommand(nodeId, effect.instanceId, m, g);
        }}
      />
    </div>
  );
}

/** Inspektor-Abschnitt „Maske der Gruppe“ (wirkt nach den Gruppeneffekten). */
export function GroupMaskSection({ group }: { group: Group }) {
  const project = useProject();
  if (!project) return null;
  return (
    <Section title="Maske der Gruppe" testId="group-mask" defaultOpen={group.mask !== undefined}>
      <p className="section-note">Die Gruppe wird zusammengeführt, ihre Effekte angewendet, dann maskiert.</p>
      <MaskEditor
        value={group.mask}
        options={maskOptions(project, { layer: null, group })}
        testId="group-mask"
        onChange={(m, g) => {
          setGroupMaskCommand(group.id, m, g);
        }}
      />
    </Section>
  );
}
