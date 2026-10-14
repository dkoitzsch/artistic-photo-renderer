# Blur & Layer Studio

Blur & Layer Studio ist eine lokale Web-App für Kunstprojekte: Sie zerlegt Bilder automatisch oder per Pinsel in Ebenen
und gibt jeder Ebene eigene Unschärfe, Farbe, Schwarz-Weiß und Schatten – in Echtzeit auf der GPU (WebGPU).
Ästhetisches Ziel sind starke Unschärfe und Überschneidungen, bei denen gezielte Fokuspunkte (Augen, Gesicht, Brust, Hände) schärfer bleiben.

**Verbindliche Spezifikation:** [SPEC-artistic-photo-renderer.md](SPEC-artistic-photo-renderer.md).
Abweichungen nur mit Eintrag in [DECISIONS.md](DECISIONS.md) und Hinweis an den Nutzer.

## Status

Abgeschlossen: **Phase 0 – Gerüst**. Nächste: Phase 1 (wartet auf Freigabe). Erledigte Punkte werden in der Spec abgehakt.

## Ordnerstruktur (✓ = existiert)

```
src/
  app/        React-UI, Panels, Theme, Design-Tokens
  state/      Zustand-Store, Commands, History
  render/     WebGPU-Kern (GpuContext), Pässe, Compositor, Texturpool
  ml/         Worker, Modell-Lader, MlBackend (Browser/Service)          – ab Phase 2
  effects/    Plugin-Lader, Manifest-Validator, Regler-Generator          – ab Phase 1
              (Kern! Die Effekte selbst liegen im Wurzelordner effects/)
  io/         Import, Export, Projektdatei, PSD, Speicher (IndexedDB/OPFS)
effects/      Effekt-Plugins, je ein Ordner + _template/ + README.md       – ab Phase 1
models/       registry.json (einzige Quelle für Modelle/ML-Bibliotheken), MODELS.md – ab Phase 2
ml-service/   Python-Dienst (uv, FastAPI)                                 – ab Phase 2
tests/
  unit/       Vitest (reine Logik)
  e2e/        Playwright (Chrome mit WebGPU), Golden-Image-Tests
  fixtures/   Testbilder (+ LICENSES.md für fremde Bilder)
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

| Befehl              | Zweck                                                                  |
| ------------------- | ---------------------------------------------------------------------- |
| `npm run dev`       | Dev-Server (Vite, Hot Reload) auf http://localhost:5317                |
| `npm run build`     | Typecheck + Produktions-Build nach `dist/`                             |
| `npm run preview`   | Build lokal ansehen (Port 4317)                                        |
| `npm run typecheck` | `tsc -b` (App + Node-Konfiguration)                                    |
| `npm run lint`      | ESLint (typgeprüft, strict)                                            |
| `npm run format`    | Prettier                                                               |
| `npm test`          | Unit-Tests (Vitest, `tests/unit/`)                                     |
| `npm run test:e2e`  | E2E- und Golden-Tests (Playwright, echtes Chrome mit WebGPU, headless) |
| `npm run fixtures`  | synthetische Testbilder neu erzeugen                                   |

Phasen-Abschluss: `npm run lint && npm run typecheck && npm test && npm run build && npm run test:e2e`

## Architektur (Stand Phase 0)

- `src/render/gpu.ts` – `initGpu()`: Adapter/Gerät mit angehobenen Limits, Ergebnis `webgpu | webgl2 | none` mit Grund.
- `src/render/runtime.ts` – Singleton für GPU-Objekte (außerhalb von React/Zustand).
- `src/render/renderer.ts` – `Renderer`: Import (sRGB→linear, vormultipliziert, `rgba16float`), `drawView` (Zoom/Pan,
  Schachbrett, Anti-Aliasing beim Verkleinern), `renderRegion(rect)` (Einstieg für den künftigen Compositor/Kachel-Export),
  `encodeToSrgb8` (linear→sRGB, gerades Alpha, Readback).
- `src/render/shaders/*.wgsl` – `color.wgsl` wird jedem Shader vorangestellt; Formeln identisch zu `src/render/color.ts`.
- `src/state/store.ts` – Zustand-Store (GPU-Status, Bild, Ansicht, Hinweise, Theme); `viewMath.ts` reine Ansichtsmathematik.
- `src/io/` – Import (Hash = `originalId`), PNG-Export, Dateidialog.
- `src/app/` – Layout (TopBar, ToolBar, CanvasView, SidePanel, BottomPanel), Tastenkürzel, Theme + Design-Tokens.

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
- Die Anzeige filtert beim Verkleinern per Mehrfachabtastung (max. 6 × 6), keine Mipmaps; ab Phase 1 gibt es die 2048-px-Vorschau.
- Browser-Kürzel (⌘0, ⌘E, ⌘O) werden per `preventDefault` abgefangen; in Playwright getestet, im echten Chrome manuell zu prüfen.
- Ohne WebGPU zeigt die App nur eine Meldung; es gibt keinen WebGL2-Render-Pfad (siehe DECISIONS.md).
