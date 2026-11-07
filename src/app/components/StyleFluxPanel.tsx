// Bedienfeld des Effekts „Stil übertragen (FLUX)“: Stilbild wählen (startet den Lauf, wenn ein Modell bereit ist),
// Prompt-Vorlage und Prompt, Verlauf (neue Ebene je Transfer / Ergebnis im Effekt), Arbeitsauflösung und der
// Aktualisieren-Knopf (Kreispfeil; ein Punkt zeigt, dass sich seit dem letzten Lauf etwas geändert hat).

import { useEffect, useState } from 'react';
import { refreshMlModels, roleAvailability, useMlModels } from '../../ml/mlModels';
import { effectivePrompt, isDirty, isRunning, runStyleTransfer } from '../../ml/styleFlux';
import {
  CUSTOM_LABEL,
  PROMPT_PRESETS,
  isPresetId,
  templateText,
  useStylePrompts,
  type PromptPresetId,
} from '../../ml/stylePrompts';
import { setParamCommand, setParamsCommand } from '../../state/commands';
import { useAppStore, useProject } from '../../state/store';
import { ImageControl } from '../controls/ImageControl';
import type { EffectPanelProps } from './effectPanels';
import { RefreshIcon } from './Icons';

export function StyleFluxPanel({ nodeId, effect }: EffectPanelProps) {
  const project = useProject();
  const licenseMode = useAppStore((s) => s.licenseMode);
  const tasks = useAppStore((s) => s.tasks);
  const overrides = useStylePrompts((s) => s.overrides);
  useMlModels(); // Zustand des Dienstes und der Modelle beobachten (Hinweise aktualisieren sich)
  const [draft, setDraft] = useState<string | null>(null);

  useEffect(() => {
    void refreshMlModels();
  }, []);

  const preset: PromptPresetId = isPresetId(effect.params.promptPreset)
    ? effect.params.promptPreset
    : 'faithful';
  const stored = effectivePrompt(effect);
  const text = draft ?? stored;
  const styleId = typeof effect.params.styleId === 'string' ? effect.params.styleId : '';
  const history = effect.params.history === 'overwrite' ? 'overwrite' : 'layers';
  const workSize = String(effect.params.workSize ?? '1024');
  const running = isRunning(effect.instanceId) || tasks.some((t) => t.label === 'Stil-Übertragung (FLUX)');
  const avail = roleAvailability('image-edit', licenseMode);

  const dirty = !!project && (draft !== null && draft !== stored ? true : isDirty(project, nodeId, effect));
  const canRun = avail.ok && !!styleId && !running;

  const commitPrompt = () => {
    if (draft === null || draft === stored) {
      setDraft(null);
      return;
    }
    const matches = PROMPT_PRESETS.find((p) => templateText(p.id, overrides) === draft.trim());
    setParamsCommand(
      nodeId,
      effect.instanceId,
      { prompt: draft, promptPreset: matches ? matches.id : 'custom' },
      'Prompt geändert',
    );
    setDraft(null);
  };

  const chooseStyle = (id: string) => {
    setParamCommand(nodeId, effect.instanceId, 'styleId', id, false);
    // Stilbild gewählt und Modell bereit: Prompt sofort losschicken
    if (id && roleAvailability('image-edit', licenseMode).ok)
      void runStyleTransfer(nodeId, effect.instanceId, false);
  };

  const refresh = () => {
    commitPrompt();
    // Unverändert: eine andere Variante (neuer Zufallswert); verändert: die neuen Einstellungen mit dem bisherigen Seed
    void runStyleTransfer(nodeId, effect.instanceId, !dirty);
  };

  return (
    <div className="style-flux-panel" data-testid="style-flux-panel">
      <p className="section-note" data-testid="style-flux-status" data-ready={avail.ok ? '1' : '0'}>
        {avail.ok ? `Modell bereit: ${avail.model.name}` : avail.reason}
        {!avail.ok ? (
          <>
            {' '}
            <button
              className="button small"
              onClick={() => {
                useAppStore.getState().setSettingsOpen(true);
              }}
            >
              Einstellungen
            </button>
          </>
        ) : null}
      </p>
      <ImageControl label="Stilbild" value={styleId} onChange={chooseStyle} testId="style-flux-style" />
      <div className="control-row">
        <span className="control-label">Prompt-Vorlage</span>
        <select
          className="select"
          aria-label="Prompt-Vorlage"
          data-testid="style-flux-preset"
          value={preset}
          onChange={(e) => {
            const v = e.target.value as PromptPresetId;
            setDraft(null);
            if (v === 'custom')
              setParamsCommand(nodeId, effect.instanceId, { promptPreset: 'custom' }, 'Prompt-Vorlage');
            else
              setParamsCommand(
                nodeId,
                effect.instanceId,
                { promptPreset: v, prompt: templateText(v, overrides) },
                'Prompt-Vorlage',
              );
          }}
        >
          {PROMPT_PRESETS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
          <option value="custom">{CUSTOM_LABEL}</option>
        </select>
      </div>
      <textarea
        aria-label="Prompt"
        data-testid="style-flux-prompt"
        value={text}
        placeholder="Beschreibe, wie der Stil übertragen werden soll (Bild 1 = Ebene, Bild 2 = Stilbild)"
        onChange={(e) => {
          setDraft(e.target.value);
        }}
        onBlur={commitPrompt}
      />
      <div className="control-row">
        <span className="control-label">Verlauf</span>
        <select
          className="select"
          aria-label="Verlauf"
          data-testid="style-flux-history"
          value={history}
          onChange={(e) => {
            setParamCommand(nodeId, effect.instanceId, 'history', e.target.value, false);
          }}
        >
          <option value="layers">Jeder Transfer als neue Ebene</option>
          <option value="overwrite">Ergebnis im Effekt (überschreibt)</option>
        </select>
      </div>
      <div className="control-row">
        <span className="control-label">Arbeitsauflösung</span>
        <select
          className="select"
          aria-label="Arbeitsauflösung"
          data-testid="style-flux-size"
          value={workSize}
          onChange={(e) => {
            setParamCommand(nodeId, effect.instanceId, 'workSize', e.target.value, false);
          }}
        >
          <option value="1024">1024 px (schnell)</option>
          <option value="1536">1536 px</option>
          <option value="2048">2048 px (langsam)</option>
        </select>
      </div>
      <div className="style-flux-actions">
        <button
          className={`icon-button style-flux-refresh${running ? ' spinning' : ''}`}
          data-testid="style-flux-refresh"
          data-dirty={dirty ? '1' : '0'}
          disabled={!canRun}
          title={
            !styleId
              ? 'Zuerst ein Stilbild wählen'
              : !avail.ok
                ? avail.reason
                : dirty
                  ? 'Aktualisieren: Einstellungen wurden geändert – neuen Stil-Transfer berechnen'
                  : 'Aktualisieren: neue Variante berechnen (anderer Zufallswert)'
          }
          aria-label="Aktualisieren"
          onClick={refresh}
        >
          <RefreshIcon />
          {dirty && !running ? <span className="dirty-dot" /> : null}
        </button>
        <span className="section-note">
          {running
            ? 'Berechnung läuft …'
            : dirty
              ? styleId
                ? 'Einstellungen geändert – Aktualisieren drücken'
                : 'Stilbild wählen'
              : 'Aktuell'}
        </span>
      </div>
    </div>
  );
}
