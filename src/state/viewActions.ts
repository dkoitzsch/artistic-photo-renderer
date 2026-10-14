import { useAppStore } from './store';
import { centered, fitView, pan, zoomAt } from './viewMath';

export function fitToViewport(): void {
  const { image, viewport, setView } = useAppStore.getState();
  if (image) setView(fitView(image, viewport));
}

export function zoomToActualSize(): void {
  const { image, viewport, setView } = useAppStore.getState();
  if (image) setView(centered(image, viewport, 1));
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
