# Abnahme Phase E4 – Pigmente, Striche & Malplan komplett

Stand 19.10.2026 · Grundlage: [spec-effekte-und-malvorlagen.md](spec-effekte-und-malvorlagen.md) Abschnitte 5.3, 5.9, 6, 7
und 10, Plan: [plan-E4.md](plan-E4.md), Entscheidungen: [DECISIONS.md](../DECISIONS.md) („E4: Pigmente, Striche,
Malplan“). Gemessen auf der Referenz-Hardware (Apple M4 Pro, 48 GB, Chrome 155).

## Änderungsnotiz

- **Pigment-Engine** (`src/pigments/`): 29 Künstlerpigmente (Colour-Index, Deckkraft, Lichtechtheit, Granulation),
  Spektren mit 31 Stützstellen, Kubelka-Munk mit zwei Konstanten, `mix` und `findMix` (bis 3 Pigmente, ΔE2000). Blau +
  Gelb ergibt Grün, Komplementärfarben ergeben gebrochene Töne. Die Pigmentdaten sind eigene Näherungen.
- **Malplan:**
  - **„Meine Farben“:** vorhandene Tubenfarben auswählen, als Profil speichern.
  - **Reduzierte Palette:** nur aus mischbaren Tönen, mit **Mischrezepten** in Teilen (Farbfeld Soll/Mischung, ΔE).
  - **Farbfeld-Karte:** nummerierte Flächen.
  - **Kanten-Karte:** hart, weich, verloren.
  - **Schichtplan:** Schritte je Maltechnik.
  - **Strichführung:** aus den Strichdaten von „Pinselstriche“ oder aus dem Richtungsfeld, mit Pinselbreite in mm.
- **PDF-Malmappe vollständig:** zusätzlich Palette mit Rezepten, Farbfeld-Karte, Kanten-Karte, eine Seite je Schritt
  und Strichführung.
- **Neue Effekte:**
  - **Pinselstriche** (`stroke-paint`, Hertzmann 1998): Striche als Daten.
  - **Impasto:** Relief im Streiflicht.
  - **Abstraktion nach Aufmerksamkeit:** Detail bleibt bei Salienz, Gesichtern und Fokuskarte.

## Abnahmekriterium

> Mit einer Palette von 10 eigenen Farben entsteht für ein Foto eine vollständige Malmappe inkl. Mischrezepten,
> Kanten-Karte und Schichtplan.

| Prüfung                                                                                                          | Ergebnis                                            | Nachweis               |
| ---------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- | ---------------------- |
| 10 eigene Farben in der Oberfläche gewählt (nicht die Standardpalette), als Profil gespeichert                   | erfüllt                                             | `acceptanceE4.spec.ts` |
| Reduzierte Palette (12 Farben) nur aus diesen Farben gemischt                                                    | erfüllt: dE Median 1,4, alle 12 unter 5, größte 2,4 | `acceptanceE4.spec.ts` |
| Malmappe enthält Mischrezepte (Rezepte nur mit den eigenen Farben)                                               | erfüllt                                             | `acceptanceE4.spec.ts` |
| Malmappe enthält die Kanten-Karte mit Legende                                                                    | erfüllt                                             | `acceptanceE4.spec.ts` |
| Malmappe enthält den Schichtplan (Öl: 6 Schritte, je eine Seite)                                                 | erfüllt                                             | `acceptanceE4.spec.ts` |
| Weitere Seiten: Farbfeld-Karte, Strichführung (aus den Pinselstrichen), Werte, Raster, Konturvorlage maßstäblich | erfüllt: 21 Seiten                                  | `acceptanceE4.spec.ts` |

Weitere Nachweise:

- Pigment-Tests nach Spec 6.3 in `pigments.test.ts`: Blau + Gelb, Komplementärfarben, Rezepte < 5 dE, nur Weiß, eine
  Farbe, Out-of-Gamut.
- Unit-Tests `malplanPalette.test.ts`, `malplanEdges.test.ts`, `malplanPlan.test.ts`.
- E2E-Tests in `malplan.spec.ts`.
- Golden-Fälle der drei neuen Effekte.

## Messwerte

| Messung                                                              | Wert          |
| -------------------------------------------------------------------- | ------------- |
| Rezept für einen Farbton (10 Farben, bis 3 Pigmente)                 | ca. 20 ms     |
| Neuberechnung Palette + Schichtplan + Strichführung (Straßenporträt) | 0,9 s         |
| Malmappe 21 Seiten (40 × 30 cm, A4)                                  | 1,6 s, 7,5 MB |

## Demo-Liste

1. Foto öffnen, Effekt „Pinselstriche“ hinzufügen (optional „Impasto“ darüber).
2. Arbeitsbereich „Malplan“ → „Meine Farben“: eigene Tubenfarben ankreuzen, „Als Profil speichern“.
3. Hilfe „Reduzierte Palette“: Rezepte rechts (links Soll, rechts Mischung, ΔE).
4. „Farbfeld-Karte“, „Kanten-Karte“ (Schwellen verschieben), „Schichtplan“ (Schritte anklicken), „Strichführung“.
5. Maltechnik auf „Aquarell“ stellen: Schichtplan hell → dunkel.
6. „PDF-Malmappe …“ erstellen.

## Bekannte Grenzen

- Pigmentspektren sind Näherungen aus geschätzten Farben, keine Messdaten. Rezepte zeigen die Richtung; echte Farben
  verschiedener Hersteller weichen ab.
- Die Strichführung erzeugt die Striche von „Pinselstriche“ für den Malplan-Ausschnitt neu (gleiche Parameter und Seed)
  aus dem gerenderten Endbild; sie gleichen den Strichen des Effekts, sind aber nicht identisch.
- Kanten-Karte: die Grenze „hart“ ist relativ zur Bildgröße; sehr kleine Fotos wirken überall hart.
- Schichtplan-Regeln sind fest je Technik (6 bzw. 5 Schritte), nicht frei einstellbar.
