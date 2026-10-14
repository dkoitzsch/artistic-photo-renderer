# Blur & Layer Studio

Blur & Layer Studio ist eine lokale Web-App für Kunstprojekte: Sie zerlegt Bilder automatisch oder per Pinsel in Ebenen
und gibt jeder Ebene eigene Unschärfe, Farbe, Schwarz-Weiß und Schatten – in Echtzeit auf der GPU (WebGPU).
Ästhetisches Ziel sind starke Unschärfe und Überschneidungen, bei denen gezielte Fokuspunkte (Augen, Gesicht, Brust, Hände) schärfer bleiben.

**Verbindliche Spezifikation:** [SPEC-artistic-photo-renderer.md](SPEC-artistic-photo-renderer.md).
Abweichungen nur mit Eintrag in [DECISIONS.md](DECISIONS.md) und Hinweis an den Nutzer.

## Status

Abgeschlossen: **Phase 0 – Gerüst**, **Phase 1 – Ganzes Bild**. Nächste: Phase 2 (wartet auf Freigabe). Erledigte Punkte werden in der Spec abgehakt.

## Ordnerstruktur (✓ = existiert)

```
src/                                                                     ✓
  app/        React-UI: components/, controls/ (Regler), theme/          ✓
  state/      Zustand-Store, Projektmodell, Befehle (commands.ts), History ✓
  render/     WebGPU-Engine, Compositor, Effekt-Runner, Texturpool, Shader ✓
  effects/    Plugin-Kern: Registry, Manifest-Validator, Uniform-Layout,  ✓
              WGSL-Vorspiel, effect.ts-API (Kern! Effekte liegen in /effects)
  io/         Import, Export, Projektdatei, OPFS-Speicher, Autosave       ✓
  ml/         Worker, Modell-Lader, MlBackend (Browser/Service)          – ab Phase 2
effects/      Effekt-Plugins, je ein Ordner + _template/ + README.md     ✓
models/       registry.json (einzige Quelle für Modelle/ML-Bibliotheken), MODELS.md – ab Phase 2
ml-service/   Python-Dienst (uv, FastAPI)                                 – ab Phase 2
tests/
  unit/       Vitest (reine Logik)                                        ✓
  e2e/        Playwright (Chrome mit WebGPU), CPU-Referenzen               ✓
  golden/     Referenzbilder der Golden-Tests                             ✓
  fixtures/   Testbilder (synthetisch; fremde Bilder + LICENSES.md ab Phase 2) ✓
```

## Konventionen

- **TypeScript strict** (+ `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`); kein `any` ohne Begründung.
- **Farbe**: intern linearer Farbraum mit vormultipliziertem Alpha, Texturformat `rgba16float`.
  sRGB nur beim Import (Dekodieren → linear) und bei Anzeige/Export (linear → sRGB).
- **Effekte nur als Plugins** unter `effects/`; der Kern kennt keine konkreten Effekte.
  Ausnahmen (Kern-Stufen, siehe DECISIONS.md): Kantenübergang der Maske (`maskEdge`) und die Mischmodi des Compositors.
- **Modelle nur über `models/registry.json`**; Lizenz vorher an der Quelle prüfen und in `MODELS.md` eintragen.
  Gilt auch für ML-Bibliotheken; Bibliothekslizenzen allgemein vor dem Einbau prüfen.
- **Keine Netzwerkanfragen** außer dem einmaligen Laden der Modelle. Keine Telemetrie, keine CDN-Fonts, kein CDN-WASM.
- Originale sind unveränderlich; alle Bearbeitungen nicht-destruktiv.
- Datenmodell-Typ `Node` heißt im Code `SceneNode` (Kollision mit dem DOM-Typ `Node`).
- Shader als `.wgsl`-Dateien, importiert per `?raw`.
- Zielbrowser: Chrome auf macOS. Safari/Firefox kein Ziel.

## Befehle

Node ≥ 22.12 (`.nvmrc`). Dev-Server auf **Port 5317** (5173 ist auf diesem Rechner belegt).

| Befehl                             | Zweck                                                                  |
| ---------------------------------- | ---------------------------------------------------------------------- |
| `npm run dev`                      | Dev-Server (Vite, Hot Reload) auf http://localhost:5317                |
| `npm run build`                    | Typecheck + Produktions-Build nach `dist/`                             |
| `npm run preview`                  | Build lokal ansehen (Port 4317)                                        |
| `npm run typecheck`                | `tsc -b` (App + Node-Konfiguration)                                    |
| `npm run lint`                     | ESLint (typgeprüft, strict)                                            |
| `npm run format`                   | Prettier                                                               |
| `npm test`                         | Unit-Tests (Vitest, `tests/unit/`)                                     |
| `npm run test:e2e`                 | E2E- und Golden-Tests (Playwright, echtes Chrome mit WebGPU, headless) |
| `npm run fixtures`                 | synthetische Testbilder neu erzeugen                                   |
| `UPDATE_GOLDEN=1 npm run test:e2e` | Golden-Referenzbilder neu schreiben (danach ansehen!)                  |

Phasen-Abschluss: `npm run lint && npm run typecheck && npm test && npm run build && npm run test:e2e`

## Architektur (Stand Phase 1)

**Datenfluss:** UI → Befehl (`state/commands.ts`) → History (`state/history.ts`, unveränderliche Schnappschüsse) →
Zustand-Store → `CanvasView` ruft pro Frame `Engine.present()` → Compositor rendert nur Geändertes → Anzeige.
Autosave (`io/autosave.ts`) beobachtet den Store und schreibt ins OPFS.

- `render/engine.ts` – `Engine`: Plugins kompilieren, Vorschau (lange Kante ≤ 2048 px, `ResultCache`), Vorher/Nachher,
  Anzeige-Pass, `renderFull()` (Export in 2048-px-Kacheln mit Überlappung), `encode()` (linear → 8-Bit-sRGB), Live-Miniaturen.
- `render/compositor.ts` – rendert den Baum hinten → vorn; Cache-Schlüssel je Layer und Effektschritt aus Eingang + Parametern.
  `projectReach()` = Kachelüberlappung.
- `render/effectRunner.ts` – kompiliert Plugins (Fehler mit Zeilennummer in `effect.wgsl`), feste Bindungen, Uniforms aus dem
  Manifest, ein-/mehrstufige Pässe, danach Mischung nach `strength`/`region` (`shaders/mix.wgsl`).
- `render/core.ts`, `texturePool.ts`, `sources.ts` – Kern-Pipelines (Import, Resample, Mix, Blend, Fill, Encode),
  Texturpool + `Frame` (ein Encoder pro Frame), Originale auf der GPU (voll + verkleinert).
- `effects/registry.ts` – findet `effects/*/` per `import.meta.glob`, validiert, lädt `effect.ts`; HMR-fähig.
  `effects/layout.ts` (WGSL-Ausrichtung, Werte-Umrechnung), `effects/prelude.ts` (generiertes Vorspiel), `effects/expr.ts`
  (sicherer Ausdrucksauswerter für `reach`/`visibleIf`).
- `io/` – `import.ts` (Bild → Projekt, `.blurstudio`, gespeicherte Projekte), `projectFile.ts` (ZIP via fflate),
  `projectSchema.ts` (Prüfung beim Laden), `storage.ts` (OPFS), `autosave.ts`, `session.ts`, `export.ts`.
- `app/controls/` – Regler (linear/log, Doppelklick = Standard, Shift = fein, Zahleneingabe), Farbe + Pipette, Enum, Schalter,
  `ParamControl` erzeugt sie aus dem Manifest.
- `src/debug.ts` – nur im Dev-Server: `window.__bls` (Store, Befehle, Engine) für Tests.

**Neuen Effekt anlegen:** siehe [effects/README.md](effects/README.md) – nur einen Ordner unter `effects/` anlegen.

## Referenz-Hardware

Apple M4 Pro (14 CPU-/20 GPU-Kerne), 48 GB RAM, macOS 26.6, Chrome 155. Die Performance-Ziele der Spec gelten auf diesem Rechner.

## Regel: Abschluss jeder Phase

Eine Phase ist erst fertig, wenn

1. Tests (`npm test`, `npm run test:e2e`), Lint (`npm run lint`), Typecheck und Build (`npm run build`) grün sind,
2. jedes Abnahmekriterium einzeln geprüft und das Ergebnis dokumentiert ist,
3. die Punkte in der Spec abgehakt und diese Datei aktualisiert sind,
4. auf `main` committet ist (kein Push ohne Anweisung).

Eine neue Phase beginnt nur nach ausdrücklicher Freigabe durch den Nutzer.

## Bekannte Grenzen

- HEIC wird nicht unterstützt (Chrome dekodiert es nicht).
- PNG-Export kodiert über ein 2D-Canvas: halbtransparente Pixel können um ±1–2 Stufen abweichen (8-Bit-Vormultiplizieren).
  Wird durch einen eigenen PNG-Encoder ersetzt, sobald 16-Bit-PNG gebraucht wird.
- Ohne WebGPU zeigt die App nur eine Meldung; es gibt keinen WebGL2-Render-Pfad (siehe DECISIONS.md).
- Der Compositor mischt Ebenen bisher nur „Normal“ (weitere Mischmodi mit mehreren Ebenen ab Phase 2).
- Legt man einen Plugin-Ordner an oder löscht ihn, lädt Vite die Seite neu; die App öffnet das Projekt danach wieder.
  Änderungen an bestehenden Plugin-Dateien laden ohne Neuladen nach. Ein Produktions-Build braucht für neue Plugins einen Neubau.
- Die Anzeige zeigt die Vorschau (≤ 2048 px); bei starkem Hineinzoomen in größere Bilder sieht man Vorschau-Pixel, nicht das Original.
- Browser-Kürzel (⌘0, ⌘E, ⌘O, ⌘S) werden per `preventDefault` abgefangen; in Playwright getestet, im echten Chrome manuell zu prüfen.
