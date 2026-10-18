// Aktionen mit der Markierung (Phase 5 Schritt 4).
import type { Layer } from '../../state/project';

export function SelectionActions({ layer }: { layer: Layer }) {
  return layer.selection ? null : null;
}
