// Mischmodus und eigene Maske eines Effekts (Spec „Effekte“ 2.2): Maske aus einem Bereich der Helligkeit/Tiefe
// der Ebene oder aus der Maske einer anderen Ebene, jeweils umkehrbar.

import { endGesture, setEffectBlendCommand, setEffectMaskCommand } from '../../state/commands';
import {
  findHost,
  walkLayers,
  type BlendMode,
  type EffectInstance,
  type EffectMask,
  type MaskMapId,
} from '../../state/project';
import { useProject } from '../../state/store';
import { EnumControl } from '../controls/EnumControl';
import { Slider } from '../controls/Slider';
import { Toggle } from '../controls/Toggle';
import { BLEND_OPTIONS } from './LayerSections';

const MAP_LABEL: Record<MaskMapId, string> = { luminance: 'Helligkeit', depth: 'Tiefe' };

function encode(m: EffectMask | undefined): string {
  if (!m) return '';
  return m.kind === 'map' ? `map:${m.map}` : `layer:${m.layerId}`;
}

export function EffectMixSection({ nodeId, effect }: { nodeId: string; effect: EffectInstance }) {
  const project = useProject();
  if (!project) return null;
  const found = findHost(project.root, nodeId);
  const hostLayer =
    found?.layer ?? (found && 'kind' in found.host && found.host.kind === 'layer' ? found.host : null);
  const mask = effect.mask;
  const set = (m: EffectMask | undefined, gesture = false) => {
    setEffectMaskCommand(nodeId, effect.instanceId, m, gesture);
  };

  const options = [{ value: '', label: 'Keine (ganze Ebene)' }];
  if (hostLayer) {
    options.push({ value: 'map:luminance', label: 'Helligkeitsbereich' });
    if (hostLayer.depthMap || hostLayer.mask.kind === 'depth')
      options.push({ value: 'map:depth', label: 'Tiefenbereich' });
  }
  for (const l of walkLayers(project.root))
    if (l.id !== hostLayer?.id) options.push({ value: `layer:${l.id}`, label: `Ebene: ${l.name}` });

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
      <div className="control-row">
        <span className="control-label">Maske</span>
        <select
          className="select"
          aria-label="Effektmaske"
          data-testid="effect-mask-select"
          value={encode(mask)}
          onChange={(e) => {
            const v = e.target.value;
            if (!v) set(undefined);
            else if (v.startsWith('map:'))
              set({
                kind: 'map',
                map: v.slice(4) as MaskMapId,
                from: 0,
                to: 0.3,
                feather: 0.05,
                invert: false,
              });
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
      {mask?.kind === 'map' && (
        <>
          <Slider
            label={`${MAP_LABEL[mask.map]} von`}
            hint={mask.map === 'depth' ? '0 % = nah, 100 % = fern' : '0 % = schwarz, 100 % = weiß'}
            value={Math.round(mask.from * 100)}
            min={0}
            max={100}
            defaultValue={0}
            step={1}
            unit="%"
            onChange={(v, g) => {
              set({ ...mask, from: Math.min(v / 100, mask.to) }, g);
            }}
            onGestureEnd={endGesture}
            testId="effect-mask-from"
          />
          <Slider
            label={`${MAP_LABEL[mask.map]} bis`}
            value={Math.round(mask.to * 100)}
            min={0}
            max={100}
            defaultValue={30}
            step={1}
            unit="%"
            onChange={(v, g) => {
              set({ ...mask, to: Math.max(v / 100, mask.from) }, g);
            }}
            onGestureEnd={endGesture}
            testId="effect-mask-to"
          />
          <Slider
            label="Weicher Rand"
            value={Math.round(mask.feather * 100)}
            min={0}
            max={30}
            defaultValue={5}
            step={1}
            unit="%"
            onChange={(v, g) => {
              set({ ...mask, feather: v / 100 }, g);
            }}
            onGestureEnd={endGesture}
          />
        </>
      )}
      {mask && (
        <Toggle
          label="Maske umkehren"
          value={mask.invert}
          onChange={(b) => {
            set({ ...mask, invert: b });
          }}
        />
      )}
    </div>
  );
}
