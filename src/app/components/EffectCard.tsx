import { useRef, useState, type DragEvent } from 'react';
import { parseCondition } from '../../effects/expr';
import { usePluginStore } from '../../effects/pluginStore';
import {
  applyPresetCommand,
  endGesture,
  removeEffectCommand,
  resetEffectCommand,
  setEffectEnabledCommand,
  setParamCommand,
  setStrengthCommand,
} from '../../state/commands';
import type { EffectInstance } from '../../state/project';
import { ParamControl } from '../controls/ParamControl';
import { Slider } from '../controls/Slider';
import {
  ChevronDownIcon,
  ChevronRightIcon,
  EyeIcon,
  EyeOffIcon,
  GripIcon,
  ResetIcon,
  TrashIcon,
} from './Icons';

export const EFFECT_DRAG_TYPE = 'application/x-bls-effect';

export function EffectCard({
  nodeId,
  effect,
  onDragStart,
  onDragOver,
  onDrop,
  dropIndicator,
}: {
  nodeId: string;
  effect: EffectInstance;
  onDragStart: (e: DragEvent) => void;
  onDragOver: (e: DragEvent) => void;
  onDrop: (e: DragEvent) => void;
  dropIndicator: 'before' | 'after' | null;
}) {
  const plugin = usePluginStore((s) => s.plugins[effect.effectId]);
  const [open, setOpen] = useState(true);
  const cardRef = useRef<HTMLDivElement>(null);
  const manifest = plugin?.manifest ?? null;
  const name = manifest?.name ?? effect.effectId;

  const visible = (key: string): boolean => {
    const cond = manifest?.visibleIf?.[key];
    if (!cond) return true;
    try {
      const c = parseCondition(cond);
      return c.test(effect.params[c.key] ?? manifest.params.find((p) => p.key === c.key)?.default);
    } catch {
      return true;
    }
  };

  let problem: string | null = null;
  if (!plugin) problem = `Plugin „${effect.effectId}“ fehlt – der Effekt wird übersprungen.`;
  else if (plugin.status === 'error') problem = plugin.errors.join('\n');
  else if (manifest && manifest.version !== effect.effectVersion)
    problem = `Gespeichert mit Version ${effect.effectVersion}, installiert ist ${manifest.version}.`;

  return (
    <div
      ref={cardRef}
      className={`effect-card${effect.enabled ? '' : ' disabled'}${dropIndicator ? ` drop-${dropIndicator}` : ''}`}
      data-testid={`effect-card-${effect.effectId}`}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <div className="effect-card-head">
        <span
          className="drag-handle"
          title="Ziehen zum Sortieren"
          draggable
          onDragStart={(e) => {
            if (cardRef.current) e.dataTransfer.setDragImage(cardRef.current, 16, 16);
            onDragStart(e);
          }}
        >
          <GripIcon />
        </span>
        <button
          className="effect-card-title"
          onClick={() => {
            setOpen(!open);
          }}
          aria-expanded={open}
        >
          {open ? <ChevronDownIcon /> : <ChevronRightIcon />}
          {name}
        </button>
        <span className="effect-card-actions">
          <button
            className="icon-button small"
            title={effect.enabled ? 'Ausschalten' : 'Einschalten'}
            aria-label={effect.enabled ? 'Effekt ausschalten' : 'Effekt einschalten'}
            onClick={() => {
              setEffectEnabledCommand(nodeId, effect.instanceId, !effect.enabled);
            }}
          >
            {effect.enabled ? <EyeIcon /> : <EyeOffIcon />}
          </button>
          <button
            className="icon-button small"
            title="Auf Standardwerte zurücksetzen"
            aria-label="Zurücksetzen"
            onClick={() => {
              resetEffectCommand(nodeId, effect.instanceId);
            }}
          >
            <ResetIcon />
          </button>
          <button
            className="icon-button small"
            title="Entfernen"
            aria-label="Effekt entfernen"
            onClick={() => {
              removeEffectCommand(nodeId, effect.instanceId);
            }}
          >
            <TrashIcon />
          </button>
        </span>
      </div>

      {problem && <p className="effect-problem">{problem}</p>}

      {open && manifest && (
        <div className="effect-card-body">
          {manifest.presets && manifest.presets.length > 0 && (
            <div className="control-row">
              <span className="control-label">Preset</span>
              <select
                className="select"
                aria-label="Preset"
                value=""
                onChange={(e) => {
                  const preset = manifest.presets?.find((p) => p.name === e.target.value);
                  if (preset) applyPresetCommand(nodeId, effect.instanceId, preset.name, preset.values);
                }}
              >
                <option value="" disabled>
                  Auswählen …
                </option>
                {manifest.presets.map((p) => (
                  <option key={p.name} value={p.name}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          {manifest.params
            .filter((p) => visible(p.key))
            .map((spec) => (
              <ParamControl
                key={spec.key}
                spec={spec}
                value={effect.params[spec.key]}
                onChange={(v, gesture) => {
                  setParamCommand(nodeId, effect.instanceId, spec.key, v, gesture);
                }}
                onGestureEnd={endGesture}
              />
            ))}
          <div className="effect-card-sep" />
          <Slider
            label="Mischung"
            hint="Mischung des Effekts mit seinem Eingang"
            value={Math.round(effect.strength * 100)}
            min={0}
            max={100}
            defaultValue={100}
            step={1}
            unit="%"
            onChange={(v, gesture) => {
              setStrengthCommand(nodeId, effect.instanceId, v / 100, gesture);
            }}
            onGestureEnd={endGesture}
            testId="param-strength"
          />
        </div>
      )}
    </div>
  );
}
