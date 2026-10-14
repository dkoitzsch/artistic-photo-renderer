// Reine Mathematik der Leinwand-Ansicht. Koordinaten in CSS-Pixeln relativ zur Leinwand.
// Abbildung: screen = image * zoom + offset

export type View = { zoom: number; offsetX: number; offsetY: number };
export type Size = { width: number; height: number };

export const MIN_ZOOM = 0.02;
export const MAX_ZOOM = 32;

export function clampZoom(z: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
}

/** Zoomt so, dass der Bildpunkt unter (px, py) an derselben Bildschirmstelle bleibt. */
export function zoomAt(view: View, px: number, py: number, newZoom: number): View {
  const zoom = clampZoom(newZoom);
  const k = zoom / view.zoom;
  return { zoom, offsetX: px - (px - view.offsetX) * k, offsetY: py - (py - view.offsetY) * k };
}

export function pan(view: View, dx: number, dy: number): View {
  return { ...view, offsetX: view.offsetX + dx, offsetY: view.offsetY + dy };
}

/** Bild vollständig sichtbar und zentriert, mit Rand in CSS-Pixeln. */
export function fitView(image: Size, viewport: Size, margin = 32): View {
  const availW = Math.max(1, viewport.width - 2 * margin);
  const availH = Math.max(1, viewport.height - 2 * margin);
  const zoom = clampZoom(Math.min(availW / image.width, availH / image.height));
  return centered(image, viewport, zoom);
}

/** Bild in gegebenem Zoom zentriert. */
export function centered(image: Size, viewport: Size, zoom: number): View {
  const z = clampZoom(zoom);
  return {
    zoom: z,
    offsetX: (viewport.width - image.width * z) / 2,
    offsetY: (viewport.height - image.height * z) / 2,
  };
}

export function screenToImage(view: View, sx: number, sy: number): [number, number] {
  return [(sx - view.offsetX) / view.zoom, (sy - view.offsetY) / view.zoom];
}
