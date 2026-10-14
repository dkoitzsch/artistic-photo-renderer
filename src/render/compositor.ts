// Rendert den Projektbaum (hinten → vorn) in eine Textur. Für die Vorschau werden Zwischenergebnisse
// pro Layer und Effektschritt gecacht (Schlüssel aus Eingang + Parametern); nur Geändertes wird neu berechnet.

import { getPlugin } from '../effects/pluginStore';
import type { EffectInstance, Group, Layer, Project, SceneNode } from '../state/project';
import type { GpuCore } from './core';
import type { EffectRunner } from './effectRunner';
import type { SourceStore } from './sources';
import type { Frame, TexturePool } from './texturePool';

export type Rect = { x: number; y: number; width: number; height: number };

export type RenderOptions = {
  /** Render-px pro Leinwand-px (Vorschau < 1, Export = 1) */
  scale: number;
  /** Leinwandgröße in Render-px */
  canvasSize: [number, number];
  /** Ausschnitt in Render-px */
  region: Rect;
  /** "Vorher"-Ansicht: alle Effekte aus */
  ignoreEffects: boolean;
  cache: ResultCache | null;
  /** trennt Cache-Einträge (z. B. "after" / "before") */
  variant: string;
};

export type RenderResult = { tex: GPUTexture; key: string; owned: boolean };

/** Hält Ergebnistexturen pro Slot; nicht mehr benutzte Slots werden am Frame-Ende freigegeben. */
export class ResultCache {
  private readonly entries = new Map<string, { key: string; tex: GPUTexture }>();
  private readonly touched = new Set<string>();

  constructor(private readonly pool: TexturePool) {}

  get(slot: string, key: string): GPUTexture | undefined {
    const e = this.entries.get(slot);
    if (e?.key !== key) return undefined;
    this.touched.add(slot);
    return e.tex;
  }

  set(slot: string, key: string, tex: GPUTexture): void {
    const old = this.entries.get(slot);
    if (old && old.tex !== tex) this.pool.release(old.tex);
    this.entries.set(slot, { key, tex });
    this.touched.add(slot);
  }

  beginFrame(): void {
    this.touched.clear();
  }

  endFrame(): void {
    for (const [slot, e] of this.entries)
      if (!this.touched.has(slot)) {
        this.pool.release(e.tex);
        this.entries.delete(slot);
      }
  }

  clear(): void {
    for (const e of this.entries.values()) this.pool.release(e.tex);
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }
}

const isWhole = (r: Rect, [w, h]: [number, number]) =>
  r.x === 0 && r.y === 0 && r.width === w && r.height === h;

export class Compositor {
  /** Anzahl der in diesem Frame tatsächlich ausgeführten Effekte (für Tests/Statistik) */
  effectRuns = 0;

  constructor(
    private readonly core: GpuCore,
    private readonly sources: SourceStore,
    private readonly runner: EffectRunner,
  ) {}

  render(frame: Frame, project: Project, opts: RenderOptions): RenderResult {
    const res = this.node(frame, project.root, opts);
    if (res) return res;
    const tex = this.core.pool.acquire(opts.region.width, opts.region.height, 'empty');
    this.core.fill(frame, tex, [0, 0, 0, 0]);
    return { tex, key: 'empty', owned: true };
  }

  private release(r: RenderResult): void {
    if (r.owned) this.core.pool.release(r.tex);
  }

  private node(frame: Frame, node: SceneNode, opts: RenderOptions): RenderResult | null {
    if (!node.visible) return null;
    return node.kind === 'layer' ? this.layer(frame, node, opts) : this.group(frame, node, opts);
  }

  private layer(frame: Frame, layer: Layer, opts: RenderOptions): RenderResult {
    const [cw, ch] = opts.canvasSize;
    const r = opts.region;
    // Phase 1: das Original füllt die Leinwand (Transform folgt in Phase 4).
    const base = this.sources.at(frame, layer.originalId, cw, ch);
    const srcKey = `${layer.originalId}@${cw}x${ch}[${r.x},${r.y},${r.width},${r.height}]`;
    let src: RenderResult;
    if (isWhole(r, opts.canvasSize)) {
      src = { tex: base, key: srcKey, owned: false };
    } else {
      const tex = this.core.pool.acquire(r.width, r.height, 'region');
      frame.encoder.copyTextureToTexture({ texture: base, origin: [r.x, r.y] }, { texture: tex }, [
        r.width,
        r.height,
      ]);
      src = { tex, key: srcKey, owned: true };
    }
    return this.effects(frame, layer.id, layer.effects, src, opts);
  }

  private group(frame: Frame, group: Group, opts: RenderOptions): RenderResult | null {
    const parts: { res: RenderResult; opacity: number }[] = [];
    for (const child of group.children) {
      const res = this.node(frame, child, opts);
      if (res) parts.push({ res, opacity: child.opacity });
    }
    let comp: RenderResult;
    const first = parts[0];
    if (parts.length === 1 && first && first.opacity >= 1) {
      comp = first.res;
    } else {
      const key = `group(${parts.map((p) => `${p.res.key}*${p.opacity}`).join(',')})`;
      const slot = `${opts.variant}:${group.id}:comp`;
      const cached = opts.cache?.get(slot, key);
      if (cached) {
        for (const p of parts) this.release(p.res);
        comp = { tex: cached, key, owned: false };
      } else {
        const { width, height } = opts.region;
        let base: GPUTexture | null = null;
        for (const p of parts) {
          const out = this.core.pool.acquire(width, height, 'composite');
          this.core.blend(frame, base, p.res.tex, out, p.opacity);
          if (base) this.core.pool.release(base);
          this.release(p.res);
          base = out;
        }
        if (!base) {
          base = this.core.pool.acquire(width, height, 'empty');
          this.core.fill(frame, base, [0, 0, 0, 0]);
        }
        if (opts.cache) {
          opts.cache.set(slot, key, base);
          comp = { tex: base, key, owned: false };
        } else comp = { tex: base, key, owned: true };
      }
    }
    return this.effects(frame, group.id, group.effects, comp, opts);
  }

  private effects(
    frame: Frame,
    nodeId: string,
    effects: EffectInstance[],
    input: RenderResult,
    opts: RenderOptions,
  ): RenderResult {
    let cur = input;
    if (opts.ignoreEffects) return cur;
    const aux = { mask: this.core.white, focus: this.core.white, depth: this.core.black };
    const placement = {
      scale: opts.scale,
      origin: [opts.region.x, opts.region.y] as [number, number],
      canvasSize: opts.canvasSize,
    };
    effects.forEach((fx, i) => {
      if (!fx.enabled) return;
      const plugin = getPlugin(fx.effectId);
      if (plugin?.status !== 'ok' || !this.runner.isCompiled(plugin)) return;
      const key = `${cur.key}|${fx.effectId}#${plugin.revision}${JSON.stringify([fx.params, fx.strength, fx.region])}`;
      const slot = `${opts.variant}:${nodeId}:fx${i}`;
      const cached = opts.cache?.get(slot, key);
      if (cached) {
        this.release(cur);
        cur = { tex: cached, key, owned: false };
        return;
      }
      this.effectRuns++;
      const out = this.runner.apply(frame, plugin, fx, cur.tex, aux, placement);
      this.release(cur);
      if (opts.cache) {
        opts.cache.set(slot, key, out);
        cur = { tex: out, key, owned: false };
      } else cur = { tex: out, key, owned: true };
    });
    return cur;
  }
}

/** Summe der Effekt-Reichweiten (px, volle Auflösung) entlang des tiefsten Pfads – Überlappung der Export-Kacheln. */
export function projectReach(node: SceneNode, reachOf: (fx: EffectInstance) => number): number {
  const own = node.effects.filter((e) => e.enabled).reduce((s, e) => s + reachOf(e), 0);
  if (node.kind === 'layer') return own;
  return own + Math.max(0, ...node.children.filter((c) => c.visible).map((c) => projectReach(c, reachOf)));
}
