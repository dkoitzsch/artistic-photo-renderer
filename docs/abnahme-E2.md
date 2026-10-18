# Abnahme Phase E2 – Effektbreite & Malplan-Grundlagen

Stand 18.10.2026 · Grundlage: [spec-effekte-und-malvorlagen.md](spec-effekte-und-malvorlagen.md) Abschnitte 4, 5, 7, 10,
Plan: [plan-E2.md](plan-E2.md), Entscheidungen: [DECISIONS.md](../DECISIONS.md) („E2: Grundsatzentscheidungen“).
Gemessen auf der Referenz-Hardware (Apple M4 Pro, 48 GB, Chrome 155).

## Änderungsnotiz

- **Analysekarte „Richtungsfeld“ (`flow`):** Strichrichtung aus zwei geglätteten Strukturtensoren (σ = 6 und 24 px) – folgt
  Kanten und setzt sich in ruhigen Flächen fort. Gleiches Verfahren auf der GPU, im Worker und im Python-Dienst; in der
  Kartenansicht (Taste 5) als „Richtungsfeld“ sichtbar.
- **19 neue Effekte** (alle im Browser, siehe DECISIONS):

  | Gruppe                | Effekte                                                                                                           |
  | --------------------- | ----------------------------------------------------------------------------------------------------------------- |
  | Digital & Glitch      | Röhrenbild & VHS, Datamosh (echte 8 × 8-DCT), Verschiebung & Slit-Scan, ASCII- & Text-Art                         |
  | Zeichnung & Grafik    | Schraffur (gerade oder entlang der Formen), Kohle & Rötel, Blaupause, Stippling (Browser-CPU)                     |
  | Malerei & Druck       | Pointillismus (auch mit Palette), Risografie, Alte Verfahren (Cyanotypie, Sepia, Kollodium), Infrarot, Sofortbild |
  | Material & Oberfläche | Papier (Knittern, Falten, Flecken, Büttenrand), Mosaik & Buntglas, Prägung & Metallfolie                          |
  | Geometrie & Licht     | Kaleidoskop (inkl. Droste), Polarkoordinaten (kleiner Planet), Lichtstrahlen                                      |

- **Kern:** Parametertyp `text` (eigener Text, z. B. für ASCII), Glyphen-Atlas `ctx.glyphs` (Inter bzw. Systemschriften),
  globale Effekte (Reichweite = Leinwand) werden im Export am Stück gerendert.
- **Arbeitsbereich „Malplan“** (Umschalter „Bearbeiten | Malplan“ oben):
  - Grundeinstellungen: Maltechnik, Untergrund in cm mit Presets (Keilrahmen, Papier, Aquarellblock) oder frei,
    Hoch/Quer, Zuschnitt auf das Seitenverhältnis (Rahmen auf dem Bild verschieben/skalieren).
  - Vereinfachung: „Anzahl Formen“ (20–2000) und „Anzahl Farben“ (4–40) wirken auf alle Hilfen. Die Analyse läuft im
    Web Worker auf dem aktuellen Ergebnis (lange Kante 1600 px).
  - Hilfen: Notan (Schwelle, „Automatisch“), Werteskizze (3/4/5 Stufen, Mindestfläche), Wertskala, Warm-Kalt-Karte
    (unabhängig von der Helligkeit), Proportionsraster (Felder oder Abstand in cm), Konturvorlage (Vektor). Jede Hilfe
    als PNG.
  - Beamer-Modus: eigenes Fenster, Vollbild (F), Trapezkorrektur durch Ziehen der vier Ecken; Ecken im Projekt.
  - PDF-Malmappe (eigener PDF-Schreiber): Deckblatt, Werteskizze mit Wertskala, Notan, Warm-Kalt-Karte, Endbild mit
    Raster, Raster als eigenes Blatt, Konturvorlage in Originalgröße auf A4/A3 gekachelt (Übersicht, Überlappung,
    Passmarken, 5-cm-Kontrollmaß). Seiten wählbar.
  - Alle Einstellungen im Projekt (Projektformat 7) mit Undo.
- **Behoben während E2:** Regler lösen Worker-/Dienst-Effekte erst beim Loslassen aus; Tiefenebenen ohne Saum bei
  starker Unschärfe; Pixel-Sorting „Weichheit“; Ölbild ohne schwarze Flecken; obere Leiste läuft bei 1440 px nicht über.
- **Tests:** 141 Unit-Tests, 23 Dienst-Tests, 143 E2E- und Golden-Tests (Golden-Bilder für alle neuen Effekte,
  GPU-Richtungsfeld gegen CPU-Referenz, Malplan, Beamer, Malmappe, Abnahme).

## Abnahmekriterium

> Aus einem Foto entsteht eine druckbare PDF-Malmappe mit Werteskizze, Raster und gekachelter Konturvorlage im korrekten
> Maßstab.

| Prüfung                                                                                                                       | Ergebnis | Nachweis                                                                                  |
| ----------------------------------------------------------------------------------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------- |
| Foto (1600 × 1067) mit E2-Effekt (Kohle & Rötel, Maske, Mischmodus, 60 %) wirkt im Export, gekachelt gleich (±1)              | erfüllt  | `acceptanceE2.spec.ts`                                                                    |
| Malplan: Format 50 × 70 cm wird zum Querformat 70 × 50 cm, Zuschnitt im Seitenverhältnis, 5 Tonwertstufen                     | erfüllt  | `acceptanceE2.spec.ts`                                                                    |
| Malmappe: 15 Seiten (6 Einzelseiten, Übersicht, 4 × 2 Kacheln A4)                                                             | erfüllt  | `acceptanceE2.spec.ts`                                                                    |
| Werteskizze mit Wertskala, Raster (auf dem Bild und als eigenes Blatt) enthalten                                              | erfüllt  | Seitentitel im PDF, Sichtprüfung                                                          |
| Maßstab: Bildrahmen der Konturvorlage = 70 × 50 cm (1984,252 × 1417,323 pt), Kontrollmaß 5 cm = 141,732 pt je Blatt           | erfüllt  | `acceptanceE2.spec.ts`                                                                    |
| PDF formal gültig                                                                                                             | erfüllt  | pypdf im Strict-Modus (einmalig, `uv run --with pypdf`), eigene Querverweisprüfung (Unit) |
| Mindestkriterien je Effekt (Spec 5): Maske, Deckkraft, Mischmodus, ≥ 2 Presets, Vorschau = Endrender, keine NaN/Randartefakte | erfüllt  | `effectsCatalog.test.ts`, Golden-Tests (`effectCases.ts`)                                 |

Nicht automatisch prüfbar: der tatsächliche Ausdruck. Empfehlung: ein Kachelblatt mit „Tatsächliche Größe“ drucken und das
5-cm-Kontrollmaß nachmessen.

## Messwerte

| Messung                                                                 | Wert                 | Ziel                 |
| ----------------------------------------------------------------------- | -------------------- | -------------------- |
| E2-GPU-Effekte, Vorschau 1600 × 1067, ganzer Frame                      | 0,4–2,9 ms je Effekt | Echtzeit < 33 ms     |
| Stippling (Browser-CPU), 9000 Punkte, 24 Durchgänge, Export 1600 × 1067 | 2,3 s                | Fortschritt, Abbruch |
| Malplan-Analyse (Rendern + Worker, 1600 px)                             | 1,3 s                | –                    |
| Malmappe 15 Seiten                                                      | 0,4 s, 6,1 MB        | –                    |

## Demo-Liste (so kann man es ausprobieren)

1. Foto öffnen, „+ Effekt“ → Kategorie „Digital & Glitch“: **Datamosh** „Datamosh-Video“, **ASCII** „Farbiger Text“ und
   eigenen Text eintippen, **Röhrenbild** „VHS-Kassette“.
2. **Schraffur** „Bleistift entlang der Formen“ auf einem Porträt; dazu Taste 5 → „Richtungsfeld“ ansehen.
3. **Pointillismus** „Divisionismus (Palette)“ und **Risografie** „Drei Farben“ auf einer Landschaft.
4. **Kaleidoskop** „Droste-Spirale“ oder **Polarkoordinaten** „Kleiner Planet“ (globale Effekte, Export am Stück).
5. Oben auf **Malplan** wechseln: Format „50 × 70 cm“ wählen, „Zuschnitt wählen“ und den Rahmen verschieben.
6. „Anzahl Formen“ auf 60 und 600 stellen und die **Werteskizze** vergleichen; **Notan** mit „Automatisch“.
7. **Warm-Kalt-Karte** und **Konturvorlage** ansehen; eine Hilfe „Als PNG speichern“.
8. „Beamer-Fenster öffnen“, Fenster auf den Projektor ziehen, F für Vollbild, Ecken auf die Leinwand ziehen.
9. „PDF-Malmappe …“ → „PDF erstellen“; ein Kachelblatt in Originalgröße drucken und das Kontrollmaß messen.

## Bekannte Grenzen

- Die Werte- und Farbhilfen sind Rasterbilder (lange Kante 1600 px); nur die Konturvorlage ist ein Vektor.
- Maltechnik bestimmt in E2 noch keine Schichtreihenfolge (folgt mit dem Schichtplan in E4).
- Beamer: ein zweites Fenster; der Projektor muss als Bildschirm angeschlossen sein. Ecken sind auf das Fenster bezogen.
- Stippling rechnet im Worker auf der ganzen Ebene; große Punktzahlen dauern einige Sekunden.
