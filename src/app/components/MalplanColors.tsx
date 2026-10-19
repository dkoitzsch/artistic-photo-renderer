// Malplan: „Meine Farben“ (vorhandene Tubenfarben aus der Pigmentdatenbank, Profile im Browser speicherbar) und die
// reduzierte Palette mit Mischrezepten (Spec „Effekte“ 7.2 und 7.4).

import { useState } from 'react';
import type { MalplanSettings } from '../../malplan/model';
import { useMalplanStore } from '../../malplan/store';
import { PIGMENTS, pigmentById, recipeParts } from '../../pigments/engine';
import { srgbToHex } from '../../pigments/spectral';
import { Section } from './LayerSections';

type Profile = { name: string; ids: string[] };
const PROFILE_KEY = 'bls.colorProfiles';

function loadProfiles(): Profile[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(PROFILE_KEY) ?? '[]');
    return Array.isArray(raw)
      ? raw.filter(
          (p): p is Profile =>
            typeof p === 'object' &&
            p !== null &&
            typeof (p as Profile).name === 'string' &&
            Array.isArray((p as Profile).ids),
        )
      : [];
  } catch {
    return [];
  }
}

function saveProfiles(list: Profile[]): void {
  try {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(list));
  } catch {
    // Speicher nicht verfügbar: Profile bleiben nur für diese Sitzung
  }
}

export function MyColorsSection({
  settings,
  set,
}: {
  settings: MalplanSettings;
  set: (patch: Partial<MalplanSettings>) => void;
}) {
  const [profiles, setProfiles] = useState<Profile[]>(loadProfiles);
  const [name, setName] = useState('Meine Palette');
  const chosen = new Set(settings.myColors);
  const toggle = (id: string) => {
    const next = PIGMENTS.map((p) => p.id).filter((x) => (x === id ? !chosen.has(x) : chosen.has(x)));
    if (next.length) set({ myColors: next });
  };
  return (
    <Section
      title={`Meine Farben (${settings.myColors.length})`}
      testId="malplan-mycolors"
      defaultOpen={false}
    >
      <p className="section-note">
        Vorhandene Tubenfarben. Paletten und Rezepte nutzen nur diese. Die Pigmentspektren sind Näherungen.
      </p>
      <div className="pigment-list" data-testid="pigment-list">
        {PIGMENTS.map((p) => (
          <label key={p.id} className="pigment" title={`${p.name} (${p.ci})`}>
            <input
              type="checkbox"
              checked={chosen.has(p.id)}
              data-testid={`pigment-${p.id}`}
              onChange={() => {
                toggle(p.id);
              }}
            />
            <span className="pigment-swatch" style={{ background: p.masstone }} />
            <span className="pigment-swatch tint" style={{ background: p.tint }} />
            <span className="pigment-name">{p.name}</span>
            <span className="pigment-ci">{p.ci}</span>
          </label>
        ))}
      </div>
      <div className="control-row">
        <span className="control-label">Profil</span>
        <select
          className="select"
          aria-label="Profil laden"
          value=""
          onChange={(e) => {
            const p = profiles.find((x) => x.name === e.target.value);
            const ids = p?.ids.filter((id) => pigmentById(id));
            if (ids?.length) set({ myColors: ids });
          }}
        >
          <option value="">Profil laden …</option>
          {profiles.map((p) => (
            <option key={p.name} value={p.name}>
              {p.name} ({p.ids.length})
            </option>
          ))}
        </select>
      </div>
      <div className="segment-row">
        <input
          className="text-input"
          aria-label="Name des Profils"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
          }}
        />
        <button
          className="button small"
          disabled={!name.trim()}
          onClick={() => {
            const list = [
              ...profiles.filter((p) => p.name !== name.trim()),
              { name: name.trim(), ids: settings.myColors },
            ];
            setProfiles(list);
            saveProfiles(list);
          }}
        >
          Als Profil speichern
        </button>
      </div>
    </Section>
  );
}

/** Paletteneinträge mit Farbfeld (Soll | Mischung), Rezept in Teilen und ΔE. */
export function RecipeList() {
  const palette = useMalplanStore((s) => s.palette);
  if (!palette) return <p className="section-note">Palette wird berechnet …</p>;
  return (
    <ol className="recipe-list" data-testid="recipe-list">
      {palette.entries.map((e) => {
        const r = recipeParts({
          parts: e.recipe,
          deltaE: e.deltaE,
          result: { srgb: e.mixed, hex: '', lab: [0, 0, 0], spectrum: new Float64Array() },
        });
        const off = e.deltaE >= 5;
        return (
          <li key={e.number} className="recipe" data-testid="recipe">
            <span className="recipe-number">{e.number}</span>
            <span className="recipe-swatch" title="links Soll, rechts Mischung">
              <span style={{ background: srgbToHex(e.target) }} />
              <span style={{ background: srgbToHex(e.mixed) }} />
            </span>
            <span className="recipe-text">
              {r.map((p, i) => (
                <span key={p.id}>
                  {i > 0 ? ' + ' : ''}
                  {p.parts === null ? 'etwas ' : `${p.parts} ${p.parts === 1 ? 'Teil' : 'Teile'} `}
                  {p.name}
                </span>
              ))}
            </span>
            <span
              className={`recipe-de${off ? ' off' : ''}`}
              title={off ? 'mit „Meine Farben“ nicht genau mischbar' : ''}
            >
              ΔE {e.deltaE.toFixed(1)}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
