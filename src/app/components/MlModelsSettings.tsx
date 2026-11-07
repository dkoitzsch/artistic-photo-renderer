// Einstellungen: ML-Modelle (Spec „ML-Fotobearbeitung“, Abschnitt 3) und Prompt-Vorlagen der Stil-Übertragung.
// Der Speicherort des Modells (z. B. FLUX.2 klein 9B) wird hier angegeben; das Modell wird dort nur gelesen.

import { useEffect, useState } from 'react';
import {
  deleteMlModel,
  modelForRole,
  refreshMlModels,
  saveMlModel,
  unloadMlModels,
  useMlModels,
  type MlModelEntry,
} from '../../ml/mlModels';
import { PROMPT_PRESETS, useStylePrompts } from '../../ml/stylePrompts';

const DEFAULT_ID = 'flux2-klein-9b';

type Form = {
  name: string;
  root: string;
  precision: string;
  offload: string;
  steps: number;
  guidance: number;
  outputCommercialUse: boolean;
  licenseName: string;
  licenseNotes: string;
};

const EMPTY: Form = {
  name: 'FLUX.2 [klein] 9B',
  root: '',
  precision: 'bf16',
  offload: 'auto',
  steps: 4,
  guidance: 1,
  outputCommercialUse: true,
  licenseName: 'FLUX Non-Commercial License',
  licenseNotes: 'Tool privat/nicht-kommerziell genutzt, erzeugte Bilder kommerziell (meine Einstufung).',
};

function formOf(m: MlModelEntry | undefined): Form {
  if (!m) return EMPTY;
  return {
    name: m.name,
    root: m.paths.root,
    precision: m.precision,
    offload: m.memory.offload,
    steps: m.defaults.steps,
    guidance: m.defaults.guidance,
    outputCommercialUse: m.outputCommercialUse,
    licenseName: m.license.name,
    licenseNotes: m.license.notes,
  };
}

export function MlModelsSettings() {
  const { state, info, error } = useMlModels();
  const model = modelForRole('image-edit', info);

  useEffect(() => {
    void refreshMlModels();
  }, []);

  return (
    <fieldset className="choice-list" data-testid="ml-models-settings">
      <legend className="control-label">ML-Modelle (Bildbearbeitung, z. B. FLUX)</legend>
      {state === 'offline' ? (
        <p className="section-note" data-testid="ml-models-offline">
          Der ML-Dienst ist nicht erreichbar ({error ?? 'keine Antwort'}). Starte ihn mit{' '}
          <code>npm run dev</code>.
        </p>
      ) : (
        <ModelForm key={model?.id ?? 'neu'} model={model} hardware={info?.hardware} />
      )}
      <PromptTemplates />
    </fieldset>
  );
}

/** Formular für das Modell der Rolle image-edit; mit key je Modell, damit Eingaben nicht überschrieben werden. */
function ModelForm({
  model,
  hardware,
}: {
  model: MlModelEntry | undefined;
  hardware: { device: string; ramGB: number } | undefined;
}) {
  const [form, setForm] = useState<Form>(() => formOf(model));
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
  };

  const save = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const saved = await saveMlModel(model?.id ?? DEFAULT_ID, {
        name: form.name,
        roles: ['image-edit'],
        root: form.root.trim(),
        precision: form.precision,
        offload: form.offload,
        steps: form.steps,
        guidance: form.guidance,
        licenseName: form.licenseName,
        licenseNotes: form.licenseNotes,
        outputCommercialUse: form.outputCommercialUse,
        defaultForRoles: ['image-edit'],
      });
      setMessage(
        saved.status.available
          ? 'Gespeichert – Modell gefunden.'
          : `Gespeichert, aber: ${saved.status.note ?? 'nicht verfügbar'}`,
      );
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const status = model?.status;
  return (
    <>
      <p className="section-note">
        Das Modell wird dort verwendet, wo es liegt (nur gelesen, nichts wird kopiert oder geladen). Rolle:
        Bildbearbeitung / Stil-Übertragung.
        {hardware ? ` Gerät: ${hardware.device}, ${hardware.ramGB} GB Arbeitsspeicher.` : ''}
      </p>
      <label className="control-row">
        <span className="control-label">Name</span>
        <input
          className="text-input"
          value={form.name}
          onChange={(e) => {
            set('name', e.target.value);
          }}
          data-testid="ml-model-name"
        />
      </label>
      <label className="control-row">
        <span className="control-label">Speicherort</span>
        <input
          className="text-input"
          value={form.root}
          placeholder="/Volumes/Modelle/flux-2-klein-9b  (Ordner mit model_index.json)"
          onChange={(e) => {
            set('root', e.target.value);
          }}
          data-testid="ml-model-root"
        />
      </label>
      <label className="control-row">
        <span className="control-label">Präzision</span>
        <select
          className="select"
          value={form.precision}
          onChange={(e) => {
            set('precision', e.target.value);
          }}
          data-testid="ml-model-precision"
        >
          <option value="bf16">bf16 (empfohlen)</option>
          <option value="fp16">fp16</option>
          <option value="fp32">fp32</option>
        </select>
      </label>
      <label className="control-row">
        <span className="control-label">Auslagerung</span>
        <select
          className="select"
          value={form.offload}
          onChange={(e) => {
            set('offload', e.target.value);
          }}
          data-testid="ml-model-offload"
        >
          <option value="auto">Automatisch (nach Arbeitsspeicher)</option>
          <option value="none">Alles im Speicher</option>
          <option value="model">Modell für Modell auslagern</option>
          <option value="sequential">Schichtweise (sehr langsam, wenig Speicher)</option>
        </select>
      </label>
      <label className="control-row">
        <span className="control-label">Schritte / Guidance</span>
        <span className="image-control">
          <input
            className="text-input"
            type="number"
            min={1}
            max={100}
            value={form.steps}
            onChange={(e) => {
              set('steps', Number(e.target.value) || 4);
            }}
            aria-label="Schritte"
            data-testid="ml-model-steps"
          />
          <input
            className="text-input"
            type="number"
            min={0}
            max={20}
            step={0.1}
            value={form.guidance}
            onChange={(e) => {
              set('guidance', Number(e.target.value));
            }}
            aria-label="Guidance"
          />
        </span>
      </label>
      <label className="choice">
        <input
          type="checkbox"
          checked={form.outputCommercialUse}
          onChange={(e) => {
            set('outputCommercialUse', e.target.checked);
          }}
          data-testid="ml-model-commercial"
        />
        <span>Erzeugte Bilder dürfen kommerziell genutzt werden</span>
        <span className="choice-note">
          Deine Einstufung; das Tool trifft diese Entscheidung nicht. Aus: Modell nur im Lizenzmodus „Alle“.
        </span>
      </label>
      <label className="control-row">
        <span className="control-label">Lizenz</span>
        <input
          className="text-input"
          value={form.licenseName}
          onChange={(e) => {
            set('licenseName', e.target.value);
          }}
        />
      </label>
      <label className="control-row">
        <span className="control-label">Notiz zur Lizenz</span>
        <input
          className="text-input"
          value={form.licenseNotes}
          onChange={(e) => {
            set('licenseNotes', e.target.value);
          }}
        />
      </label>
      <div className="dialog-actions">
        <button
          className="button primary"
          disabled={busy || !form.root.trim()}
          onClick={() => {
            void save();
          }}
          data-testid="ml-model-save"
        >
          Speichern und prüfen
        </button>
        {model ? (
          <>
            <button
              className="button"
              onClick={() => {
                void unloadMlModels();
              }}
              title="Gibt den Speicher des geladenen Modells frei"
            >
              Modell entladen
            </button>
            <button
              className="button"
              onClick={() => {
                void deleteMlModel(model.id).then(() => {
                  setMessage('Eintrag entfernt (die Modelldateien bleiben unverändert).');
                });
              }}
              data-testid="ml-model-remove"
              title="Entfernt nur den Eintrag, nie die Dateien"
            >
              Eintrag entfernen
            </button>
          </>
        ) : null}
      </div>
      {message ? (
        <p className="section-note" data-testid="ml-model-message">
          {message}
        </p>
      ) : null}
      {model ? (
        <p
          className="section-note"
          data-testid="ml-model-status"
          data-available={status?.available ? '1' : '0'}
        >
          {status?.available
            ? `Verfügbar: ${status.pipeline ?? ''}, ${((status.sizeBytes ?? 0) / 1024 ** 3).toFixed(1)} GB${model.loaded ? ', geladen' : ''}`
            : `Nicht verfügbar: ${status?.note ?? ''}`}
        </p>
      ) : null}
    </>
  );
}

function PromptTemplates() {
  const overrides = useStylePrompts((s) => s.overrides);
  const setTemplate = useStylePrompts((s) => s.setTemplate);
  const resetTemplate = useStylePrompts((s) => s.resetTemplate);
  return (
    <div data-testid="prompt-templates">
      <p className="section-note">
        Prompt-Vorlagen der Stil-Übertragung („Bild 1“ = Ebene, „Bild 2“ = Stilbild). Im Effekt lässt sich der
        Prompt je Lauf zusätzlich ändern.
      </p>
      {PROMPT_PRESETS.map((p) => (
        <div key={p.id} className="style-flux-panel">
          <span className="control-label">{p.label}</span>
          <textarea
            aria-label={`Vorlage ${p.label}`}
            data-testid={`prompt-template-${p.id}`}
            value={overrides[p.id] ?? p.prompt}
            onChange={(e) => {
              setTemplate(p.id, e.target.value);
            }}
          />
          {overrides[p.id] !== undefined ? (
            <button
              className="button small"
              onClick={() => {
                resetTemplate(p.id);
              }}
            >
              Zurücksetzen
            </button>
          ) : null}
        </div>
      ))}
    </div>
  );
}
