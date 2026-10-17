# Spec: Effekt-System & Malvorlagen
## artistic-photo-renderer – Blur & Layer Studio (Erweiterung)

Version 1.0 · Stand: 16.10.2026
Status: Erweiterung des bestehenden Programms. Ergänzt die vorhandene Spec, ersetzt sie nicht.

---

## 0. Hinweise für die Umsetzung (bitte zuerst lesen)

- Diese Spec beschreibt **eine Erweiterung eines bestehenden Programms**. Vor jeder Implementierung muss die vorhandene Codebasis analysiert werden: Projektstruktur, Frontend-Framework, Rendering-Pipeline, Ebenen- und Maskenmodell, Python-Dienst, Export (PSD), Parallax-Vorschau, Modell-Umschalter (kommerziell / nicht-kommerziell).
- Wo diese Spec mit dem Bestand kollidiert, gilt: **Der Bestand bleibt funktionsfähig.** Abweichungen werden vor der Umsetzung benannt und mit mir abgestimmt.
- Namen, Dateipfade und Schnittstellen in dieser Spec sind **Vorschläge**. Sie sollen an die vorhandenen Konventionen angepasst werden.
- Um Verwechslungen mit den Phasen der ursprünglichen Spec zu vermeiden, heißen die Phasen hier **E1 bis E5**.
- Jede Phase endet mit einem lauffähigen, getesteten Stand. Keine Phase wird begonnen, bevor die vorherige abgenommen ist.
- Entscheidungen aus Abschnitt 13 („Offene Entscheidungen“) werden **nicht** eigenmächtig getroffen, sondern vorgelegt.

---

## 1. Ziel

Das Programm erhält ein **erweiterbares Effekt-System** mit einer breiten Palette künstlerischer Effekte – von einfachen Shader-Effekten bis zu physikalischen Simulationen – und ein **Malvorlagen-Modul**, das aus jedem Ergebnis eine praktische Vorlage zum Nachmalen auf Leinwand oder Papier erzeugt.

Das Alleinstellungsmerkmal ist die Kette: **Foto → künstlerischer Entwurf → Malplan → eigenes Gemälde.**

### Rahmenbedingungen (aus der bestehenden Spec)
- Web-App, Zielbrowser Chrome
- Bildgrößen bis 24 Megapixel
- Python-Dienst für rechenintensive Verarbeitung und ML-Modelle
- Ebenen, Masken, Vorder-/Hintergrund, starke Unschärfe als Kern
- PSD-Export, Parallax-Vorschau
- Umschalter für kommerziell / nicht-kommerziell nutzbare Modelle
- Ergebnisse werden verkauft und ausgestellt → Lizenzen müssen sauber sein

---

## 2. Architekturprinzipien

### 2.1 Effekte als Plugins
Jeder Effekt ist ein eigenständiges Modul mit einheitlicher Schnittstelle (siehe Abschnitt 3). Neue Effekte werden hinzugefügt, ohne den Kern zu ändern. Effekte registrieren sich in einer zentralen **Effekt-Registry**, aus der die Oberfläche (Effekt-Browser, Parameter-Panels) automatisch erzeugt wird.

### 2.2 Effekte wirken auf Ebenen
- Ein Effekt wird als **Effekt-Ebene** oder als **Filter auf einer bestehenden Ebene** angewendet (je nachdem, was zum vorhandenen Ebenenmodell passt; bevorzugt nicht-destruktiv).
- Jeder Effekt hat: **Maske**, **Deckkraft**, **Blend-Mode**, **Sichtbarkeit**.
- Effekte sind **stapelbar** und in der Reihenfolge änderbar.
- Ziel: Kombinationen wie „Halbton nur im Hintergrund, Tusche-Linien im Vordergrund, Ölmalerei auf der Person“.

### 2.2a Gruppen (Ergänzung vom 17.10.2026, gilt ab Phase E1)
- Ebenen lassen sich zu **Gruppen** zusammenfassen, auch **verschachtelt**.
- **Effekte, Masken, Deckkraft und Blend-Modes** sind auch auf Gruppen anwendbar: Die Gruppe wird **zuerst zusammengeführt**, dann wirken ihre Effekte auf das Ergebnis, danach Maske, Deckkraft und Blend-Mode der Gruppe.
- Effekte auf Gruppen haben wie alle Effekte eine eigene Maske (auch aus Analysekarten des zusammengeführten Ergebnisses) und einen eigenen Blend-Mode.
- Im **PSD-Export** werden Gruppen als **Ebenengruppen** ausgegeben (siehe Abschnitt 9).
- Hinweis zum Bestand: Gruppen, Verschachtelung, Gruppeneffekte, Deckkraft und Blend-Mode von Gruppen existieren bereits (ursprüngliche Spec, Phase 3). Ergänzt werden die Maske der Gruppe, Kartenmasken für Effekte auf Gruppen und die PSD-Ausgabe von Gruppen mit Effekten als Ebenengruppe.

### 2.3 Zwei Ausführungsorte
| Ort | Wofür | Beispiele |
|---|---|---|
| **Browser (WebGL2 / WebGPU, falls verfügbar)** | Echtzeit-fähige Effekte, Live-Vorschau | Glitch, Dithering, Halbton, Bloom, RGB-Split |
| **Python-Dienst** | Rechenintensive Verfahren, ML-Modelle, Simulationen | Stippling, Aquarell-Simulation, Depth-Map, Style-Transfer, Strich-Rendering |

Manche Effekte haben **beide Implementierungen**: eine schnelle Näherung im Browser für die Vorschau und eine exakte Version im Dienst für den Endrender. Die Effekt-Definition gibt an, welche vorhanden sind.

### 2.4 Vorschau klein, Endrender groß
- Interaktive Vorschau auf einer **verkleinerten Arbeitskopie** (Standard: lange Kante 1600 px, konfigurierbar).
- Der **Endrender** in voller Auflösung (bis 24 MP) läuft beim Export oder auf Anforderung („Vollauflösung rendern“) – für Python-Effekte asynchron mit Fortschrittsanzeige und Abbruchmöglichkeit.
- Parameter, die von der Auflösung abhängen (Radien, Strichbreiten, Rastergrößen), werden **relativ zur Bildgröße** gespeichert, damit Vorschau und Endrender gleich aussehen.

### 2.5 Reproduzierbarkeit
- Jeder Effekt mit Zufallsanteil erhält einen **Seed**-Parameter. Gleicher Seed + gleiche Parameter = gleiches Ergebnis (wichtig für Verkauf, Editionen und Nachmalen).
- Der gesamte Effekt-Stapel ist als **Projektdatei (JSON)** speicherbar und wieder ladbar.

### 2.6 Presets
- Jeder Effekt kann Parametersätze als **Presets** speichern (benannt, mit Vorschaubild).
- **Stapel-Presets** speichern eine ganze Effekt-Kombination.
- Mitgelieferte Presets pro Effekt (mindestens 2–3) als Ausgangspunkt.

### 2.7 Geteilte Analysekarten
Viele Effekte brauchen dieselben Zwischenergebnisse (Tiefe, Kanten, Segmentierung …). Diese werden als **Analysekarten** einmal pro Bild berechnet, gecacht und allen Effekten zur Verfügung gestellt (siehe Abschnitt 4).

---

## 3. Effekt-Schnittstelle

### 3.1 Effekt-Definition (Vorschlag, TypeScript-artig)

```ts
interface EffectDefinition {
  id: string;                    // z. B. "halftone-cmyk"
  name: string;                  // Anzeigename, deutsch
  category: EffectCategory;      // siehe Abschnitt 5
  description: string;           // ein Satz für den Effekt-Browser
  version: string;               // für Migration gespeicherter Projekte

  params: ParamSpec[];           // automatisch erzeugtes UI
  requires: AnalysisMapId[];     // z. B. ["depth", "edges"]

  implementations: {
    preview?: "webgl" | "webgpu" | "python";
    final:   "webgl" | "webgpu" | "python";
  };

  license: {
    commercialUse: boolean;      // für den kommerziell/nicht-kommerziell-Umschalter
    notes?: string;              // Herkunft von Modellen, Texturen, Algorithmen
  };

  cost: "realtime" | "interactive" | "slow" | "very-slow";  // für UI-Hinweise
  randomized: boolean;           // wenn true → Seed-Parameter automatisch
}

interface ParamSpec {
  id: string;
  label: string;
  type: "float" | "int" | "bool" | "enum" | "color" | "palette" | "angle" | "point" | "image" | "seed";
  default: unknown;
  min?: number; max?: number; step?: number;
  options?: { value: string; label: string }[];
  relativeToImageSize?: boolean; // siehe 2.4
  group?: string;                // UI-Gruppierung, z. B. "Erweitert"
}
```

### 3.2 Ausführung
- **Browser-Effekte:** Eingabe-Textur(en), Parameter, Analysekarten → Ausgabe-Textur. Kein Zugriff auf globale Zustände.
- **Python-Effekte:** gleiche Semantik über die API des Dienstes. Vorschlag:
  - `POST /effects/{id}/render` → Job-ID
  - `GET /jobs/{id}` → Status, Fortschritt (0–1), Ergebnis-URL
  - `DELETE /jobs/{id}` → Abbruch
  - Ergebnisse werden anhand eines Hashes aus (Bild, Effekt-ID, Version, Parameter, Seed) gecacht.
- Auf der Python-Seite gibt es ein spiegelbildliches Registry-System, damit ein neuer Effekt nur an einer Stelle pro Seite registriert werden muss.

### 3.3 Effekt-Browser (UI)
- Kategorien-Navigation, Suche, Vorschaukacheln (auf einem kleinen Ausschnitt des aktuellen Bildes)
- Kennzeichnung: Kosten (Echtzeit / langsam), Lizenz (kommerziell ja/nein), benötigte Analysekarten
- Effekte, die im aktuellen Lizenzmodus nicht erlaubt sind, werden ausgegraut mit Hinweis

---

## 4. Analysekarten

Berechnet im Python-Dienst, einmal pro Bild (bzw. pro Bildänderung), gecacht, als Graustufen- oder Mehrkanalbilder abrufbar und **in der UI als Overlay ansehbar**. Jede Karte ist auch als Maskenquelle nutzbar (z. B. „Maske aus Tiefe 0–30 %“).

| ID | Inhalt | Verfahren (Vorschlag) | Phase |
|---|---|---|---|
| `luminance` | Helligkeit | trivial | E1 |
| `edges` | Kantenstärke und -richtung | Sobel / Canny, Structure Tensor | E1 |
| `flow` | Richtungsfeld für Striche/Linien | Edge Tangent Flow (Structure Tensor, geglättet) | E2 |
| `depth` | Tiefenkarte | monokulares Tiefenmodell (z. B. Depth Anything V2) | E3 |
| `normals` | Oberflächennormalen | aus `depth` abgeleitet | E3 |
| `segmentation` | Objekt-/Bereichsmasken | Segmentierungsmodell (z. B. SAM / SAM 2), auch per Klick | E3 |
| `saliency` | Wohin schaut das Auge? | Saliency-Modell (z. B. U²-Net) | E3 |
| `faces` | Gesichtsbereiche | Gesichtserkennung | E3 |

**Lizenzpflicht:** Für jedes Modell müssen die Lizenz von Code **und Gewichten** geprüft und im Effekt-/Kartenmodell hinterlegt werden. Beispiel: Bei Depth Anything V2 haben die Modellgrößen unterschiedliche Lizenzen (kleines Modell kommerziell nutzbar, größere nur nicht-kommerziell). Der bestehende Umschalter muss das berücksichtigen und je Modus das passende Modell wählen.

---

## 5. Effektkatalog

Legende Ausführung: **B** = Browser, **P** = Python-Dienst, **B/P** = Vorschau im Browser, Endrender im Dienst.
Phase gibt an, wann der Effekt umgesetzt wird (siehe Abschnitt 10).

Für jeden Effekt gilt als Mindest-Akzeptanzkriterium: funktioniert mit Maske, Deckkraft, Blend-Mode; Vorschau und Endrender sehen gleich aus (Toleranz bei Näherungen); hat mindestens 2 Presets; Parameter haben sinnvolle Standardwerte, die auf Anhieb ein ansprechendes Ergebnis liefern.

### 5.1 Digital & Glitch

| ID | Effekt | Kernparameter | Ausf. | Phase |
|---|---|---|---|---|
| `pixel-sort` | Pixel Sorting nach Helligkeit/Farbton/Sättigung | Richtung, Schwellwerte unten/oben, Sortierkriterium, Maske als Bereichsbegrenzung | B | E1 |
| `rgb-split` | Chromatische Aberration | Versatz, Modus linear/radial, Winkel | B | E1 |
| `dither` | Dithering | Verfahren (Floyd-Steinberg, Atkinson, Bayer 2/4/8, Blue Noise), Palette, Farbanzahl, Pixelgröße | B | E1 |
| `pixelate` | Pixelation / Mosaik | Blockgröße, Form (Quadrat, Hexagon), Farbmodus (Mittelwert, Median) | B | E1 |
| `scanlines-crt` | Scanlines, CRT, VHS | Linienabstand, Wölbung, Rauschen, Tracking-Fehler, Farbbluten | B | E2 |
| `datamosh` | JPEG-/Block-Korruption | Blockgröße, Stärke, Anteil betroffener Blöcke, Seed | B/P | E2 |
| `displace` | Slit-Scan / Displacement | Quelle (Analysekarte oder Bild), Stärke, Richtung, Streifenbreite | B | E2 |
| `ascii` | ASCII-/Text-Art | Zeichensatz oder eigener Text, Zellgröße, Farbe ja/nein, Schrift | B | E2 |

### 5.2 Zeichnung & Grafik

| ID | Effekt | Kernparameter | Ausf. | Phase |
|---|---|---|---|---|
| `ink-lines` | Tusche-/Linienzeichnung (XDoG / Flow-based DoG) | Linienstärke, Schwellwert, Ausfransung, Linienfarbe, Papierfarbe | B | E1 |
| `comic` | Comic / Cel-Shading mit Ben-Day-Punkten | Tonwertstufen, Konturstärke, Rasterpunktgröße | B | E1 |
| `hatching` | Schraffur & Kreuzschraffur | Anzahl Lagen, Winkel, Abstand, Strichstärke, Richtung entlang `flow` ja/nein | B/P | E2 |
| `stipple` | Stippling (Weighted Voronoi Stippling, Secord 2002) | Punktanzahl, Punktgröße min/max, Iterationen, Seed | P | E2 |
| `charcoal` | Kohle / Rötel | Körnung, Verwischung, Papiertextur, Farbe (Kohle, Rötel, Sepia) | B/P | E2 |
| `linocut` | Linol-/Holzschnitt | Schwellwert, Schnittspuren-Dichte, Schnittrichtung (entlang `flow`), Druckfarbe | P | E3 |
| `blueprint` | Blaupause / technische Zeichnung | Linienstärke, Rasterhintergrund ja/nein | B | E2 |

### 5.3 Malerei

| ID | Effekt | Kernparameter | Ausf. | Phase |
|---|---|---|---|---|
| `kuwahara` | Anisotroper Kuwahara-Filter (Kyprianidis 2009) als Ölbild-Basis | Radius, Schärfe, Anisotropie | B | E1 |
| `pointillism` | Pointillismus | Punktgröße, Dichte, Farbvariation, Palette | B/P | E2 |
| `gouache-flat` | Gouache / flache Malerei | Segmentanzahl, Randunregelmäßigkeit | P | E3 |
| `stroke-paint` | **Strich-basiertes Rendering** (Hertzmann 1998, erweitert) | Pinselgrößen (Liste), Strichlänge, Krümmung, Richtung aus `flow`, Detail-Schwellwert, Seed | P | E4 |
| `impasto` | Impasto / Relief-Beleuchtung (auf `stroke-paint` oder `kuwahara`) | Schichtdicke, Lichtwinkel, Glanz | B | E4 |
| `watercolor-sim` | **Aquarell als Fluidsimulation** (Curtis et al. 1997) | Wassermenge, Pigmentauswahl, Papiertyp, Granulation, Backruns, Trocknungsschritte, Seed | P | E5 |

`stroke-paint` ist ein Schlüsseleffekt: Jeder Strich wird als **Datenobjekt** gespeichert (Position, Pfad, Breite, Farbe, Reihenfolge, Ebene). Diese Daten werden vom Malvorlagen-Modul weiterverwendet (Abschnitt 7.6).

### 5.4 Druck & analoge Fotografie

| ID | Effekt | Kernparameter | Ausf. | Phase |
|---|---|---|---|---|
| `halftone-cmyk` | Halbton / Siebdruck | Rasterweite, Winkel je Kanal, Punktform, Passerversatz | B | E1 |
| `riso` | Risografie | 2–3 Sonderfarben (Riso-Farbpalette), Körnung, Versatz, Farbtrennung | B | E2 |
| `film-grain` | Filmkorn, Light Leaks, Halation | Korngröße, Stärke, Leak-Position/-Farbe, Halation-Radius | B | E1 |
| `alt-process` | Cyanotypie, Sepia, Kollodium | Verfahren, Randartefakte, Vignette, Seed | B | E2 |
| `infrared` | Infrarot-Falschfarben | Verfahren (Aerochrome-artig, s/w-IR), Stärke | B | E2 |
| `instant-film` | Polaroid/Sofortbild-Look | Farbverschiebung, Ausbleichen, Rahmen ja/nein | B | E2 |

### 5.5 Material & Oberfläche

Texturen werden **prozedural erzeugt** (keine fremden Textur-Dateien → keine Lizenzprobleme), optional ergänzt um eigene, vom Nutzer hochgeladene Texturen.

| ID | Effekt | Kernparameter | Ausf. | Phase |
|---|---|---|---|---|
| `paper` | Papier-Looks (zerknittert, gefaltet, Kraftpapier, Büttenrand, Wasserflecken) | Papiertyp, Knitterstärke, Faltlinien, Fleckenanzahl, Seed | B | E2 |
| `cut-paper` | Papierschnitt mit Schlagschatten, nutzt das Ebenensystem | Anzahl Lagen, Schattenwinkel/-länge, Kantenrauheit | B/P | E3 |
| `mosaic-glass` | Mosaik / Buntglas (Voronoi mit Fugen) | Zellgröße, Fugenbreite/-farbe, Glasstruktur | B/P | E2 |
| `textile` | Stickerei / Kreuzstich | Stichgröße, Garnfarben-Anzahl, Stoffstruktur | P | E3 |
| `emboss-foil` | Prägung / Metallfolie | Höhe, Lichtwinkel, Metalltyp | B | E2 |

### 5.6 Geometrisch & Abstrakt

| ID | Effekt | Kernparameter | Ausf. | Phase |
|---|---|---|---|---|
| `low-poly` | Low-Poly (Delaunay auf Kantenpunkten) | Punktanzahl, Kantengewichtung, Flächenfarbe (Mittel/Zentrum), Seed | B/P | E1 |
| `kaleido` | Kaleidoskop, Spiegelung, Droste | Segmente, Zentrum, Rotation, Modus | B | E2 |
| `polar` | Polarkoordinaten / Tiny Planet | Richtung, Zentrum | B | E2 |
| `flow-lines` | Generative Linien entlang `flow` | Linienanzahl, Länge, Dichte nach Helligkeit, Seed | P | E3 |
| `tsp-art` | Einzeilen-Zeichnung (TSP-Art) | Punktanzahl, Linienstärke | P | E3 |
| `posterize-palette` | Posterisierung mit kuratierter / extrahierter Palette | Farbanzahl, Palettenquelle (Referenzbild, gespeicherte Palette) | B | E1 |

### 5.7 Licht & Atmosphäre

| ID | Effekt | Kernparameter | Ausf. | Phase |
|---|---|---|---|---|
| `bloom` | Bloom / Glow | Schwellwert, Radius, Intensität | B | E1 |
| `god-rays` | Lichtstrahlen | Lichtquelle (Punkt), Länge, Dichte, Maske als Verdeckung | B | E2 |
| `tilt-shift` | Tilt-Shift / Miniatur (nutzt vorhandene Unschärfe-Engine) | Schärfeband Position/Breite/Winkel, Sättigungsanhebung | B | E1 |
| `double-exposure` | Doppelbelichtung | Zweitbild, Mischung über Luminanz oder Maske | B | E1 |
| `depth-fog` | Nebel / Dunst nach Tiefe | Dichte, Farbe, Startdistanz | B | E3 |
| `depth-bokeh` | Physikalisch plausibles Bokeh nach Tiefe | Fokusebene, Blende, Bokeh-Form | B/P | E3 |
| `relight` | **Relighting**: Lichtquelle nachträglich verschieben | Lichtrichtung (interaktiv ziehen), Intensität, Farbe, Umgebungslicht | B | E3 |

### 5.8 Style-Transfer & semantische Stilmischung

| ID | Effekt | Kernparameter | Ausf. | Phase |
|---|---|---|---|---|
| `style-transfer` | Neural Style Transfer (z. B. AdaIN-basiert, schnell; optional optimierungsbasiert, langsam) | Stilbild, Stärke, Farberhalt ja/nein, Detailgrad | P | E3 |
| `style-per-region` | Unterschiedlicher Effekt/Stil pro Segment oder Tiefenbereich | Zuordnung Region → Effekt-Stapel | B/P | E3 |

**Lizenzregeln für Style-Transfer:**
- Modellgewichte auf Lizenz prüfen und im Umschalter berücksichtigen.
- Stilbilder sind Nutzerinhalt. Die UI zeigt beim Laden eines Stilbildes einen kurzen Hinweis, dass für verkaufte Werke nur eigene oder lizenzfreie Stilvorlagen (z. B. gemeinfreie Werke) verwendet werden sollten.
- Mitgelieferte Beispiel-Stile ausschließlich aus eigenen oder gemeinfreien Quellen.

### 5.9 Experimentelle Effekte (Alleinstellungsmerkmale)

| ID | Effekt | Beschreibung | Kernparameter | Ausf. | Phase |
|---|---|---|---|---|---|
| `aging` | Alterung über Jahrhunderte | Craquelé (Muster abhängig von simulierter Schichtdicke), vergilbender Firnis, Ausbleichen lichtempfindlicher Farben | Jahre (0–500), Klima (trocken/feucht), Firnis ja/nein, Seed | P | E5 |
| `chemical` | Chemische Prozesse | Rost/Oxidation, Bleiche, Solarisation (Sabattier) – wachsen entlang Kanten oder Tiefe | Prozess, Fortschritt, Startbereiche (Maske), Seed | P | E5 |
| `reaction-diffusion` | Reaktions-Diffusion (Gray-Scott) | Muster wachsen aus dem Bild, gesteuert durch Helligkeit/Kanten | Feed/Kill-Raten (mit Presets: Korallen, Flecken, Labyrinth), Iterationen, Steuerkarte | B/P | E5 |
| `crystal-growth` | Kristall-/Eisblumenwachstum (DLA o. Ä.) | Strukturen wachsen von Kanten aus | Keimpunkte, Wachstumsrate, Verzweigung, Seed | P | E5 |
| `erosion` | Erosion | Bild als Höhenfeld, simulierter Regen trägt ab, Farbe wird mitgetragen | Regenmenge, Iterationen, Härte, Höhenquelle (Luminanz/Tiefe), Seed | P | E5 |
| `saliency-abstraction` | Aufmerksamkeitsgesteuerte Abstraktion | Detail bleibt, wo das Auge hinschaut; der Rest wird zunehmend abstrahiert (z. B. via Kuwahara-Radius oder Strichgröße) | Abstraktionsstärke, Übergangsweichheit, Fokus manuell überschreibbar | B/P | E4 |
| `memory` | Erinnerungs-Effekt | Bild zerfällt wie eine Erinnerung: Unwichtiges verblasst/verschwimmt, Gesichter und Salientes bleiben | Vergessensgrad, Art des Zerfalls (verblassen, verschwimmen, auflösen), Seed | P | E5 |
| `cubist` | Kubistische Mehrperspektive | Neuprojektion über `depth` aus mehreren versetzten Blickwinkeln, Fragmente zusammengesetzt (Hockney-Joiner-artig) | Anzahl Perspektiven, Versatzstärke, Fragmentform, Lückenfüllung (Inpainting, Farbfläche, offen lassen), Seed | P | E5 |

---

## 6. Pigment-Engine (Grundlage für Malerei und Malvorlagen)

### 6.1 Zweck
Realistische Farbmischung, wie sie mit echten Farben passiert (subtraktiv), statt RGB-Mischung. Blau + Gelb soll ein sattes Grün ergeben.

### 6.2 Umsetzung
- Implementierung nach **Kubelka-Munk** (K/S-Modell) mit spektraler Darstellung (mindestens 31 Stützstellen, 400–700 nm) oder einer gut begründeten Näherung.
- **Eigene Implementierung.** Die bekannte Bibliothek Mixbox nicht ohne Klärung einbinden: Sie ist für kommerzielle Nutzung lizenzpflichtig.
- Pigmentdatenbank (JSON) mit gängigen Künstlerpigmenten: Name, Colour-Index-Bezeichnung (z. B. PB29 für Ultramarin), K- und S-Werte bzw. Näherung, Deckkraft, Lichtechtheit, Granulation (für Aquarell).
- Startumfang: ca. 20–30 übliche Pigmente (Titanweiß, Zinkweiß, Elfenbeinschwarz, Ultramarin, Phthaloblau, Cölinblau, Kadmiumgelb hell/mittel, Zitronengelb, Gelber Ocker, Rohe/Gebrannte Siena, Rohe/Gebrannte Umbra, Kadmiumrot, Alizarin Karmesin bzw. Ersatz, Chinacridon-Magenta, Phthalogrün, Viridian, Dioxazinviolett …). Die Spektraldaten sind Näherungen; das wird in der UI kenntlich gemacht.
- API: `mix(pigments: {id, parts}[]) → Farbe (sRGB + spektral)` und `findMix(targetColor, availablePigments, maxPigments=3) → Rezept + Abweichung (ΔE2000)`.

### 6.3 Akzeptanzkriterien
- Blau + Gelb ergibt sichtbar Grün; Komplementärmischungen ergeben gebrochene Töne statt Mittelgrau.
- `findMix` liefert für typische Fototöne Rezepte mit ΔE2000 < 5 bei Nutzung einer Standardpalette aus 8–12 Farben, sofern der Ton im Gamut liegt; sonst wird die Abweichung angezeigt.
- Unit-Tests für Mischung, Rezeptsuche und Randfälle (nur Weiß, eine Farbe, Out-of-Gamut).

---

## 7. Malvorlagen-Modul („Malplan“)

### 7.1 Zweck
Aus dem aktuellen Ergebnis (beliebiger Effekt-Stapel oder Originalbild) eine praktische Vorlage zum Nachmalen erzeugen. Eigener Arbeitsbereich in der UI („Malplan“), getrennt vom Effekt-Editor, aber mit Zugriff auf alle Ebenen.

### 7.2 Grundeinstellungen
- **Maltechnik:** Öl, Acryl, Aquarell, Gouache, Bleistift/Kohle. Bestimmt u. a. Schichtreihenfolge (Aquarell hell → dunkel, Öl/Acryl dunkel → hell) und welche Hilfen angeboten werden.
- **Untergrundformat:** echte Maße in cm (Presets für gängige Keilrahmen- und Papierformate, frei eingebbar). Abweichendes Seitenverhältnis → Zuschnitt interaktiv wählen.
- **Meine Farben:** Liste der vorhandenen Tubenfarben aus der Pigmentdatenbank (speicherbar als Profil).
- **Vereinfachungsgrad:** Regler „Anzahl Formen“ (z. B. 20 bis 2000) und „Anzahl Farben“ (z. B. 4 bis 40). Wirkt auf alle Hilfen.

### 7.3 Werte-Hilfen
- **Notan:** 2-Werte-Darstellung (Schwarz/Weiß) mit verschiebbarem Schwellwert.
- **Werteskizze:** 3, 4 oder 5 Tonwertstufen mit Vereinfachung kleiner Flächen (Mindestflächengröße einstellbar).
- **Wertskala:** Graukeil mit den verwendeten Stufen zum Ausdrucken und Abgleichen.

### 7.4 Farb-Hilfen
- **Warm-Kalt-Karte:** Farbtemperatur unabhängig von Helligkeit (z. B. im Oklab/OKLCh-Raum bestimmt).
- **Reduzierte Palette:** Das Bild wird auf die gewählte Farbanzahl reduziert, wobei **nur mit „Meine Farben“ mischbare Töne** verwendet werden (über `findMix`).
- **Mischrezepte:** Für jeden Farbton der reduzierten Palette ein Rezept in Teilen, z. B. „2 Teile Ultramarin + 1 Teil Gebrannte Siena + etwas Titanweiß“, mit Farbfeld (Soll vs. Mischergebnis) und ΔE-Angabe.
- **Farbfeld-Karte:** Bild als nummerierte Flächen (ähnlich Malen-nach-Zahlen, aber mit einstellbarer Detailtiefe), Nummer → Rezept. Optional, da künstlerisch eher als Lernhilfe gedacht.

### 7.5 Kanten-Karte
- Klassifiziert Kanten in **hart**, **weich** und **verloren** (verschwindend) anhand von Kontrast und Gradientenbreite.
- Farbiges Overlay (z. B. rot = hart, gelb = weich, blau = verloren), Schwellwerte einstellbar.
- Ziel: Malern zeigen, wo scharf und wo weich gemalt werden soll – ein in Tools praktisch nicht vorhandenes Hilfsmittel.

### 7.6 Schichtplan & Strichführung
- **Schichtplan:** Bildfolge in 4–8 Schritten (Untermalung → Blocking-in großer Flächen → Mitteltöne → Details → Lichter/Akzente), Reihenfolge abhängig von der Maltechnik. Jeder Schritt zeigt nur, was in diesem Schritt neu hinzukommt, plus den kumulierten Stand.
- **Strichführung:** Wenn `stroke-paint` verwendet wurde, werden dessen Strichdaten genutzt: Overlay mit Pfeilen für Strichrichtung, empfohlener Pinselbreite (in mm, umgerechnet auf das Untergrundformat) und Reihenfolge nach Schritten. Sonst wird die Richtung aus `flow` abgeleitet.

### 7.7 Übertragungshilfen
- **Proportionsraster:** Gitter in einstellbarer Teilung (z. B. 3×3, 4×4, alle 5 cm), passend zum Untergrundformat, auf Vorlage und als separates Blatt.
- **Konturvorlage:** reine Linienzeichnung der Hauptformen in Originalgröße zum Durchpausen, gekachelt auf A4/A3 bei großen Formaten (mit Überlappung und Passmarken).
- **Beamer-Modus:** Vollbild-Anzeige einer wählbaren Hilfe (Kontur, Raster, Werteskizze) mit Trapezkorrektur (vier Ecken ziehen), schwarzem Hintergrund und ausgeblendeter UI.

### 7.8 Export der Malvorlage
- **PDF-Malmappe:** Deckblatt (Endbild), Werteskizze, Notan, Palette mit Mischrezepten, Kanten-Karte, Schichtplan-Schritte, Raster, Konturvorlage (gekachelt). Seiten einzeln an-/abwählbar.
- Einzelne Hilfen als PNG.
- Malplan-Einstellungen werden in der Projektdatei gespeichert.

---

## 8. Oberfläche (Erweiterungen)

- **Effekt-Browser** (siehe 3.3) als Panel.
- **Effekt-Stapel-Panel:** Reihenfolge per Drag & Drop, Sichtbarkeit, Deckkraft, Blend-Mode, Maske, Preset laden/speichern, Seed neu würfeln.
- **Parameter-Panel:** automatisch aus `ParamSpec` erzeugt, mit Zurücksetzen pro Parameter, Gruppierung „Erweitert“ eingeklappt.
- **Vorher/Nachher:** Schieberegler-Vergleich und Umschalten per Taste.
- **Analysekarten-Overlay:** Auswahl einer Karte, Deckkraft des Overlays.
- **Job-Anzeige:** laufende Python-Renderjobs mit Fortschritt und Abbruch.
- **Arbeitsbereich „Malplan“** (Abschnitt 7).
- Sprache der UI: Deutsch.

---

## 9. Nicht-funktionale Anforderungen

### Performance
- Echtzeit-Effekte (`cost: realtime`): Vorschau ≥ 30 fps bei 1600 px langer Kante auf einem aktuellen Mittelklasse-Rechner.
- Interaktive Effekte: Vorschau-Update < 500 ms nach Parameteränderung (mit Entprellung).
- Python-Effekte: Vorschau-Render in < 10 s angestrebt; Endrender bei 24 MP darf länger dauern, muss aber Fortschritt melden und abbrechbar sein.
- Speicher: 24-MP-Bilder mit mehreren Ebenen dürfen den Browser-Tab nicht zum Absturz bringen. Bei Bedarf Kachelung (Tiling) für Endrender im Dienst und Tiles im Browser.

### Qualität & Tests
- Unit-Tests für Kernlogik (Registry, Parameter-Validierung, Pigment-Engine, Job-API).
- **Golden-Image-Tests:** Für jeden Effekt mindestens ein Referenzbild mit festen Parametern und Seed; Vergleich mit Toleranz. Testbilder: eigene oder gemeinfreie Fotos (Porträt, Landschaft, Architektur, Stillleben) im Repo.
- Effekte dürfen keine NaN/Inf-Werte oder Artefakte am Bildrand erzeugen.

### Export & Kompatibilität
- Effekt-Ebenen werden im **PSD-Export** als gerasterte Ebenen mit Ebenennamen = Effektname ausgegeben, Masken als Ebenenmasken.
- **Gruppen** werden als **PSD-Ebenengruppen** ausgegeben – auch Gruppen mit Effekten: Die Gruppe enthält ihre Kinder und darüber je Effekt eine gerasterte Ebene (Name = Effektname, Effektmaske als Ebenenmaske, Blend-Mode übernommen). Maske, Deckkraft und Blend-Mode der Gruppe werden zur Maske, Deckkraft und zum Blend-Mode der PSD-Gruppe.
- Die **Parallax-Vorschau** soll mit Effekt-Ebenen weiter funktionieren; tiefenbasierte Effekte nutzen nach Möglichkeit dieselbe Tiefenkarte.
- Projektdateien enthalten eine Versionsnummer; alte Projekte müssen nach Updates ladbar bleiben (Migration über `EffectDefinition.version`).

### Lizenzen
- Jeder Effekt, jedes Modell und jede Pigment-/Texturdatenquelle hat einen Lizenzeintrag.
- Eine zentrale Datei `LICENSES-THIRD-PARTY.md` (oder Bestand erweitern) listet alle Fremdkomponenten mit Lizenz und Einschränkungen.
- Im Modus „kommerziell“ sind nur kommerziell nutzbare Effekte und Modelle aktiv.

---

## 10. Phasenplan

Jede Phase endet mit: lauffähigem Stand, grünen Tests, kurzer Änderungsnotiz und einer Demo-Liste („so kann man es ausprobieren“).

### Phase E1 – Fundament & erste Effekte
- Effekt-Registry (Browser + Python), Schnittstelle nach Abschnitt 3, Integration ins bestehende Ebenen-/Maskenmodell
- Effekt-Browser, Stapel-Panel, Parameter-Panel (automatisch erzeugt), Presets, Seed, Projektdatei-Speicherung
- Vorschau/Endrender-Mechanik, Job-API mit Fortschritt und Abbruch
- Analysekarten `luminance`, `edges`
- Effekte: `pixel-sort`, `rgb-split`, `dither`, `pixelate`, `ink-lines`, `comic`, `kuwahara`, `halftone-cmyk`, `film-grain`, `low-poly`, `posterize-palette`, `bloom`, `tilt-shift`, `double-exposure`
- PSD-Export der Effekt-Ebenen
- Gruppen (Ergänzung 2.2a): Maske auf Gruppen, Effekte mit Masken und Blend-Modes auf Gruppen, PSD-Ausgabe als Ebenengruppen
- Golden-Image-Testinfrastruktur
**Abnahme:** Mindestens drei Effekte gleichzeitig auf unterschiedlichen, maskierten Ebenen kombinierbar; Export als PSD und PNG in voller Auflösung.

### Phase E2 – Effektbreite & Malplan-Grundlagen
- Analysekarte `flow`
- Restliche Effekte mit Phase E2 aus Abschnitt 5
- Malplan-Arbeitsbereich mit: Untergrundformat, Vereinfachungsgrad, Notan, Werteskizze, Wertskala, Warm-Kalt-Karte, Proportionsraster, Konturvorlage (gekachelt), Beamer-Modus
- PDF-Malmappe (mit den bis dahin verfügbaren Seiten)
**Abnahme:** Aus einem Foto entsteht eine druckbare PDF-Malmappe mit Werteskizze, Raster und gekachelter Konturvorlage im korrekten Maßstab.

### Phase E3 – Tiefe, Semantik & Stil
- Analysekarten `depth`, `normals`, `segmentation`, `saliency`, `faces` (mit Lizenzprüfung und Modellwahl je Modus)
- Effekte mit Phase E3, inkl. `relight`, `depth-fog`, `depth-bokeh`, `style-transfer`, `style-per-region`
- Masken aus Analysekarten und Segmentierung per Klick
- Abstimmung mit Parallax-Vorschau
**Abnahme:** Person per Klick segmentieren, ihr einen anderen Stil geben als dem Hintergrund, Licht nachträglich verschieben, Ergebnis exportieren.

### Phase E4 – Pigmente, Striche & Malplan komplett
- Pigment-Engine (Abschnitt 6) mit Pigmentdatenbank
- „Meine Farben“-Profil, reduzierte Palette mit Mischrezepten, Farbfeld-Karte
- `stroke-paint` mit gespeicherten Strichdaten, `impasto`, `saliency-abstraction`
- Kanten-Karte, Schichtplan, Strichführung
- PDF-Malmappe vollständig
**Abnahme:** Mit einer Palette von 10 eigenen Farben entsteht für ein Foto eine vollständige Malmappe inkl. Mischrezepten, Kanten-Karte und Schichtplan.

### Phase E5 – Simulationen & Experimente
- `watercolor-sim` (nutzt Pigment-Engine, inkl. Granulation)
- `aging`, `chemical`, `reaction-diffusion`, `crystal-growth`, `erosion`, `memory`, `cubist`
- Performance-Optimierung der Simulationen für 24 MP (Kachelung, ggf. GPU im Python-Dienst, falls verfügbar)
**Abnahme:** Jeder Simulationseffekt liefert mit Standard-Presets auf den Testbildern ein überzeugendes Ergebnis; Endrender in 24 MP läuft stabil durch.

---

## 11. Literatur & Verfahren (Orientierung)
- Curtis, Anderson, Seims, Fleischer, Salesin (1997): *Computer-Generated Watercolor*
- Hertzmann (1998): *Painterly Rendering with Curved Brush Strokes of Multiple Sizes*
- Secord (2002): *Weighted Voronoi Stippling*
- Kyprianidis, Kang, Döllner (2009): *Image and Video Abstraction by Anisotropic Kuwahara Filtering*
- Winnemöller (2011): *XDoG: Advanced Image Stylization with eXtended Difference-of-Gaussians*
- Kang, Lee, Chui (2007): *Coherent Line Drawing* (Edge Tangent Flow)
- Kubelka & Munk (1931) bzw. gängige Darstellungen des K/S-Modells für Pigmentmischung
- Huang & Belongie (2017): *Arbitrary Style Transfer in Real-time with Adaptive Instance Normalization* (AdaIN)
- Gray-Scott-Modell für Reaktions-Diffusion

Die Verfahren dürfen vereinfacht oder kombiniert werden, solange das Ergebnis überzeugt.

---

## 12. Außerhalb des Umfangs (vorerst)
- Video / Animation
- Mehrbenutzer, Cloud-Speicherung
- Andere Browser als Chrome
- Bilder über 24 MP
- Druckaufbereitung für Fine-Art-Druckereien (Farbprofile, Proof) – evtl. später

---

## 13. Offene Entscheidungen (vor Umsetzung vorlegen, nicht eigenmächtig treffen)
1. **Effekte als eigene Ebene oder als Filter auf Ebenen?** Vorschlag nach Analyse des bestehenden Ebenenmodells, mit Vor- und Nachteilen.
2. **WebGL2 oder WebGPU** für Browser-Effekte? Abhängig vom Bestand.
3. **Konkrete ML-Modelle** je Analysekarte und für Style-Transfer – mit Lizenz von Code und Gewichten, Größe, Geschwindigkeit, und welche Variante im kommerziellen bzw. nicht-kommerziellen Modus genutzt wird.
4. **GPU im Python-Dienst** vorhanden/gewünscht? Beeinflusst Phase E3–E5.
5. **Quelle der Pigment-Spektraldaten** und deren Lizenz.
6. Kommen bei der Analyse Konflikte mit der bestehenden Spec oder dem Code auf, werden sie gesammelt vorgelegt.
