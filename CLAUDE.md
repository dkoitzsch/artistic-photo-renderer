# Blur & Layer Studio

Blur & Layer Studio ist eine lokale Web-App für Kunstprojekte: Sie zerlegt Bilder automatisch oder per Pinsel in Ebenen
und gibt jeder Ebene eigene Unschärfe, Farbe, Schwarz-Weiß und Schatten – in Echtzeit auf der GPU (WebGPU).
Ästhetisches Ziel sind starke Unschärfe und Überschneidungen, bei denen gezielte Fokuspunkte (Augen, Gesicht, Brust, Hände) schärfer bleiben.

**Verbindliche Spezifikation:** [SPEC-artistic-photo-renderer.md](SPEC-artistic-photo-renderer.md).
Abweichungen nur mit Eintrag in [DECISIONS.md](DECISIONS.md) und Hinweis an den Nutzer.

## Status

Abgeschlossen: **Phase 0 – Gerüst**, **Phase 1 – Ganzes Bild**, **Phase 2 – Vordergrund, Fokus, Schatten**. Nächste: Phase 3 (wartet auf Freigabe). Erledigte Punkte werden in der Spec abgehakt.

## Ordnerstruktur (✓ = existiert)

```
src/                                                                     ✓
  app/        React-UI: components/, controls/ (Regler), theme/          ✓
  state/      Zustand-Store, Projektmodell, Befehle (commands.ts), History ✓
  render/     WebGPU-Engine, Compositor, Effekt-Runner, Texturpool, Shader ✓
  effects/    Plugin-Kern: Registry, Manifest-Validator, Uniform-Layout,  ✓
              WGSL-Vorspiel, effect.ts-API (Kern! Effekte liegen in /effects)
  io/         Import, Export, Projektdatei, OPFS-Speicher, Autosave       ✓
  ml/         ML-Worker (ORT + MediaPipe), MlBackend (Browser/Dienst),    ✓
              Aufteilen, Fokuspunkte, Register-Zugriff
effects/      Effekt-Plugins, je ein Ordner + _template/ + README.md     ✓
models/       registry.json (einzige Quelle für Modelle/ML-Bibliotheken)  ✓  (Übersicht: MODELS.md)
ml-service/   Python-Dienst (uv, FastAPI, PyTorch/MPS) + pytest           ✓
scripts/      dev.mjs (App + Dienst), fetch-models.mjs (Test-Cache)       ✓
tests/
  unit/       Vitest (reine Logik)                                        ✓
  e2e/        Playwright (Chrome mit WebGPU), CPU-Referenzen               ✓
  golden/     Referenzbilder der Golden-Tests                             ✓
  fixtures/   Testbilder (synthetisch + CC0-Fotos, Herkunft in LICENSES.md) ✓
  .cache/     Modelle für Tests (npm run models:fetch, nicht im Repo)
```

## Konventionen

- **TypeScript strict** (+ `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`); kein `any` ohne Begründung.
- **Farbe**: intern linearer Farbraum mit vormultipliziertem Alpha, Texturformat `rgba16float`.
  sRGB nur beim Import (Dekodieren → linear) und bei Anzeige/Export (linear → sRGB).
- **Effekte nur als Plugins** unter `effects/`; der Kern kennt keine konkreten Effekte.
  Ausnahmen (Kern-Stufen, siehe DECISIONS.md): Kantenübergang der Maske (`maskEdge`) und die Mischmodi des Compositors.
- **Modelle nur über `models/registry.json`**; Lizenz vorher an der Quelle prüfen und in `MODELS.md` eintragen.
  Gilt auch für ML-Bibliotheken; Bibliothekslizenzen allgemein vor dem Einbau prüfen (`DEPENDENCIES.md`).
- **Lizenzmodus**: NC-Modelle nur im Modus „Alle“; Prüfung an drei Stellen (UI, ML-Worker `assertAllowed`, Dienst HTTP 403).
  Jedes ML-Ergebnis trägt `provenance` (Modell, kommerziell ja/nein).
- **Keine Netzwerkanfragen** außer dem einmaligen Laden der Modelle. Keine Telemetrie, keine CDN-Fonts, kein CDN-WASM.
- Originale sind unveränderlich; alle Bearbeitungen nicht-destruktiv.
- Datenmodell-Typ `Node` heißt im Code `SceneNode` (Kollision mit dem DOM-Typ `Node`).
- Shader als `.wgsl`-Dateien, importiert per `?raw`.
- Zielbrowser: Chrome auf macOS. Safari/Firefox kein Ziel.

## Befehle

Node ≥ 22.12 (`.nvmrc`). Dev-Server auf **Port 5317** (5173 ist auf diesem Rechner belegt).

| Befehl                             | Zweck                                                                  |
| ---------------------------------- | ---------------------------------------------------------------------- |
| `npm run dev`                      | Web-App (http://localhost:5317) **und** ML-Dienst (127.0.0.1:8765)     |
| `npm run dev:web`                  | nur Web-App (Vite, Hot Reload)                                         |
| `npm run service`                  | nur ML-Dienst (`uv run --project ml-service ml-service`)               |
| `npm run test:service`             | pytest des Dienstes                                                    |
| `npm run models:fetch`             | Browser-Modelle für Tests nach `tests/.cache/models` (SHA-256-geprüft) |
| `npm run build`                    | Typecheck + Produktions-Build nach `dist/`                             |
| `npm run preview`                  | Build lokal ansehen (Port 4317)                                        |
| `npm run typecheck`                | `tsc -b` (App + Node-Konfiguration)                                    |
| `npm run lint`                     | ESLint (typgeprüft, strict)                                            |
| `npm run format`                   | Prettier                                                               |
| `npm test`                         | Unit-Tests (Vitest, `tests/unit/`)                                     |
| `npm run test:e2e`                 | E2E- und Golden-Tests (Playwright, echtes Chrome mit WebGPU, headless) |
| `npm run fixtures`                 | synthetische Testbilder neu erzeugen                                   |
| `UPDATE_GOLDEN=1 npm run test:e2e` | Golden-Referenzbilder neu schreiben (danach ansehen!)                  |

Phasen-Abschluss: `npm run lint && npm run typecheck && npm test && npm run test:service && npm run build && npm run test:e2e`
(E2E mit Modellen braucht einmalig `npm run models:fetch`, sonst werden diese Tests übersprungen.)

## Architektur (Stand Phase 2)

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
- `src/debug.ts` – nur im Dev-Server: `window.__bls` (Store, Befehle, Engine, ML) für Tests.

**Phase 2:**

- Ebene: Original → (Lochfüllung **oder** Maske mit Kantenübergang `core.processMask`) → Effekte (Zusatzeingänge Maske und
  Fokuskarte, lazy) → Compositor mit Mischmodi; ein Schatten-Layer wird direkt darunter aus der maskierten Ebene erzeugt
  (Plugin `shadow` + eigener Effekt-Stapel). Abgeleitete Texturen (aufbereitete Maske, Lochfüllung) cacht `SourceStore.derive`
  mit LRU-Budget.
- Kern-Shader: `gauss` (auch `ctx.gaussian`), `maskops` (Skalieren/Invertieren, Min/Max, Schwelle, Kurve), `guided`
  (Guided Filter zum Hochskalieren der Modellmaske), `pushpull` (Lochfüllung), `focusmap`, `blend` (alle Mischmodi).
- `ml/worker.ts` – Modelle aus dem Register: Download mit Fortschritt, SHA-256, OPFS-Cache; ORT (nativer WebGPU-EP mit eigenem
  Gerät) für Segmentierung, MediaPipe (CPU) für Landmarken. `ml/backend.ts` – `MlBackend` (Browser/Dienst), Auswahl Auto/Browser/
  Dienst, Rückfall, `/health`-Überwachung. `ml/split.ts` – Aufteilen (Gruppe „Motiv“), Fokuspunkte, NC-Prüfung, Neuberechnung.
  `ml/focus.ts` – Landmarken → Fokuspunkte.
- `ml-service/` – FastAPI: `/health`, `/segment/foreground` (Job), `/jobs/{id}[/result]`, Modell-Downloads
  `/models/{id}/download|pause|stop` und `DELETE /models/{id}` (`downloads.py`); liest dasselbe Register.
- `ml/downloads.ts` – Download-Manager im ML-Worker (OPFS `.part`, Range-Fortsetzen, SHA-256); Zustand → Store
  `downloads` → Dialog „Modelle“ (`app/components/ModelsDialog.tsx`) und Anzeige in der oberen Leiste.

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
- Ohne WebGPU zeigt die App nur eine Meldung; es gibt keinen WebGL2-Render-Pfad (siehe DECISIONS.md).
- Browser-Segmentierung: BiRefNet lite mit 512 × 512 Eingang (1024er-Fassungen laufen in Chrome nicht); feinste Haarkanten
  liefert der Python-Dienst (BiRefNet voll). RMBG-2.0 im Dienst braucht einen Hugging-Face-Zugang (`HF_TOKEN`).
- Lochfüllung (Push-Pull) setzt deckende Fotos voraus; Transparenz im Original wird im gefüllten Hintergrund deckend.
- Bei 24 MP belegen Original, aufbereitete Maske und Lochfüllung je ~190 MB GPU-Speicher pro Ebene (LRU-Budget 1,5 GB).
- Legt man einen Plugin-Ordner an oder löscht ihn, lädt Vite die Seite neu; die App öffnet das Projekt danach wieder.
  Änderungen an bestehenden Plugin-Dateien laden ohne Neuladen nach. Ein Produktions-Build braucht für neue Plugins einen Neubau.
- Die Anzeige zeigt die Vorschau (≤ 2048 px); bei starkem Hineinzoomen in größere Bilder sieht man Vorschau-Pixel.
- Ist der Dienst aus, meldet die Browser-Konsole alle 20 s einen fehlgeschlagenen `/health`-Aufruf (ML-Modus „Browser“ vermeidet das).
- Browser-Kürzel (⌘0, ⌘E, ⌘O, ⌘S) werden per `preventDefault` abgefangen; in Playwright getestet, im echten Chrome manuell zu prüfen.
