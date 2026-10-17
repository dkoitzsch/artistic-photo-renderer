import type { EffectInstance } from '../state/project';
import { compileExpr, type Scope } from './expr';
import type { EffectManifest } from './manifest';
import { getPlugin } from './pluginStore';

/** Reichweite der Kantenkarte in px (volle Auflösung). */
export const EDGE_MAP_REACH = 8;

const cache = new Map<string, ReturnType<typeof compileExpr>>();

/** Zahlenwerte der Parameter für Ausdrücke (px unskaliert, bool 0/1, enum Index). */
export function numericScope(manifest: EffectManifest, params: Record<string, unknown>): Scope {
  const scope: Scope = {};
  for (const p of manifest.params) {
    const v = params[p.key] ?? p.default;
    if (typeof v === 'number') scope[p.key] = v;
    else if (typeof v === 'boolean') scope[p.key] = v ? 1 : 0;
    else if (p.type === 'enum')
      scope[p.key] = Math.max(
        0,
        p.options.findIndex((o) => o.value === v),
      );
  }
  return scope;
}

/** Reichweite eines Effekts in px bei voller Auflösung (0, wenn das Manifest keine angibt). */
export function effectReach(
  fx: EffectInstance,
  canvas: { width: number; height: number } = { width: 0, height: 0 },
): number {
  const manifest = getPlugin(fx.effectId)?.manifest;
  if (!manifest) return 0;
  // Kantenkarte aus dem Effekt-Eingang (Gruppen) liest bis zu 8 px Umgebung (Sobel + Glättung 3σ, σ = 2 px)
  const mapReach = manifest.requires.includes('edges') ? EDGE_MAP_REACH : 0;
  if (!manifest.reach) return mapReach;
  let compiled = cache.get(manifest.reach);
  if (!compiled) {
    compiled = compileExpr(manifest.reach);
    cache.set(manifest.reach, compiled);
  }
  const r = compiled.evaluate({
    ...numericScope(manifest, fx.params),
    canvasWidth: canvas.width,
    canvasHeight: canvas.height,
  });
  return (Number.isFinite(r) ? Math.max(0, r) : 0) + mapReach;
}
