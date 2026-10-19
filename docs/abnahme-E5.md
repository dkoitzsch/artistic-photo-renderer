# Abnahme Phase E5 – Simulationen & Experimente

Stand 19.10.2026 · Grundlage: [spec-effekte-und-malvorlagen.md](spec-effekte-und-malvorlagen.md) Abschnitte 5 und 10,
Plan: [plan-E5.md](plan-E5.md), Entscheidungen: [DECISIONS.md](../DECISIONS.md) („E5: Simulationen“). Gemessen auf der
Referenz-Hardware (Apple M4 Pro, 48 GB, Chrome 155).

## Änderungsnotiz

- **Simulationsraster:** Alle Simulationen rechnen auf einem festen Raster über der Leinwand. Die Zellgröße gilt in
  Leinwand-px, das Raster hat höchstens 1536–2048 Zellen an der langen Kante. Vorschau und Export rechnen dieselbe
  Simulation, deshalb sieht der Export aus wie die Vorschau. Die Effekte werden am Stück exportiert, nicht in Kacheln.
- **Neue Effekte (GPU):**
  - **Reaktions-Diffusion** (`reaction-diffusion`): Gray-Scott-Muster wachsen aus dunklen Bereichen oder Kanten.
    Presets Korallen, Flecken, Labyrinth. Darstellung im Bild, als Überlagerung oder zweifarbig.
  - **Eisblumen** (`crystal-growth`): verzweigte Kristalle wachsen von Kanten aus, mit Glanz.
  - **Erosion** (`erosion`): Das Bild wird zum Höhenfeld (Helligkeit oder Tiefe). Regen trägt Material ab, Farbe wird
    stromabwärts mitgetragen, dazu ein Relief im Licht.
  - **Chemische Prozesse** (`chemical`): Rost, Bleiche, Solarisation (Sabattier). Sie breiten sich von Kanten, dunklen
    Stellen, Nahem oder Flecken aus.
  - **Alterung** (`aging`): Craquelé nach Schichtdicke, Schüsselbildung, vergilbender Firnis, Ausbleichen
    lichtempfindlicher Farben, bei feuchtem Klima Schmutz und Stockflecken.
  - **Erinnerung** (`memory`): Unwichtiges verblasst, verschwimmt oder löst sich auf. Gesichter, Auffälliges und die
    Fokuskarte bleiben erhalten.
  - **Kubistisch** (`cubist`): Fragmente aus versetzten Blickwinkeln über die Tiefe, als Splitter oder als
    Hockney-Joiner aus gedrehten Fotos. Lücken werden gefüllt oder bleiben offen.
- **Aquarell (Simulation)** (`watercolor-sim`, Worker, vereinfacht nach Curtis et al. 1997):
  - Das Bild wird in Lasuren zerlegt. Jede Lasur bekommt ein Pigmentrezept aus der Pigment-Engine.
  - Die Lasuren liegen als Kubelka-Munk-Schichten auf dem Papier.
  - Weitere Wirkungen: Verlaufen nach Wassermenge, dunkle Ränder beim Trocknen, Blüten (Backruns), Granulation in den
    Papiertälern, Papierstruktur.
  - Neue Funktionen der Pigment-Engine: `mixConstants`, `layerReflectance`, `mixGranulation`.

## Abnahmekriterium

> Jeder Simulationseffekt liefert mit Standard-Presets auf den Testbildern ein überzeugendes Ergebnis; Endrender in
> 24 MP läuft stabil durch.

| Prüfung                                                                                    | Ergebnis                                                            | Nachweis                                  |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------- | ----------------------------------------- |
| Jeder der 8 Simulationseffekte auf den Testfotos (Standardwerte und mitgelieferte Presets) | erfüllt: 17 Golden-Fälle, jedes Ergebnis angesehen und abgestimmt   | `effectCases.ts`, `tests/golden/effects/` |
| Endrender in 24 MP (6000 × 4000) je Simulationseffekt, PNG in voller Größe                 | erfüllt: alle 8 laufen durch, kein leeres oder einfarbiges Ergebnis | `acceptanceE5.spec.ts`                    |
| Vorschau und Export zeigen dasselbe (festes Simulationsraster, Export am Stück)            | erfüllt                                                             | Golden-Tests (Kachel-Vergleich)           |
| Simulationen mit Seed reproduzierbar                                                       | erfüllt                                                             | Golden-Tests                              |

Golden-Fälle (Testfotos Porträt, Landschaft, Architektur, Stillleben):

| Effekt               | Fälle                                                                            |
| -------------------- | -------------------------------------------------------------------------------- |
| `reaction-diffusion` | Porträt (Standard), Landschaft (Labyrinth)                                       |
| `crystal-growth`     | Porträt (Standard), Architektur (Eisblumen am Fenster)                           |
| `erosion`            | Landschaft (Standard), Porträt (Sintflut)                                        |
| `chemical`           | Architektur (Alter Rost), Porträt (Ausgebleicht), Stillleben (Sabattier)         |
| `aging`              | Porträt (Altmeister), Landschaft (Feuchter Keller)                               |
| `memory`             | Porträt (Standard, Zerfall); Salienz synthetisch                                 |
| `cubist`             | Porträt (Analytischer Kubismus), Architektur (Hockney-Joiner); Tiefe synthetisch |
| `watercolor-sim`     | Landschaft (Standard), Porträt (Nass in Nass)                                    |

## Messwerte

24-MP-Testbild (6000 × 4000), je Effekt Standardwerte, `acceptanceE5.spec.ts`:

| Effekt               | Vorschau (2048 px, ganze Simulation) | PNG-Endrender 24 MP |
| -------------------- | ------------------------------------ | ------------------- |
| `reaction-diffusion` | 1,0 s                                | 1,2 s               |
| `crystal-growth`     | 0,8 s                                | 1,0 s               |
| `erosion`            | 0,1 s                                | 0,6 s               |
| `chemical`           | < 0,1 s                              | 0,1 s               |
| `aging`              | < 0,1 s                              | 0,5 s               |
| `memory`             | < 0,1 s                              | 0,2 s               |
| `cubist`             | < 0,1 s                              | 0,2 s               |
| `watercolor-sim`     | 3,9 s (Worker)                       | 0,6 s               |

Die Simulationen auf dem Raster (Reaktions-Diffusion, Eisblumen, Erosion, Aquarell) rechnen in der Vorschau und im
Export dieselbe Simulation. Im Export kommt daher vor allem die Darstellung in voller Auflösung hinzu.

## Demo-Liste

1. Foto öffnen, im Effekt-Browser „Reaktions-Diffusion“ hinzufügen, Preset „Labyrinth“, Steuerung „Kanten“.
2. „Eisblumen“ mit „Eisblumen am Fenster“ auf einem Architekturfoto.
3. „Erosion“ auf einer Landschaft: Höhenquelle „Tiefe (nah = hoch)“ und Preset „Sintflut“ vergleichen.
4. „Alterung“: Jahre 0 → 500, Klima feucht.
5. „Erinnerung“ auf einem Porträt: Das Gesicht bleibt, der Rest zerfällt.
6. „Kubistisch“: Preset „Hockney-Joiner“.
7. „Aquarell (Simulation)“: Presets „Nass in Nass“ und „Granulierend auf Rauem Papier“. Die Berechnung läuft im
   Hintergrund mit Fortschrittsanzeige.
8. Export PNG in voller Auflösung.

## Bekannte Grenzen

- Die Simulationen haben eine globale Reichweite und werden deshalb am Stück exportiert. Der Ausschnitt in voller
  Auflösung entfällt beim Hineinzoomen.
- Das Simulationsraster ist gröber als 24 MP: Muster und Lasuren haben eine Mindestgröße von etwa 3–4 Leinwand-px. Die
  Darstellung (Relief, Papier, Granulation) läuft in voller Auflösung.
- Aquarell ist vereinfacht: keine echte Fluiddynamik (Flachwassergleichungen), sondern Verlaufen, Randverdunkelung und
  Blüten als Modell auf dem Raster. Die Pigmentrezepte nutzen die genäherten Pigmentdaten aus E4.
- „Kubistisch“ braucht die Tiefenkarte, „Erinnerung“ Salienz und Gesichter. Die App berechnet sie mit den Modellen aus
  E3. Golden-Tests und Abnahme nutzen synthetische Karten; die Ergebnisse mit echten Karten hängen von deren Güte ab.
- Eine GPU im Python-Dienst wird nicht genutzt; alle Simulationen laufen im Browser.
