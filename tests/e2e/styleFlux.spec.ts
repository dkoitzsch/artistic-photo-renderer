// Stil-Übertragung mit einem Bildbearbeitungsmodell (FLUX): Modell in den Einstellungen einrichten, Stilbild wählen
// (startet den Lauf), Aktualisieren-Knopf, Prompt-Vorlagen, Verlauf als Ebenen / Ergebnis im Effekt.
// Das Modell ist ein winziges, zufällig initialisiertes FLUX.2-Pipeline-Verzeichnis (ml-service/tests/mini_flux.py):
// Laden, Referenzbild, Größen und Seeds verhalten sich wie beim echten Modell, die Bilder sind Rauschen.

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { TEST_SERVICE_URL } from '../../playwright.config';
import { diffStats, fixture, openFixture, renderExport, waitForApp } from './helpers';

const MINI = join(tmpdir(), 'bls-e2e-mini-flux');
const ROOT = new URL('../../', import.meta.url).pathname;

function buildMini(): boolean {
  if (existsSync(join(MINI, 'model_index.json'))) return true;
  const code =
    "import sys; sys.path.insert(0, 'ml-service/tests'); from pathlib import Path; from mini_flux import build; build(Path(sys.argv[1]))";
  const r = spawnSync('uv', ['run', '--project', 'ml-service', 'python', '-c', code, MINI], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  return r.status === 0;
}

const params = (page: Page, layerId: string) =>
  page.evaluate((id) => {
    const l = window.__bls.getProject()?.root.children.find((c) => c.id === id);
    return l?.kind === 'layer' ? (l.effects[0]?.params ?? {}) : {};
  }, layerId);

const rootNames = (page: Page) =>
  page.evaluate(() =>
    (window.__bls.getProject()?.root.children ?? []).map((c) => ({ name: c.name, visible: c.visible })),
  );

test.describe('Stil übertragen (FLUX)', () => {
  test.beforeAll(() => {
    test.skip(!buildMini(), 'uv/Mini-Modell nicht verfügbar');
  });

  test('Einrichten, Stilbild wählen → Lauf, Aktualisieren, Prompt ändern, Verlauf, Vorlagen, Entfernen', async ({
    page,
  }) => {
    test.setTimeout(300_000);
    await page.addInitScript((url) => {
      localStorage.setItem('bls.serviceUrl', url);
      localStorage.setItem('bls.settings', JSON.stringify({ licenseMode: 'commercial', mlMode: 'browser' }));
      localStorage.removeItem('bls.stylePrompts');
    }, TEST_SERVICE_URL);
    await waitForApp(page);

    // Alte Konfiguration des Test-Dienstes entfernen (falls ein früherer Lauf sie hinterlassen hat)
    await page.evaluate(async (url) => {
      await fetch(`${url}/ml/models/flux2-klein-9b`, { method: 'DELETE' });
    }, TEST_SERVICE_URL);

    await openFixture(page, 'golden/portrait.png');
    const layerId = await page.evaluate(() => window.__bls.getProject()?.root.children[0]?.id ?? '');
    await page.evaluate((id) => {
      window.__bls.commands.addEffectCommand('style-flux', id);
    }, layerId);
    const panel = page.getByTestId('style-flux-panel');
    await expect(panel).toBeVisible();
    // ohne Modell: Hinweis, Aktualisieren gesperrt
    await expect(page.getByTestId('style-flux-status')).toHaveAttribute('data-ready', '0');
    await expect(page.getByTestId('style-flux-status')).toContainText('Kein Modell eingerichtet');
    await expect(page.getByTestId('style-flux-refresh')).toBeDisabled();

    // Modell in den Einstellungen einrichten (Speicherort angeben)
    await page.evaluate(() => {
      window.__bls.store.getState().setSettingsOpen(true);
    });
    await expect(page.getByTestId('ml-models-settings')).toBeVisible();
    await page.getByTestId('ml-model-root').fill(MINI);
    await page.getByTestId('ml-model-precision').selectOption('fp32');
    await page.getByTestId('ml-model-offload').selectOption('none');
    await page.getByTestId('ml-model-steps').fill('2');
    await page.getByTestId('ml-model-save').click();
    await expect(page.getByTestId('ml-model-status')).toHaveAttribute('data-available', '1', {
      timeout: 20_000,
    });
    await expect(page.getByTestId('ml-model-status')).toContainText('Flux2KleinPipeline');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('style-flux-status')).toHaveAttribute('data-ready', '1');

    // Vorlage: Standard ist „Stiltreu“; Prompt automatisch gefüllt
    await expect(page.getByTestId('style-flux-preset')).toHaveValue('faithful');
    await expect(page.getByTestId('style-flux-prompt')).toHaveValue(
      /Redraw image 1 in the artistic style of image 2/,
    );

    // Stilbild laden → Lauf startet automatisch, Ergebnis als neue Ebene (Verlauf)
    const chooser = page.waitForEvent('filechooser');
    await page.getByTestId('style-flux-style-load').click();
    await (await chooser).setFiles(fixture('golden/landscape.png'));
    await expect.poll(async () => (await rootNames(page)).length, { timeout: 120_000 }).toBe(2);
    expect((await rootNames(page))[1]?.name).toBe('Stil-Transfer 1 · portrait');
    const p1 = await params(page, layerId);
    expect(p1.result).toBe('');
    expect(typeof p1.appliedKey === 'string' && p1.appliedKey.length === 16).toBe(true);
    const seed1 = p1.seed;
    await expect(page.getByTestId('style-flux-refresh')).toHaveAttribute('data-dirty', '0');

    // Aktualisieren ohne Änderung: neue Variante (anderer Seed), frühere Ebene bleibt, wird ausgeblendet
    await page.getByTestId('style-flux-refresh').click();
    await expect.poll(async () => (await rootNames(page)).length, { timeout: 120_000 }).toBe(3);
    const names = await rootNames(page);
    expect(names.map((n) => n.name)).toEqual([
      'portrait',
      'Stil-Transfer 2 · portrait',
      'Stil-Transfer 1 · portrait',
    ]);
    expect(names.map((n) => n.visible)).toEqual([true, true, false]);
    expect((await params(page, layerId)).seed).not.toBe(seed1);

    // Prompt ändern: der Aktualisieren-Knopf zeigt eine Änderung an
    await page.getByTestId('style-flux-prompt').fill('Paint image 1 like image 2, but with harsh contrast.');
    await page.getByTestId('style-flux-prompt').blur();
    await expect(page.getByTestId('style-flux-preset')).toHaveValue('custom');
    await expect(page.getByTestId('style-flux-refresh')).toHaveAttribute('data-dirty', '1');
    const seed2 = (await params(page, layerId)).seed;
    await page.getByTestId('style-flux-refresh').click();
    await expect.poll(async () => (await rootNames(page)).length, { timeout: 120_000 }).toBe(4);
    // geänderte Einstellungen: gleicher Seed, jetzt wieder „aktuell“
    expect((await params(page, layerId)).seed).toBe(seed2);
    await expect(page.getByTestId('style-flux-refresh')).toHaveAttribute('data-dirty', '0');

    // Vorlage wählen (Prompt wird gesetzt) → wieder „geändert“
    await page.getByTestId('style-flux-preset').selectOption('colour');
    await expect(page.getByTestId('style-flux-prompt')).toHaveValue(/colour grading, tonal range/);
    await expect(page.getByTestId('style-flux-refresh')).toHaveAttribute('data-dirty', '1');

    // Verlauf „Ergebnis im Effekt“: keine neue Ebene, der Effekt zeigt das Ergebnis (Bild verändert sich)
    await page.getByTestId('style-flux-history').selectOption('overwrite');
    // Verlaufsebenen ausblenden, damit nur der Effekt der Quellebene sichtbar ist
    await page.evaluate(() => {
      for (const c of window.__bls.getProject()?.root.children ?? [])
        if (c.name.startsWith('Stil-Transfer')) window.__bls.commands.setNodeVisibleCommand(c.id, false);
    });
    const before = await renderExport(page);
    await page.getByTestId('style-flux-refresh').click();
    await expect
      .poll(async () => String((await params(page, layerId)).result ?? ''), { timeout: 120_000 })
      .toMatch(/^[0-9a-f]{64}$/);
    expect((await rootNames(page)).length).toBe(4);
    const after = await renderExport(page);
    expect(diffStats(before, after).max).toBeGreaterThan(20);
    // Export in Kacheln = am Stück
    expect(diffStats(after, await renderExport(page, 64)).max).toBeLessThanOrEqual(1);

    // Prompt-Vorlagen in den Einstellungen anpassen: wirkt auf die Auswahl im Effekt
    await page.evaluate(() => {
      window.__bls.store.getState().setSettingsOpen(true);
    });
    await page
      .getByTestId('prompt-template-faithful')
      .fill('Mein eigener Stil-Prompt für Bild 1 und Bild 2.');
    await page.keyboard.press('Escape');
    await page.getByTestId('style-flux-preset').selectOption('painterly');
    await page.getByTestId('style-flux-preset').selectOption('faithful');
    await expect(page.getByTestId('style-flux-prompt')).toHaveValue(
      'Mein eigener Stil-Prompt für Bild 1 und Bild 2.',
    );

    // Eintrag entfernen: Dateien bleiben, der Effekt meldet wieder „kein Modell“
    await page.evaluate(() => {
      window.__bls.store.getState().setSettingsOpen(true);
    });
    await page.getByTestId('ml-model-remove').click();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('style-flux-status')).toHaveAttribute('data-ready', '0');
    expect(existsSync(join(MINI, 'model_index.json'))).toBe(true);
  });
});
