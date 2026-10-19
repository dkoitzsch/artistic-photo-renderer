// Dialog „Stil je Bereich“ (Spec „Effekte“ 5.8): je Bereich (Rest/Hintergrund, Segmente, Tiefenbereiche) ein Effekt
// (optional mit Preset) oder ein Stapel-Preset. Anwenden baut die Gruppe (state/regions.ts) und bestimmt danach die
// Tiefe der Bereichsebenen für die Parallax-Vorschau.

import { useState } from 'react';
import { defaultParams } from '../../effects/manifest';
import { usePluginStore } from '../../effects/pluginStore';
import { computeMap } from '../../ml/analysis';
import { startTask } from '../../ml/split';
import { assignRegionDepths } from '../../ml/styleRegions';
import { instancesFrom } from '../../presets/model';
import { usePresetStore } from '../../presets/store';
import { styleRegionsCommand } from '../../state/commands';
import { findNode, newId, type EffectInstance } from '../../state/project';
import type { RegionSource, RegionSpec } from '../../state/regions';
import { useAppStore, useProject } from '../../state/store';
import { Slider } from '../controls/Slider';
import { Modal } from './Dialogs';

type Row = { key: string; include: boolean; name: string; source: RegionSource; choice: string };

export function StyleRegionsDialog() {
  const layerId = useAppStore((s) => s.styleRegionsLayerId);
  const close = useAppStore((s) => s.openStyleRegions);
  const project = useProject();
  const node = project && layerId ? findNode(project.root, layerId) : undefined;
  const layer = node?.kind === 'layer' ? node : undefined;
  return (
    <Modal
      open={layer !== undefined}
      onOpenChange={(o) => {
        if (!o) close(null);
      }}
      title={`Stil je Bereich: ${layer?.name ?? ''}`}
      testId="style-regions-dialog"
      wide
    >
      {layer && (
        <RegionsForm
          key={layer.id}
          layerId={layer.id}
          onDone={() => {
            close(null);
          }}
        />
      )}
    </Modal>
  );
}

function RegionsForm({ layerId, onDone }: { layerId: string; onDone: () => void }) {
  const project = useProject();
  const licenseMode = useAppStore((s) => s.licenseMode);
  const plugins = usePluginStore((s) => s.plugins);
  const stacks = usePresetStore((s) => s.stacks);
  const node = project ? findNode(project.root, layerId) : undefined;
  const layer = node?.kind === 'layer' ? node : undefined;
  const segments = (project?.segments ?? []).filter((s) => s.originalId === layer?.originalId);
  const [rows, setRows] = useState<Row[]>(() => [
    { key: 'rest', include: true, name: 'Hintergrund', source: { kind: 'rest' }, choice: '' },
    ...segments.map((s) => ({
      key: s.id,
      include: true,
      name: s.name,
      source: { kind: 'segment' as const, segmentId: s.id },
      choice: '',
    })),
  ]);
  const [busy, setBusy] = useState(false);
  if (!project || !layer) return null;
  const hasDepth = !!(
    layer.depthMap ??
    (layer.mask.kind === 'depth' ? layer.mask : null) ??
    project.analysis?.[layer.originalId]?.depth
  );

  const effects = Object.values(plugins)
    .map((p) => p.manifest)
    .filter((m): m is NonNullable<typeof m> => !!m && m.id !== 'shadow' && !m.id.startsWith('zz-'))
    .filter((m) => m.license.commercialUse || licenseMode === 'all')
    .sort((a, b) => a.name.localeCompare(b.name, 'de'));

  const instancesOf = (choice: string): EffectInstance[] => {
    if (choice.startsWith('stack:')) {
      const st = stacks.find((s) => s.id === choice.slice(6));
      return st ? instancesFrom(st.effects, newId) : [];
    }
    if (!choice.startsWith('fx:')) return [];
    const [id = '', preset] = choice.slice(3).split('|');
    const m = plugins[id]?.manifest;
    if (!m) return [];
    const values = preset ? (m.presets?.find((p) => p.name === preset)?.values ?? {}) : {};
    return [
      {
        instanceId: newId(),
        effectId: id,
        effectVersion: m.version,
        enabled: true,
        strength: 1,
        params: { ...defaultParams(m), ...values },
        region: 'whole',
      },
    ];
  };

  const update = (key: string, patch: Partial<Row>) => {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  };

  const apply = () => {
    const regions: RegionSpec[] = rows
      .filter((r) => r.include)
      .map((r) => ({ name: r.name, source: r.source, effects: instancesOf(r.choice) }));
    const groupId = styleRegionsCommand(layerId, regions);
    if (!groupId) return;
    onDone();
    void assignRegionDepths(groupId);
  };

  const computeDepth = async () => {
    setBusy(true);
    const task = startTask('Tiefenkarte berechnen');
    try {
      await computeMap(project, layer.originalId, 'depth', licenseMode, task.progress);
    } catch (e) {
      useAppStore.getState().notify('error', `Tiefenkarte: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      task.done();
      setBusy(false);
    }
  };

  return (
    <div className="style-regions">
      <p className="section-note">
        Jeder Bereich wird eine eigene Ebene mit eigenem Stil; der Hintergrund liegt unten. Bereiche per
        Klick: Smarte Auswahl (W), dann im Inspektor „Segmente“ speichern.
      </p>
      {rows.map((r) => (
        <div className="region-row" key={r.key} data-testid="region-row">
          <label className="region-head">
            <input
              type="checkbox"
              checked={r.include}
              onChange={(e) => {
                update(r.key, { include: e.target.checked });
              }}
            />
            <span className="region-name">{r.name}</span>
            <span className="region-kind">
              {r.source.kind === 'rest' ? 'Rest' : r.source.kind === 'segment' ? 'Segment' : 'Tiefe'}
            </span>
          </label>
          <select
            className="select"
            aria-label={`Stil für ${r.name}`}
            data-testid={`region-style-${r.key}`}
            value={r.choice}
            onChange={(e) => {
              update(r.key, { choice: e.target.value });
            }}
          >
            <option value="">– unverändert –</option>
            {stacks.length > 0 && (
              <optgroup label="Stapel-Presets">
                {stacks.map((s) => (
                  <option key={s.id} value={`stack:${s.id}`}>
                    {s.name}
                  </option>
                ))}
              </optgroup>
            )}
            <optgroup label="Effekte">
              {effects.flatMap((m) => [
                <option key={m.id} value={`fx:${m.id}`}>
                  {m.name}
                </option>,
                ...(m.presets ?? []).map((p) => (
                  <option key={`${m.id}|${p.name}`} value={`fx:${m.id}|${p.name}`}>
                    {`${m.name} – ${p.name}`}
                  </option>
                )),
              ])}
            </optgroup>
          </select>
          {r.source.kind === 'depth' && (
            <div className="region-depth">
              <Slider
                label="Tiefe von"
                hint="0 % = nah, 100 % = fern"
                value={Math.round(r.source.near * 100)}
                min={0}
                max={100}
                defaultValue={0}
                step={1}
                unit="%"
                onChange={(v) => {
                  if (r.source.kind === 'depth') update(r.key, { source: { ...r.source, near: v / 100 } });
                }}
              />
              <Slider
                label="Tiefe bis"
                value={Math.round(r.source.far * 100)}
                min={0}
                max={100}
                defaultValue={50}
                step={1}
                unit="%"
                onChange={(v) => {
                  if (r.source.kind === 'depth') update(r.key, { source: { ...r.source, far: v / 100 } });
                }}
              />
            </div>
          )}
        </div>
      ))}
      <div className="button-row">
        {hasDepth ? (
          <button
            className="button small"
            data-testid="region-add-depth"
            onClick={() => {
              const key = newId();
              setRows((rs) => [
                ...rs,
                {
                  key,
                  include: true,
                  name: `Tiefe ${rs.length}`,
                  source: { kind: 'depth', near: 0, far: 0.4 },
                  choice: '',
                },
              ]);
            }}
          >
            + Tiefenbereich
          </button>
        ) : (
          <button className="button small" disabled={busy} onClick={() => void computeDepth()}>
            Tiefenkarte berechnen (für Tiefenbereiche)
          </button>
        )}
      </div>
      <div className="dialog-actions">
        <button className="button" onClick={onDone}>
          Abbrechen
        </button>
        <button
          className="button primary"
          data-testid="region-apply"
          disabled={!rows.some((r) => r.include)}
          onClick={apply}
        >
          Anwenden
        </button>
      </div>
    </div>
  );
}
