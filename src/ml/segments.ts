// Segmente (E3, Analysekarte „segmentation“): Vordergrund eines Originals als Segment anlegen. Segmente per Klick
// entstehen über die Smarte Auswahl (Markierung → „Als Segment speichern“).

import { addSegmentCommand } from '../state/commands';
import { findNode } from '../state/project';
import { getProject, useAppStore } from '../state/store';
import { computeForegroundMask, startTask } from './split';

/** Vordergrund (BiRefNet bzw. RMBG im Modus „Alle“) des Originals einer Ebene als Segment „Vordergrund“. */
export async function foregroundSegment(layerId: string): Promise<string | null> {
  const project = getProject();
  const layer = project ? findNode(project.root, layerId) : undefined;
  if (!project || layer?.kind !== 'layer') return null;
  const { licenseMode, notify } = useAppStore.getState();
  const task = startTask('Vordergrund als Segment');
  try {
    const m = await computeForegroundMask(project, layer.originalId, 'birefnet', licenseMode, task.progress);
    return addSegmentCommand(layer.originalId, 'Vordergrund', {
      base: {
        kind: 'stored',
        id: m.id,
        width: m.width,
        height: m.height,
        inverted: false,
        provenance: {
          modelId: m.model.id,
          commercialUse: m.model.commercialUse,
          createdAt: new Date().toISOString(),
        },
      },
      strokes: [],
    });
  } catch (e) {
    notify('error', `Vordergrund: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  } finally {
    task.done();
  }
}
