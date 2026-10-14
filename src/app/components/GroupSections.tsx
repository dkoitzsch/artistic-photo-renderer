// Gruppen-Inspektor: Bearbeitungsmodus „Gruppe / Einzeln“ und gemeinsame Effekte der Kinder (Spec h).

import { usePluginStore } from '../../effects/pluginStore';
import {
  endGesture,
  setEditModeCommand,
  setGroupParamCommand,
  setGroupStrengthCommand,
} from '../../state/commands';
import type { EffectInstance, Group } from '../../state/project';
import { EnumControl } from '../controls/EnumControl';
import { ParamControl } from '../controls/ParamControl';
import { Slider } from '../controls/Slider';

function SharedEffect({
  group,
  effectId,
  instances,
}: {
  group: Group;
  effectId: string;
  instances: EffectInstance[];
}) {
  const manifest = usePluginStore((s) => s.plugins[effectId]?.manifest);
  const first = instances[0];
  if (!manifest || !first) return null;
  const decoupledCount = (key: string) => instances.filter((i) => i.decoupled?.includes(key)).length;
  return (
    <div className="effect-card shared" data-testid={`shared-${effectId}`}>
      <div className="effect-card-head">
        <span className="effect-card-title static">{manifest.name}</span>
        <span className="layer-meta">{instances.length} Ebenen</span>
      </div>
      <div className="effect-card-body">
        {manifest.params.map((spec) => {
          const d = decoupledCount(spec.key);
          const values = new Set(instances.map((i) => JSON.stringify(i.params[spec.key])));
          return (
            <div key={spec.key} className="shared-param">
              <ParamControl
                spec={spec}
                value={first.params[spec.key]}
                onChange={(v, g) => {
                  setGroupParamCommand(group.id, effectId, spec.key, v, g);
                }}
                onGestureEnd={endGesture}
              />
              {(values.size > 1 || d > 0) && (
                <p className="section-note">
                  {values.size > 1 ? 'Werte unterscheiden sich (angezeigt: erste Ebene)' : ''}
                  {values.size > 1 && d > 0 ? ' · ' : ''}
                  {d > 0 ? `${d} entkoppelt` : ''}
                </p>
              )}
            </div>
          );
        })}
        <Slider
          label="Mischung"
          value={Math.round(first.strength * 100)}
          min={0}
          max={100}
          defaultValue={100}
          step={1}
          unit="%"
          onChange={(v, g) => {
            setGroupStrengthCommand(group.id, effectId, v / 100, g);
          }}
          onGestureEnd={endGesture}
        />
      </div>
    </div>
  );
}

export function GroupEditSection({ group }: { group: Group }) {
  // Effekte, die in Kindern vorkommen (jeweils die erste Instanz je Kind)
  const byEffect = new Map<string, EffectInstance[]>();
  for (const child of group.children) {
    const seen = new Set<string>();
    for (const fx of child.effects) {
      if (seen.has(fx.effectId)) continue;
      seen.add(fx.effectId);
      byEffect.set(fx.effectId, [...(byEffect.get(fx.effectId) ?? []), fx]);
    }
  }
  return (
    <section className="inspector-section" data-testid="group-edit">
      <div className="inspector-section-head">
        <span className="inspector-section-title static">Bearbeitung der Kinder</span>
      </div>
      <div className="inspector-section-body">
        <EnumControl
          label="Modus"
          value={group.editMode}
          options={[
            { value: 'group', label: 'Gruppe' },
            { value: 'individual', label: 'Einzeln' },
          ]}
          onChange={(v) => {
            setEditModeCommand(group.id, v as 'group' | 'individual');
          }}
        />
        <p className="section-note">
          {group.editMode === 'group'
            ? 'Änderungen an einem Effekt wirken auf alle Ebenen der Gruppe mit diesem Effekt. Mit dem Schloss an einem Parameter einer Ebene bleibt deren Wert erhalten.'
            : 'Jede Ebene wird einzeln bearbeitet.'}
        </p>
        {group.editMode === 'group' &&
          [...byEffect.entries()].map(([effectId, instances]) => (
            <SharedEffect key={effectId} group={group} effectId={effectId} instances={instances} />
          ))}
      </div>
    </section>
  );
}
