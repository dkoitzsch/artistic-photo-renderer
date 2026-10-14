// Führt Effekt-Plugins auf der GPU aus: Kompilierung (mit Fehlermeldungen fürs UI),
// Uniforms aus dem Manifest, ein- und mehrstufige Pässe, Mischung nach strength/region.

import type { EffectContext, PassOptions } from '../effects/api';
import { packUniforms, shaderValue } from '../effects/layout';
import type { ParamValue } from '../effects/manifest';
import type { Plugin } from '../effects/pluginStore';
import { BINDINGS, buildPrelude, lineCount, SINGLE_PASS_MAIN } from '../effects/prelude';
import type { EffectInstance } from '../state/project';
import type { GpuCore } from './core';
import { dispatch2d, type Frame, WORK_FORMAT } from './texturePool';

type Compiled = {
  revision: number;
  pipelines: Map<string, GPUComputePipeline>;
};

/** Zusatz-Eingänge eines Effekts (Phase 1: Standardtexturen). */
export type AuxInputs = { mask: GPUTexture; focus: GPUTexture; depth: GPUTexture };

export type EffectPlacement = {
  scale: number;
  /** Ebene hat eine Fokuskarte (aux.focus) */
  hasFocus?: boolean;
  /** Lage der Eingangstextur auf der Leinwand, in px bei aktuellem scale */
  origin: [number, number];
  canvasSize: [number, number];
};

const REGION_INDEX: Record<EffectInstance['region'], number> = {
  whole: 0,
  'focus-weighted': 1,
  'inverse-focus': 2,
};

/** Findet die Compute-Einstiegspunkte eines Shaders. */
export function computeEntryPoints(wgsl: string): string[] {
  return [...wgsl.matchAll(/@compute[\s\S]*?fn\s+([A-Za-z_]\w*)/g)].map((m) => m[1] ?? '');
}

export class EffectRunner {
  private readonly compiled = new Map<string, Compiled>();
  private readonly bindGroupLayout: GPUBindGroupLayout;
  private readonly pipelineLayout: GPUPipelineLayout;

  constructor(private readonly core: GpuCore) {
    const tex = (binding: number): GPUBindGroupLayoutEntry => ({
      binding,
      visibility: GPUShaderStage.COMPUTE,
      texture: { sampleType: 'float' },
    });
    this.bindGroupLayout = core.device.createBindGroupLayout({
      label: 'effect',
      entries: [
        { binding: BINDINGS.params, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
        { binding: BINDINGS.pass, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
        tex(BINDINGS.src),
        tex(BINDINGS.mask),
        tex(BINDINGS.focus),
        tex(BINDINGS.depth),
        { binding: BINDINGS.sampler, visibility: GPUShaderStage.COMPUTE, sampler: { type: 'filtering' } },
        {
          binding: BINDINGS.dst,
          visibility: GPUShaderStage.COMPUTE,
          storageTexture: { access: 'write-only', format: WORK_FORMAT },
        },
        tex(BINDINGS.srcB),
      ],
    });
    this.pipelineLayout = core.device.createPipelineLayout({ bindGroupLayouts: [this.bindGroupLayout] });
  }

  isCompiled(plugin: Plugin): boolean {
    return this.compiled.get(plugin.folder)?.revision === plugin.revision;
  }

  /** Kette, die Kompilierungen nacheinander ausführt (WebGPU-Fehlerbereiche dürfen sich nicht überschneiden). */
  private queue: Promise<unknown> = Promise.resolve();

  /** Kompiliert ein Plugin; liefert Fehlermeldungen (leer = ok). */
  compile(plugin: Plugin): Promise<string[]> {
    const run = this.queue.then(() => this.compileNow(plugin));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async compileNow(plugin: Plugin): Promise<string[]> {
    const { device } = this.core;
    if (!plugin.layout || plugin.wgsl === null) return ['Plugin unvollständig.'];
    const prelude = buildPrelude(plugin.layout);
    const single = !plugin.hasScript;
    const code = `${prelude}\n${plugin.wgsl}\n${single ? SINGLE_PASS_MAIN : ''}`;
    const offset = lineCount(prelude) + 1;

    device.pushErrorScope('validation');
    const module = device.createShaderModule({ label: `effect ${plugin.folder}`, code });
    const info = await module.getCompilationInfo();
    const moduleError = await device.popErrorScope();
    const errors = info.messages
      .filter((m) => m.type === 'error')
      .map((m) => {
        const line = m.lineNum - offset;
        return line > 0 ? `effect.wgsl Zeile ${line}:${m.linePos}: ${m.message}` : `Shader: ${m.message}`;
      });
    if (errors.length) return errors;
    if (moduleError) return [`Shader: ${moduleError.message}`];

    const entries = single ? ['main'] : computeEntryPoints(plugin.wgsl);
    if (!entries.length) return ['effect.wgsl enthält keinen @compute-Einstiegspunkt.'];
    const pipelines = new Map<string, GPUComputePipeline>();
    for (const entryPoint of entries) {
      device.pushErrorScope('validation');
      const pipeline = await device
        .createComputePipelineAsync({
          label: `${plugin.folder}:${entryPoint}`,
          layout: this.pipelineLayout,
          compute: { module, entryPoint },
        })
        .catch((e: unknown) => e as Error);
      const scopeError = await device.popErrorScope();
      if (pipeline instanceof Error || scopeError) {
        const msg = pipeline instanceof Error ? pipeline.message : (scopeError?.message ?? '');
        return [`Pipeline "${entryPoint}": ${msg}`];
      }
      pipelines.set(entryPoint, pipeline);
    }
    this.compiled.set(plugin.folder, { revision: plugin.revision, pipelines });
    return [];
  }

  /**
   * Wendet eine Effekt-Instanz an. Liefert eine neue Pool-Textur (Aufrufer gibt sie frei).
   * Der Eingang bleibt unverändert.
   */
  apply(
    frame: Frame,
    plugin: Plugin,
    instance: EffectInstance,
    input: GPUTexture,
    aux: AuxInputs,
    placement: EffectPlacement,
  ): GPUTexture {
    const compiled = this.compiled.get(plugin.folder);
    const manifest = plugin.manifest;
    if (!compiled || !manifest || !plugin.layout)
      throw new Error(`Effekt ${plugin.folder} ist nicht bereit.`);
    const { pool, device } = this.core;
    const { width, height } = input;

    const raw: Record<string, ParamValue> = {};
    const values: Record<string, number | number[]> = {};
    for (const p of manifest.params) {
      const v = instance.params[p.key] ?? p.default;
      raw[p.key] = v;
      values[p.key] = shaderValue(p, v, placement.scale);
    }
    const paramsBuffer = frame.uniform(
      packUniforms(manifest, plugin.layout, raw, {
        resolution: [width, height],
        origin: placement.origin,
        canvasSize: placement.canvasSize,
        scale: placement.scale,
        flags: placement.hasFocus ? 1 : 0,
      }),
    );

    const runPass = (entryPoint: string, { src, dst, data, srcB }: PassOptions) => {
      const pipeline = compiled.pipelines.get(entryPoint);
      if (!pipeline) throw new Error(`Einstiegspunkt "${entryPoint}" fehlt in ${plugin.folder}/effect.wgsl.`);
      const passData = new Float32Array(8);
      if (data) passData.set(data.slice(0, 8));
      const bindGroup = device.createBindGroup({
        layout: this.bindGroupLayout,
        entries: [
          { binding: BINDINGS.params, resource: { buffer: paramsBuffer } },
          { binding: BINDINGS.pass, resource: { buffer: frame.uniform(passData) } },
          { binding: BINDINGS.src, resource: src.createView() },
          { binding: BINDINGS.mask, resource: aux.mask.createView() },
          { binding: BINDINGS.focus, resource: aux.focus.createView() },
          { binding: BINDINGS.depth, resource: aux.depth.createView() },
          { binding: BINDINGS.sampler, resource: this.core.linearSampler },
          { binding: BINDINGS.dst, resource: dst.createView() },
          { binding: BINDINGS.srcB, resource: (srcB ?? src).createView() },
        ],
      });
      dispatch2d(frame, pipeline, bindGroup, dst.width, dst.height, `${plugin.folder}:${entryPoint}`);
    };

    const output = pool.acquire(width, height, plugin.folder);
    if (!plugin.hasScript) {
      runPass('main', { src: input, dst: output });
    } else {
      if (!plugin.module) throw new Error(`effect.ts von ${plugin.folder} ist nicht geladen.`);
      const temps: GPUTexture[] = [];
      const ctx: EffectContext = {
        width,
        height,
        scale: placement.scale,
        canvasSize: placement.canvasSize,
        params: values,
        raw,
        source: input,
        output,
        hasFocus: placement.hasFocus ?? false,
        gaussian: (src, dst, radius, edge) => {
          this.core.gaussian(frame, src, dst, radius, edge);
        },
        texture: (w, h) => {
          const t = pool.acquire(w, h, `${plugin.folder}-temp`);
          temps.push(t);
          return t;
        },
        run: runPass,
      };
      try {
        plugin.module.run(ctx);
      } finally {
        for (const t of temps) pool.release(t);
      }
    }

    const weight = Math.max(0, Math.min(1, instance.strength));
    const region = REGION_INDEX[instance.region];
    if (weight >= 1 && region === 0) return output;
    const mixed = pool.acquire(width, height, 'mix');
    this.core.mix(frame, input, output, aux.focus, mixed, weight, region);
    pool.release(output);
    return mixed;
  }
}
