# Blur & Layer Studio

Blur & Layer Studio ist eine lokale Web-App für Kunstprojekte: Sie zerlegt Bilder automatisch oder per Pinsel in Ebenen
und gibt jeder Ebene eigene Unschärfe, Farbe, Schwarz-Weiß und Schatten – in Echtzeit auf der GPU (WebGPU).
Ästhetisches Ziel sind starke Unschärfe und Überschneidungen, bei denen gezielte Fokuspunkte (Augen, Gesicht, Brust, Hände) schärfer bleiben.

**Verbindliche Spezifikation:** [SPEC-artistic-photo-renderer.md](SPEC-artistic-photo-renderer.md).
Abweichungen nur mit Eintrag in [DECISIONS.md](DECISIONS.md) und Hinweis an den Nutzer.

## Status

Abgeschlossen: **Phase 0 – Gerüst**, **Phase 1 – Ganzes Bild**, **Phase 2 – Vordergrund, Fokus, Schatten**,
**Phase 3 – Tiefenebenen und Gruppen**, **Phase 4 – Weitere Bilder**, **Phase 5 – Pinsel** ([docs/abnahme-P5.md](docs/abnahme-P5.md)). Erledigte Punkte werden in der Spec abgehakt.

**Erweiterung „Effekte & Malvorlagen“** ([docs/spec-effekte-und-malvorlagen.md](docs/spec-effekte-und-malvorlagen.md)):
**Phasen E1 und E2 abgeschlossen** ([docs/plan-E1.md](docs/plan-E1.md), [docs/plan-E2.md](docs/plan-E2.md); Abnahme und
Demo-Listen: [docs/abnahme-E1.md](docs/abnahme-E1.md), [docs/abnahme-E2.md](docs/abnahme-E2.md); Ideen für später:
[docs/optimierungen-und-varianten.md](docs/optimierungen-und-varianten.md)).
Nächste: **E3** (freigegeben 18.10.2026), danach E4, E5. Danach `docs/spec-ml-fotobearbeitung.md` (nicht anfassen).
Nach jedem Schritt: Tests, [PROGRESS.md](PROGRESS.md) nachführen (Stand, offene Punkte, Logbuch, Stolpersteine, Messwerte), Commit, Push.

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
| `npm run test:effects`             | Golden-Tests aller Effekte (`tests/e2e/effectCases.ts`)                |
| `UPDATE_GOLDEN=1 npm run test:e2e` | Golden-Referenzbilder neu schreiben (danach ansehen!)                  |

Phasen-Abschluss: `npm run lint && npm run typecheck && npm test && npm run test:service && npm run build && npm run test:e2e`
(E2E mit Modellen braucht einmalig `npm run models:fetch`, sonst werden diese Tests übersprungen.)

## Architektur (Stand E2)

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

**Phase 3:**

- Tiefe: `ml/depth.ts` (Tiefenkarte berechnen/cachen, Gruppe „Tiefenebenen“ bauen), `ml/depthBands.ts` (Histogramm, Quantile,
  k-Means, Preset-Werte), Dialog `app/components/DepthSplit.tsx` (Histogramm mit Griffen, farbige Bandvorschau).
  Maskenart `depth` → `core.depthBand` (Shader `maskops.wgsl` Einstieg `band`); Lochfüllung bis `fillBelow`.
  Tiefenkarten: `Layer.depthMap`, OPFS `depth/`, Projektdatei `depth/<id>.png`, Ansicht „Tiefe“ (Taste 4).
  Dienst: `POST /depth`. Plugin `effects/haze` (Dunst).
- Gruppen: `state/project.ts` (`setParamInGroup`, `moveNode`, `wrapInGroup`, `ungroup`), Befehle in `state/commands.ts`
  (Gruppenmodus propagiert in `setParamCommand`), `app/components/GroupSections.tsx` (gemeinsame Regler),
  Schloss je Parameter in `EffectCard`, Baum mit Ziehen in `app/components/LayerList.tsx`.
- Parallax: Store `parallax`, `ParallaxPanel.tsx`, Versatz im Blend-Shader (`blend.wgsl` `offset`), Taste P.
- Export: `io/export.ts` (Dialog-Formate PNG/JPEG/WebP/PSD, NC-Warnung), `io/psd.ts` (ag-psd, lazy geladen).

**Phase 4:**

- Transform: `state/transform.ts` (Platzierung Ebenen-px → Leinwand-px, Füllen/Einpassen, rein und getestet).
  Compositor: `geometry()` je Ebene (Auflösung im Ebenenraum, Abbildung, Cache-Schlüssel), `place()` legt Ebenen-Texturen
  auf den Leinwand-Ausschnitt (`core.warp`, Shader `warp.wgsl`; ausgerichtete Ebenen: Ausschnitt kopieren).
  Maske/Lochfüllung/Tiefe im Ebenenraum, Effekte im Leinwandraum. Fokuspunkte in Ebenen-px (`FocusOverlay` rechnet um).
- UI: `TransformSection.tsx` (Inspektor), `TransformOverlay.tsx` (Rahmen auf der Leinwand), Ebenenliste mit „+ Bild“,
  Reihenfolge, Löschen; Import als Ebene `io/import.ts` `importImageAsLayer`, Dialog `io/openDialog.ts` `addImageDialog`.
- Baum: `insertAbove`, `removeNode`, `stepNode` (über genau eine sichtbare Ebene, auch in Gruppen hinein), `moveToEdge`.

**Erweiterung E1 (Effekte):**

- Manifest v2 (`effects/manifest.ts`, `validate.ts`): `implementations` {preview, final} ∈ `webgpu` | `browser-cpu` | `python`,
  `license`, `cost`, `randomized` (Seed-Parameter automatisch), `requires` (Analysekarten), Parameter-`group` („Erweitert“
  eingeklappt), Typen `seed`, `palette` (`array<vec4f,16>` + `<key>_count`), `image` (Zweitbild in `src_b`). WGSL-Schlüsselwörter
  als Parameternamen werden abgelehnt.
- Vorspiel (`effects/prelude.ts`): Zufall `rand_pcg3`/`rand_cell`/`rand_at`/`rand_noise`/`rand_fbm` (bitgleich zu
  `effects/random.ts` und Python), Oklab, Analysekarten `load_luminance`, `edge_strength|tangent|coherence` (Bindungen 9/10),
  kachelgenaue Abtastung `canvas_px`/`sample_src_canvas`.
- Effekt-Mischung: `EffectInstance.blendMode` und `.mask` (`EffectMask`: Kartenbereich Helligkeit/Kanten/Tiefe oder Ebenenmaske);
  Gruppen haben eine eigene `mask` (Projektformat 6). Shader `mix.wgsl` + gemeinsames `blendmodes.wgsl`.
- Analysekarten: `shaders/analysis.wgsl` (Sobel, Strukturtensor σ = 2, Tangente, Kohärenz) im Ebenenraum; Gruppeneffekte
  rechnen sie aus ihrem Eingang. Ansicht „Analysekarte“ (`AnalysisPanel.tsx`). Dienst: `ml_service/analysis.py` (gleiches Verfahren).
- Asynchrone Effekte (`render/asyncEffects.ts`): Compositor fordert fehlende Ergebnisse an und reicht so lange den Eingang durch;
  Web Worker (`effects/cpu.worker.ts`, Plugins mit `effect.worker.ts`) oder Dienst (`ml/serviceEffects.ts` → `PUT /images/{sha}`,
  `POST /effects/{id}/render`, `GET`/`DELETE /jobs/{id}`, Hash-Cache, `ml_service/effects.py` lädt `effect.py`). Export wartet
  über `Engine.renderResolved`; Job-Anzeige mit Abbruch; „Vollauflösung rendern“.
- Presets (`src/presets/`): eigene und Stapel-Presets im OPFS (`presets/presets.json`), Vorschaubilder, Menüs `PresetMenus.tsx`;
  mitgelieferte Presets in `effects/<id>/presets.json`.
- Effekt-Browser (`EffectBrowser.tsx`): Kennzeichen, Live-Vorschau (Ausschnitt 1:1) nur für GPU-Effekte, sonst `preview.png`;
  NC-Effekte im Modus „Kommerziell“ gesperrt (auch `addEffectCommand`, `ncLayers`). `ErrorBoundary` je Bereich.
- Ausschnitt in voller Auflösung (`Engine.updateDetail`/`renderDetail`): ab Zoom > 1,25 × Vorschau nach 150 ms Ruhe, wie Export
  gerendert (pixelgleich), in `view.wgsl` über die Vorschau gelegt.
- PSD (`io/psd.ts`): Gruppen immer als Ebenengruppen (Gruppenmaske aktiv), Gruppeneffekte gerendert; Option „Effekte als eigene
  Ebenen“ (Stärke → Deckkraft, Mischmodus, Effektmaske als Ebenenmaske).
- Test-Effekte in `tests/effects/` (nur Dev mit `localStorage['bls.testEffects']='1'`), Test-Dienst auf Port 8766
  (`TEST_SERVICE_URL`), Golden-Helfer `tests/e2e/effectGolden.ts` + Fälle `effectCases.ts`, Abnahme `acceptanceE1.spec.ts`.

**Erweiterung E2 (Effektbreite & Malplan):**

- Analysekarte `flow` (Richtungsfeld): `core.flowMap` (Shader `analysis.wgsl` Einstieg `flow`, J(σ=6) + ¼·J(σ=24)),
  `cpuAnalysis.flow`, Dienst `analysis.flow`; Konstanten `src/effects/maps.ts`; Bindung 11 (`flow_tangent`, …).
- Kern: Parametertyp `text` (Uniform = Zeichenzahl), Glyphen-Atlas `ctx.glyphs` (`render/glyphs.ts`); Reichweite ≥ halbe
  Leinwand → Export am Stück (globale Effekte), Ausschnitt in voller Auflösung entfällt dann.
- 19 Effekte unter `effects/` (alle GPU, `stipple` im Worker).
- Malplan (`src/malplan/`): `model.ts` (Einstellungen `project.malplan`, Projektformat 7, Formate, Zuschnitt, Raster),
  `analysis.ts` (Glättung, k-Means in Oklab, Flächen verschmelzen, Tonwerte, Notan, Wärme, Konturen als Vektoren),
  `worker.ts` + `store.ts` (Ablauf rendern → analysieren → ableiten; `Engine.renderRegionImage`), `render.ts` (Hilfen als
  Canvas), `tiles.ts` (Kachelung), `pdfBook.ts` (Malmappe), `homography.ts` + `beamerChannel.ts` (Beamer).
  Oberfläche `app/components/MalplanWorkspace.tsx`, `MalplanBeamer.tsx`, `MalplanPdf.tsx`; Store `workspace`, `malplanHelp`.
- Beamer-Fenster: eigene Seite `beamer.html` / `src/beamer.tsx` (BroadcastChannel, Trapezkorrektur per CSS matrix3d).
- PDF: eigener Schreiber `src/io/pdf.ts` (PDF 1.4, Helvetica/WinAnsi, Bilder, Vektorpfade).

**Phase 5 (Pinsel):**

- Striche als Vektordaten (`BrushStroke` in `state/project.ts`, Projektformat 8) auf `maskStrokes`, `selection`
  (Markierung, `PaintedMask` = Grundmaske + Striche + Klicks) und `focusMap.strokes`; Maskenart `empty`; `holeMask`
  (Lochfüllung aus Markierung), `initial` (Ausgangszustand für „Zurücksetzen“).
- Rasterung: `brush/dabs.ts` (Tupfer, gleicher Abstand, Druck) → `core.paintDabs` (Render-Pipeline `paint.wgsl`,
  Mischung „über“); Compositor `baseMask`/`withStrokes`/`selectionMask`/`focusTexture` im Ebenenraum gecacht.
- Werkzeuge: `BrushOverlay.tsx` + `BrushPanel.tsx` (B), `SmartSelectOverlay.tsx` (W), Aktionen `SelectionActions.tsx`;
  Befehle `paintStrokeCommand` (ein Eintrag je Zug), `highlightSelectionCommand`, `extractSelectionCommand`,
  `resetLayerCommand`; Anzeige: Überlagerung 7 = Farbschleier.
- SAM: `ml/smartSelect.ts` → ML-Worker (`sam`-Anfrage, Bildmerkmale je Original gecacht) → `refineMask` → gespeicherte Maske.

**Neuen Effekt anlegen:** siehe [effects/README.md](effects/README.md) – nur einen Ordner unter `effects/` anlegen.

## Referenz-Hardware

Apple M4 Pro (14 CPU-/20 GPU-Kerne), 48 GB RAM, macOS 26.6, Chrome 155. Die Performance-Ziele der Spec gelten auf diesem Rechner.

## Regel: Abschluss jeder Phase

Eine Phase ist erst fertig, wenn

1. Tests (`npm test`, `npm run test:e2e`), Lint (`npm run lint`), Typecheck und Build (`npm run build`) grün sind,
2. jedes Abnahmekriterium einzeln geprüft und das Ergebnis dokumentiert ist,
3. die Punkte in der Spec abgehakt und diese Datei sowie `PROGRESS.md` aktualisiert sind,
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
- Die Anzeige zeigt die Vorschau (≤ 2048 px); beim Hineinzoomen folgt nach 150 ms Ruhe der sichtbare Ausschnitt in voller Auflösung (nicht bei Worker-/Dienst-Effekten und Parallax).
- Ist der Dienst aus, meldet die Browser-Konsole alle 20 s einen fehlgeschlagenen `/health`-Aufruf (ML-Modus „Browser“ vermeidet das).
- Tiefenebenen „objekttreu“ (SAM-Objekte) fehlt noch (folgt mit der Segmentierung in E3). Die Tiefe einer Ebene ist für
  Parallax die Bandmitte.
- Smarte Auswahl: ein Klick erfasst oft das ganze Objekt; mit Alt-Klicks und dem Pinsel eingrenzen. Kein „Markierung umkehren“.
- PSD: 8 Bit sRGB; Ebenen enthalten ihre Effekte (nicht nachträglich änderbar), Masken nur als deaktivierte Ebenenmasken;
  Gruppen mit eigenen Effekten werden zu einer Ebene. An weichen Bandkanten mischen PSD-Programme minimal anders (8-Bit-sRGB).
- Transform: Gruppen lassen sich nur verschieben (nicht skalieren/drehen). Maskenkanten gelten in Ebenen-px, Effekte in
  Leinwand-px. Die Leinwandgröße ist die des ersten Bildes und lässt sich nicht ändern.
- Kürzel ⌘] / ⌘[ werden nach dem Zeichen erkannt: auf deutscher Mac-Tastatur ⌘⌥6 / ⌘⌥5 (oder die Pfeil-Knöpfe der Ebenenliste).
- Browser-Kürzel (⌘0, ⌘E, ⌘O, ⌘S) werden per `preventDefault` abgefangen; in Playwright getestet, im echten Chrome manuell zu prüfen.
- Malplan: Werte- und Farbhilfen sind Rasterbilder (lange Kante 1600 px), nur die Konturvorlage ist Vektor. Die Maltechnik
  wirkt erst mit dem Schichtplan (E4). Beamer-Ecken beziehen sich auf das Beamer-Fenster.
- Lange Testläufe brauchen einen wachen Rechner: im Akkubetrieb mit geschlossenem Deckel schläft der Mac (Stolperstein S23).
