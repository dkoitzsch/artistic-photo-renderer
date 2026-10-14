// Rendert den Projektbaum (hinten → vorn) in eine Textur. Für die Vorschau werden Zwischenergebnisse
// pro Layer und Effektschritt gecacht (Schlüssel aus Eingang + Parametern); nur Geändertes wird neu berechnet.

import { getPlugin } from '../effects/pluginStore';
import {
  findNode,
  type BlendMode,
  type EffectInstance,
  type Group,
  type Layer,
  type Project,
  type SceneNode,
} from '../state/project';
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

function findLayer(project: Project, id: string): Layer | undefined {
  const n = findNode(project.root, id);
  return n?.kind === 'layer' ? n : undefined;
}

const isWhole = (r: Rect, [w, h]: [number, number]) =>
  r.x === 0 && r.y === 0 && r.width === w && r.height === h;

type Aux = { mask: GPUTexture; focus: GPUTexture; depth: GPUTexture; hasFocus: boolean };

/** Lazy Zusatz-Eingänge einer Ebene: werden erst erzeugt, wenn ein Effekt wirklich rechnen muss. */
type AuxProvider = { key: string; get: () => Aux; release: () => void };

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

  /** Prüfansicht einer Ebene: aufbereitete Maske oder Fokuskarte (Leinwand-Ausschnitt in Render-px). */
  overlay(
    frame: Frame,
    project: Project,
    layerId: string,
    kind: 'mask' | 'focus',
    opts: RenderOptions,
  ): GPUTexture | null {
    const layer = findLayer(project, layerId);
    if (!layer) return null;
    if (kind === 'mask') {
      const m = this.processedMask(frame, layer, opts);
      return m?.tex ?? this.core.white;
    }
    const points = (layer.focusMap?.points ?? []).filter((p) => p.enabled && p.radius > 0);
    const key = JSON.stringify(points.map((p) => [p.x, p.y, p.radius]));
    const slot = `${opts.variant}:${layer.id}:focus`;
    const cached = opts.cache?.get(slot, key);
    if (cached) return cached;
    const tex = this.core.pool.acquire(opts.region.width, opts.region.height, 'focus-view');
    this.core.focusMap(frame, points, tex, [opts.region.x, opts.region.y], opts.scale);
    if (opts.cache) opts.cache.set(slot, key, tex);
    return tex;
  }

  private release(r: RenderResult): void {
    if (r.owned) this.core.pool.release(r.tex);
  }

  private node(frame: Frame, node: SceneNode, opts: RenderOptions): RenderResult | null {
    if (!node.visible) return null;
    if (node.kind === 'layer') return this.layer(frame, node, opts).result;
    return this.group(frame, node, opts);
  }

  /** Ausschnitt einer Leinwand-großen Textur (ganze Leinwand: die Textur selbst). */
  private region(
    frame: Frame,
    tex: GPUTexture,
    opts: RenderOptions,
    label: string,
  ): { tex: GPUTexture; owned: boolean } {
    const r = opts.region;
    if (isWhole(r, opts.canvasSize)) return { tex, owned: false };
    const out = this.core.pool.acquire(r.width, r.height, label);
    frame.encoder.copyTextureToTexture({ texture: tex, origin: [r.x, r.y] }, { texture: out }, [
      r.width,
      r.height,
    ]);
    return { tex: out, owned: true };
  }

  /** Aufbereitete Maske einer Ebene in Leinwandgröße (Kantenübergang angewendet), gecacht. */
  private processedMask(
    frame: Frame,
    layer: Layer,
    opts: RenderOptions,
  ): { tex: GPUTexture; key: string } | null {
    const m = layer.mask;
    if (m.kind !== 'stored') return null;
    const [cw, ch] = opts.canvasSize;
    const key = `mask|${m.id}@${cw}x${ch}|${m.inverted ? 'inv' : ''}|${JSON.stringify(layer.maskEdge)}|${opts.scale}`;
    const tex = this.sources.derive(key, cw, ch, (out) => {
      this.core.processMask(frame, this.sources.mask(m.id), m.inverted, layer.maskEdge, opts.scale, out);
    });
    return { tex, key };
  }

  /** Lochgefülltes Original (Loch = nicht invertierte Maske, leicht erweitert), gecacht. */
  private filledSource(
    frame: Frame,
    layer: Layer,
    opts: RenderOptions,
  ): { tex: GPUTexture; key: string } | null {
    const m = layer.mask;
    if (m.kind !== 'stored') return null;
    const [cw, ch] = opts.canvasSize;
    // Loch = Bereich der Maske, die die Ebene ausblendet
    const key = `fill|${layer.originalId}+${m.id}@${cw}x${ch}|${m.inverted ? 'inv' : ''}`;
    const tex = this.sources.derive(key, cw, ch, (out) => {
      const hole = this.core.pool.acquire(cw, ch, 'hole');
      const grown = this.core.pool.acquire(cw, ch, 'hole-grown');
      // invertierte Ebenenmaske (Hintergrund) → das Loch ist die ursprüngliche Maske
      this.core.loadMask(frame, this.sources.mask(m.id), hole, !m.inverted);
      this.core.dilateMask(frame, hole, grown, Math.max(2, 0.004 * Math.max(cw, ch)));
      this.core.holeFill(frame, this.sources.at(frame, layer.originalId, cw, ch), grown, out);
      this.core.pool.release(hole);
      this.core.pool.release(grown);
    });
    return { tex, key };
  }

  private auxFor(frame: Frame, layer: Layer, maskTex: GPUTexture | null, opts: RenderOptions): AuxProvider {
    const points = (layer.focusMap?.points ?? []).filter((p) => p.enabled && p.radius > 0);
    const owned: GPUTexture[] = [];
    let aux: Aux | null = null;
    return {
      key: points.length ? `focus${JSON.stringify(points.map((p) => [p.x, p.y, p.radius]))}` : 'nofocus',
      get: () => {
        if (aux) return aux;
        let mask = this.core.white;
        if (maskTex) {
          const r = this.region(frame, maskTex, opts, 'mask-region');
          if (r.owned) owned.push(r.tex);
          mask = r.tex;
        }
        let focus = this.core.black;
        if (points.length) {
          focus = this.core.pool.acquire(opts.region.width, opts.region.height, 'focus');
          owned.push(focus);
          this.core.focusMap(frame, points, focus, [opts.region.x, opts.region.y], opts.scale);
        }
        aux = { mask, focus, depth: this.core.black, hasFocus: points.length > 0 };
        return aux;
      },
      release: () => {
        for (const t of owned) this.core.pool.release(t);
      },
    };
  }

  /** Rendert eine Ebene; liefert zusätzlich den Schatten (falls sichtbar). */
  private layer(
    frame: Frame,
    layer: Layer,
    opts: RenderOptions,
  ): { result: RenderResult; shadow: RenderResult | null } {
    const [cw, ch] = opts.canvasSize;
    const r = opts.region;
    const regionKey = `[${r.x},${r.y},${r.width},${r.height}]`;
    // Phase 1–3: das Original füllt die Leinwand (Transform folgt in Phase 4).
    const filled = layer.holeFill ? this.filledSource(frame, layer, opts) : null;
    const base = filled?.tex ?? this.sources.at(frame, layer.originalId, cw, ch);
    const baseKey = filled?.key ?? `${layer.originalId}@${cw}x${ch}`;
    const mask = filled ? null : this.processedMask(frame, layer, opts);

    const baseRegion = this.region(frame, base, opts, 'region');
    let src: RenderResult = { tex: baseRegion.tex, key: baseKey + regionKey, owned: baseRegion.owned };
    if (mask) {
      const key = `${src.key}*${mask.key}`;
      const slot = `${opts.variant}:${layer.id}:masked`;
      const cached = opts.cache?.get(slot, key);
      if (cached) {
        this.release(src);
        src = { tex: cached, key, owned: false };
      } else {
        const maskRegion = this.region(frame, mask.tex, opts, 'mask-region');
        const out = this.core.pool.acquire(r.width, r.height, 'masked');
        this.core.maskApply(frame, src.tex, maskRegion.tex, out);
        if (maskRegion.owned) this.core.pool.release(maskRegion.tex);
        this.release(src);
        if (opts.cache) {
          opts.cache.set(slot, key, out);
          src = { tex: out, key, owned: false };
        } else src = { tex: out, key, owned: true };
      }
    }

    const aux = this.auxFor(frame, layer, mask?.tex ?? null, opts);
    let shadow: RenderResult | null = null;
    const sh = layer.shadow;
    if (sh?.visible && !opts.ignoreEffects) {
      const gen: EffectInstance = {
        instanceId: `${sh.id}:gen`,
        effectId: 'shadow',
        effectVersion: sh.effectVersion,
        enabled: true,
        strength: 1,
        params: sh.params,
        region: 'whole',
      };
      // Schatten leitet sich aus der maskierten Ebene ab (vor ihren Effekten)
      const input: RenderResult = { ...src, owned: false };
      const generated = this.effects(frame, `${sh.id}:gen`, [gen], input, opts, aux);
      // Plugin fehlt oder ist fehlerhaft → kein Schatten
      shadow = generated === input ? null : this.effects(frame, sh.id, sh.effects, generated, opts, aux);
    }
    const result = this.effects(frame, layer.id, layer.effects, src, opts, aux);
    aux.release();
    return { result, shadow };
  }

  private group(frame: Frame, group: Group, opts: RenderOptions): RenderResult | null {
    const parts: { res: RenderResult; opacity: number; blend: BlendMode }[] = [];
    for (const child of group.children) {
      if (!child.visible) continue;
      if (child.kind === 'layer') {
        const { result, shadow } = this.layer(frame, child, opts);
        if (shadow && child.shadow)
          parts.push({ res: shadow, opacity: child.shadow.opacity, blend: child.shadow.blendMode });
        parts.push({ res: result, opacity: child.opacity, blend: child.blendMode });
      } else {
        const res = this.group(frame, child, opts);
        if (res) parts.push({ res, opacity: child.opacity, blend: child.blendMode });
      }
    }
    let comp: RenderResult;
    const first = parts[0];
    if (parts.length === 1 && first && first.opacity >= 1 && first.blend === 'normal') {
      comp = first.res;
    } else {
      const key = `group(${parts.map((p) => `${p.res.key}*${p.opacity}${p.blend}`).join(',')})`;
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
          this.core.blend(frame, base, p.res.tex, out, p.opacity, p.blend);
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
    return this.effects(frame, group.id, group.effects, comp, opts, null);
  }

  private effects(
    frame: Frame,
    hostId: string,
    effects: EffectInstance[],
    input: RenderResult,
    opts: RenderOptions,
    aux: AuxProvider | null,
  ): RenderResult {
    let cur = input;
    if (opts.ignoreEffects) return cur;
    const auxKey = aux?.key ?? 'noaux';
    effects.forEach((fx, i) => {
      if (!fx.enabled) return;
      const plugin = getPlugin(fx.effectId);
      if (plugin?.status !== 'ok' || !this.runner.isCompiled(plugin)) return;
      const key = `${cur.key}|${fx.effectId}#${plugin.revision}${JSON.stringify([fx.params, fx.strength, fx.region])}${auxKey}`;
      const slot = `${opts.variant}:${hostId}:fx${i}`;
      const cached = opts.cache?.get(slot, key);
      if (cached) {
        this.release(cur);
        cur = { tex: cached, key, owned: false };
        return;
      }
      this.effectRuns++;
      const a = aux?.get() ?? {
        mask: this.core.white,
        focus: this.core.black,
        depth: this.core.black,
        hasFocus: false,
      };
      const out = this.runner.apply(frame, plugin, fx, cur.tex, a, {
        scale: opts.scale,
        origin: [opts.region.x, opts.region.y],
        canvasSize: opts.canvasSize,
        hasFocus: a.hasFocus,
      });
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
  const sum = (list: EffectInstance[]) => list.filter((e) => e.enabled).reduce((s, e) => s + reachOf(e), 0);
  const own = sum(node.effects);
  if (node.kind === 'layer') {
    const sh = node.shadow;
    const shadowReach = sh?.visible
      ? reachOf({
          instanceId: '',
          effectId: 'shadow',
          effectVersion: sh.effectVersion,
          enabled: true,
          strength: 1,
          params: sh.params,
          region: 'whole',
        }) + sum(sh.effects)
      : 0;
    return Math.max(own, shadowReach);
  }
  return own + Math.max(0, ...node.children.filter((c) => c.visible).map((c) => projectReach(c, reachOf)));
}
