# Entscheidungen

Abweichungen von der Spec und Festlegungen bei unklaren Anforderungen. Neueste oben.

<!-- Vorlage
## JJJJ-MM-TT – Kurztitel
- **Frage:**
- **Entscheidung:**
- **Begründung:**
- **Betrifft:** (Spec-Abschnitt / Phase)
-->

## 2026-10-14 – Dev-Port 5317

- **Frage:** Vite-Standardport 5173?
- **Entscheidung:** Dev-Server auf 5317, Preview auf 4317 (`strictPort`).
- **Begründung:** Auf dem Entwicklungsrechner belegt ein anderes Projekt 5173; Playwright hätte sonst die falsche App testen können. Die CORS-Origin des Python-Dienstes (Phase 2) ist entsprechend `http://localhost:5317`.
- **Betrifft:** Lokaler Python-Dienst (CORS), Tests

## 2026-10-14 – Zoom/Pan-Bedienung

- **Frage:** Die Spec nennt nur „Zoom/Pan“.
- **Entscheidung:** Trackpad-Pinch bzw. ⌘/Strg + Mausrad zoomt um den Cursor; Scrollen ohne Taste verschiebt; Leertaste + Ziehen oder mittlere Maustaste verschiebt; ⌘0 einpassen, ⌘1 100 %, ⌘+/⌘− zoomen. Ab 200 % Zoom Pixel scharf (nearest).
- **Begründung:** Übliche Konvention in Grafik-Apps (Figma, Photoshop mit Trackpad) und natürlich auf dem MacBook-Trackpad.
- **Betrifft:** UI, Phase 0

## 2026-10-14 – TypeScript 6.0 statt 7.0

- **Frage:** Welche TypeScript-Version?
- **Entscheidung:** TypeScript 6.0.3.
- **Begründung:** TS 7.0.2 ist „latest“, aber typescript-eslint 8.71 unterstützt nur TS < 6.1. Upgrade, sobald typescript-eslint TS 7 unterstützt.
- **Betrifft:** Technologie-Stack, alle Phasen

## 2026-10-14 – Kein WebGL2-Render-Pfad in Phase 0

- **Frage:** Phase 0 verlangt „WebGPU-Initialisierung mit verständlicher Meldung bzw. WebGL2-Fallback“. Wie weit geht der Fallback?
- **Entscheidung:** Phase 0 erkennt WebGPU/WebGL2 und zeigt eine verständliche Meldung; ohne WebGPU wird nicht gerendert. Die minimalen WebGL2-Effekte der Spec werden nur nachgezogen, wenn der Nutzer sie braucht.
- **Begründung:** Zielbrowser ist Chrome auf macOS mit stabilem WebGPU; jeder WebGL2-Pfad verdoppelt die Shader-Arbeit. Vom Nutzer bestätigt.
- **Betrifft:** Render-Pipeline (WebGL2-Fallback), Phase 0

## 2026-10-14 – Plugins werden zur Build-Zeit gefunden

- **Frage:** Wie lädt die App Effekt-Ordner „ohne Codeänderung“?
- **Entscheidung:** Per `import.meta.glob` über `effects/*/`. Im Dev-Server erscheinen neue Ordner sofort (Hot Reload); ein Produktions-Build muss neu gebaut werden. Kein Laden aus frei gewählten Ordnern zur Laufzeit.
- **Begründung:** Einfach, typsicher, Shader-Hot-Reload inklusive; für eine lokale App ausreichend. Vom Nutzer bestätigt.
- **Betrifft:** Effekt-Plugin-System, Phase 1

## 2026-10-14 – Schatten ist ein generierter Layer, gerendert von einem Plugin

- **Frage:** Die Spec nennt den Schatten als mitgelieferten Effekt (Plugin), das Datenmodell aber als `shadow?: ShadowConfig`, das einen eigenen Layer erzeugt.
- **Entscheidung:** Der Schatten ist ein automatisch erzeugter, verknüpfter Layer direkt unter seinem Layer; sein Bild erzeugt das Plugin `effects/shadow` aus der Maske des Quell-Layers. `ShadowConfig` sind die Parameter dieses Plugins. Der Schatten-Layer hat einen eigenen Effekt-Stack.
- **Begründung:** Erfüllt beide Stellen der Spec und hält „Effekte nur als Plugins“ ein. Vom Nutzer bestätigt.
- **Betrifft:** Datenmodell, Effekte/Schatten, Phase 2

## 2026-10-14 – Kantenübergang ist eine Kern-Stufe

- **Frage:** Ist der Kantenübergang (Kantenhärte, Kantenversatz, Verlaufskurve) ein Effekt-Plugin?
- **Entscheidung:** Nein. Er ist eine feste Masken-Stufe im Kern vor dem Effekt-Stack, mit Feldern `maskEdge` am Layer.
- **Begründung:** Die Pipeline der Spec zeigt ihn als Masken-Stufe; er wirkt auf die Maske, nicht auf die Farbe. Vom Nutzer bestätigt.
- **Betrifft:** Datenmodell, Render-Pipeline, Phase 2

## 2026-10-14 – Git-Workflow

- **Entscheidung:** Alles auf `main`; Commit am Ende jeder Phase (bei großen Phasen auch Zwischen-Commits). Push nur auf Anweisung.
- **Begründung:** Vom Nutzer festgelegt.

## 2026-10-14 – Testbilder

- **Entscheidung:** Phase 0/1 nutzen synthetisch erzeugte Testbilder. Für echte Fotos (Portrait, Landschaft, Objekt auf Tisch) werden freie Bilder (CC0/Public Domain) gesucht, die Lizenz an der Quelle geprüft und in `tests/fixtures/LICENSES.md` dokumentiert.
- **Begründung:** Keine Lizenzrisiken in Golden-Tests. Vom Nutzer festgelegt.

## 2026-10-14 – HEIC nicht unterstützt, Import nach sRGB

- **Frage:** Spec: „HEIC falls der Browser es dekodiert“.
- **Entscheidung:** Chrome dekodiert kein HEIC → v1 unterstützt HEIC nicht; der Import zeigt einen Hinweis. Bilder mit breitem Farbraum (Display P3) werden beim Dekodieren nach sRGB konvertiert.
- **Begründung:** libheif-WASM ist LGPL und groß; der Export ist laut Spec sRGB.
- **Betrifft:** Externe Bild-Layer, Import
