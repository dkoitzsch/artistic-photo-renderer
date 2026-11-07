// Bedienfelder für Effekte mit eigener Bedienung (Manifest-Feld `panel`): z. B. ML-Läufe mit Aktualisieren-Knopf.
// Der Kern kennt keine konkreten Effekte; Effekte verweisen nur auf einen Namen, die App registriert hier die Felder.

import type { ComponentType } from 'react';
import type { EffectInstance } from '../../state/project';
import { StyleFluxPanel } from './StyleFluxPanel';

export type EffectPanelProps = { nodeId: string; effect: EffectInstance };

const PANELS: Record<string, ComponentType<EffectPanelProps>> = {
  'style-flux': StyleFluxPanel,
};

export function EffectPanel({ name, nodeId, effect }: EffectPanelProps & { name: string }) {
  const Panel = PANELS[name];
  return Panel ? <Panel nodeId={nodeId} effect={effect} /> : null;
}
