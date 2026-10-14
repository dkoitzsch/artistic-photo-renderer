import { getProject, useAppStore } from './store';
import { centered, fitView, pan, zoomAt } from './viewMath';

const canvasSize = () => {
  const p = getProject();
  return p ? { width: p.canvas.width, height: p.canvas.height } : null;
};

export function fitToViewport(): void {
  const size = canvasSize();
  const { viewport, setView } = useAppStore.getState();
  if (size) setView(fitView(size, viewport));
}

export function zoomToActualSize(): void {
  const size = canvasSize();
  const { viewport, setView } = useAppStore.getState();
  if (size) setView(centered(size, viewport, 1));
}

/** Zoom um einen Faktor, um einen Punkt der Leinwand (Standard: Mitte). */
export function zoomBy(factor: number, px?: number, py?: number): void {
  const { view, viewport, setView } = useAppStore.getState();
  setView(zoomAt(view, px ?? viewport.width / 2, py ?? viewport.height / 2, view.zoom * factor));
}

export function panBy(dx: number, dy: number): void {
  const { view, setView } = useAppStore.getState();
  setView(pan(view, dx, dy));
}

/** Vorher/Nachher ein-/ausschalten (Teilung in der Mitte). */
export function toggleCompare(): void {
  const { compareSplit, setCompareSplit } = useAppStore.getState();
  if (getProject()) setCompareSplit(compareSplit === null ? 0.5 : null);
}
