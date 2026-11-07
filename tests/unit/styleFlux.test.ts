import { beforeEach, describe, expect, it, vi } from 'vitest';
import { validateManifest } from '../../src/effects/validate';
import {
  applyStyleRun,
  parseIds,
  runKey,
  shortHash,
  sourceSignature,
  type RunSettings,
} from '../../src/ml/styleFluxModel';
import { PROMPT_PRESETS, templateText, useStylePrompts } from '../../src/ml/stylePrompts';
import {
  addEffect,
  createProjectFromImage,
  findNode,
  type EffectInstance,
  type Layer,
} from '../../src/state/project';
import manifest from '../../effects/style-flux/manifest.json';

const original = {
  id: 'a'.repeat(64),
  fileName: 'foto.jpg',
  mimeType: 'image/jpeg',
  width: 400,
  height: 300,
};
const result = { id: 'b'.repeat(64), fileName: 'Stil.png', mimeType: 'image/png', width: 512, height: 384 };

const styleFx = (params: Record<string, unknown> = {}): EffectInstance => ({
  instanceId: 'fx1',
  effectId: 'style-flux',
  effectVersion: '1.0.0',
  enabled: true,
  strength: 1,
  params: { result: '', styleId: 'c'.repeat(64), prompt: 'P', historyIds: '', ...params },
  region: 'whole',
});

function setup(params: Record<string, unknown> = {}) {
  const p0 = createProjectFromImage(original);
  const layer = p0.root.children[0] as Layer;
  return { p: addEffect(p0, layer.id, styleFx(params)), layerId: layer.id };
}

const args = (layerId: string, mode: 'layers' | 'overwrite', over: Record<string, unknown> = {}) => ({
  hostId: layerId,
  instanceId: 'fx1',
  params: { seed: 5, appliedKey: 'k', ...over },
  original: result,
  mode,
  layerName: 'Stil-Transfer 1 · foto',
});

describe('Stil-Übertragung: Lauf-Schlüssel', () => {
  const base: RunSettings = {
    styleId: 's',
    prompt: 'p',
    seed: 1,
    steps: 0,
    guidance: 0,
    workSize: 1024,
    source: 'q',
  };
  it('ist stabil und reagiert auf jede Einstellung', () => {
    expect(runKey(base)).toBe(runKey({ ...base }));
    expect(shortHash('x')).toHaveLength(16);
    for (const change of [
      { styleId: 't' },
      { prompt: 'p2' },
      { seed: 2 },
      { steps: 4 },
      { guidance: 1 },
      { workSize: 1536 },
      { source: 'r' },
    ])
      expect(runKey({ ...base, ...change })).not.toBe(runKey(base));
    // Leerzeichen am Rand des Prompts zählen nicht
    expect(runKey({ ...base, prompt: ' p ' })).toBe(runKey(base));
  });

  it('Quelle: ändert sich mit Effekten vor dem Stil-Effekt, nicht mit denen danach', () => {
    const { p, layerId } = setup();
    const blur: EffectInstance = {
      ...styleFx(),
      instanceId: 'b1',
      effectId: 'gaussian-blur',
      params: { radius: 5 },
    };
    const before = sourceSignature(p, layerId, 'fx1');
    const withBlurFirst = addEffect(p, layerId, blur, 0);
    const withBlurAfter = addEffect(p, layerId, { ...blur, instanceId: 'b2' });
    expect(sourceSignature(withBlurFirst, layerId, 'fx1')).not.toBe(before);
    expect(sourceSignature(withBlurAfter, layerId, 'fx1')).toBe(before);
  });
});

describe('Stil-Übertragung: Ergebnis anwenden', () => {
  it('„Ergebnis im Effekt“: Effekt zeigt das neue Bild und ersetzt das vorige; keine neue Ebene', () => {
    const { p, layerId } = setup({ result: 'alt' });
    const r = applyStyleRun(p, args(layerId, 'overwrite'));
    expect(r.newLayerId).toBeNull();
    const layer = findNode(r.project.root, layerId) as Layer;
    expect(layer.effects[0]?.params).toMatchObject({ result: result.id, seed: 5, appliedKey: 'k' });
    expect(r.project.originals[result.id]).toEqual(result);
    expect(r.project.root.children).toHaveLength(1);
  });

  it('„Verlauf als Ebenen“: neue Ebene über der Quelle, frühere ausgeblendet, Effekt zeigt nichts', () => {
    const { p, layerId } = setup({ result: 'x' });
    const r1 = applyStyleRun(p, args(layerId, 'layers'));
    expect(r1.newLayerId).not.toBeNull();
    const kids1 = r1.project.root.children;
    expect(kids1.map((c) => c.name)).toEqual(['foto', 'Stil-Transfer 1 · foto']);
    expect((kids1[1] as Layer).originalId).toBe(result.id);
    expect((kids1[1] as Layer).visible).toBe(true);
    const fx1 = (findNode(r1.project.root, layerId) as Layer).effects[0];
    expect(fx1?.params.result).toBe('');
    expect(parseIds(fx1?.params.historyIds)).toEqual([r1.newLayerId]);

    // zweiter Lauf: die erste Verlaufsebene wird ausgeblendet und bleibt erhalten
    const second = { ...result, id: 'd'.repeat(64) };
    const r2 = applyStyleRun(r1.project, {
      ...args(layerId, 'layers'),
      original: second,
      layerName: 'Stil-Transfer 2 · foto',
    });
    const kids2 = r2.project.root.children as Layer[];
    expect(kids2.map((c) => c.name)).toEqual(['foto', 'Stil-Transfer 2 · foto', 'Stil-Transfer 1 · foto']);
    expect(kids2.find((c) => c.id === r1.newLayerId)?.visible).toBe(false);
    expect(kids2.find((c) => c.id === r2.newLayerId)?.visible).toBe(true);
    expect(
      parseIds((findNode(r2.project.root, layerId) as Layer).effects[0]?.params.historyIds),
    ).toHaveLength(2);
    // Die Quellebene und ihr Original bleiben unverändert
    expect((kids2[0] as Layer).originalId).toBe(original.id);
  });

  it('unbekannter Effekt: Projekt bleibt unverändert', () => {
    const { p, layerId } = setup();
    const r = applyStyleRun(p, { ...args(layerId, 'overwrite'), instanceId: 'nope' });
    expect(r.project).toBe(p);
  });
});

describe('Manifest und Prompt-Vorlagen', () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => store.set(k, v),
      removeItem: (k: string) => store.delete(k),
    });
    for (const p of PROMPT_PRESETS) useStylePrompts.getState().resetTemplate(p.id);
  });

  it('style-flux ist gültig, hat ein Bedienfeld und verbirgt seine technischen Parameter', () => {
    const v = validateManifest(manifest, 'style-flux');
    expect(v.ok).toBe(true);
    const m = manifest as { panel: string; params: { key: string; hidden?: boolean }[] };
    expect(m.panel).toBe('style-flux');
    const hidden = m.params.filter((x) => x.hidden).map((x) => x.key);
    expect(hidden).toEqual(
      expect.arrayContaining([
        'result',
        'styleId',
        'prompt',
        'promptPreset',
        'history',
        'workSize',
        'appliedKey',
        'historyIds',
      ]),
    );
  });

  it('prüft hidden und panel', () => {
    const bad = { ...manifest, panel: 5 };
    expect(validateManifest(bad, 'style-flux').ok).toBe(false);
    const bad2 = {
      ...manifest,
      params: manifest.params.map((p, i) => (i === 0 ? { ...p, hidden: 'ja' } : p)),
    };
    expect(validateManifest(bad2, 'style-flux').ok).toBe(false);
  });

  it('drei Standardvorlagen, anpassbar und zurücksetzbar', () => {
    expect(PROMPT_PRESETS.map((p) => p.id)).toEqual(['faithful', 'painterly', 'colour']);
    for (const p of PROMPT_PRESETS) expect(templateText(p.id)).toContain('image 2');
    expect(templateText('custom')).toBe('');
    useStylePrompts.getState().setTemplate('faithful', 'Mein Prompt');
    expect(templateText('faithful')).toBe('Mein Prompt');
    expect(JSON.parse(localStorage.getItem('bls.stylePrompts') ?? '{}')).toEqual({ faithful: 'Mein Prompt' });
    useStylePrompts.getState().resetTemplate('faithful');
    expect(templateText('faithful')).toBe(PROMPT_PRESETS[0]?.prompt);
  });
});
