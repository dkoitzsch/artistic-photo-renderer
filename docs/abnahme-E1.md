# Abnahme Phase E1 – Fundament & erste Effekte

Stand 17.10.2026 · Grundlage: [spec-effekte-und-malvorlagen.md](spec-effekte-und-malvorlagen.md) Abschnitt 10,
Plan: [plan-E1.md](plan-E1.md), Entscheidungen: [DECISIONS.md](../DECISIONS.md).
Gemessen auf der Referenz-Hardware (Apple M4 Pro, 48 GB, Chrome 155).

## Änderungsnotiz

- **Effekt-Schnittstelle v2:**
  - Jeder Effekt beschreibt sich in einem einzigen Manifest. Es enthält Ausführungsort für Vorschau und Endrender
    (WebGPU, Browser-CPU, Python-Dienst), Lizenz, Kosten, Seed, benötigte Analysekarten und Parametergruppen.
  - Neue Parametertypen: Seed, Palette, Zweitbild.
  - Der Python-Dienst liest dieselben Manifeste.
- **Effekte wirken gezielt:** Jeder Effekt hat einen eigenen Mischmodus und eine eigene Maske. Die Maske ist ein Bereich der
  Helligkeit, der Kantenstärke oder der Tiefe, oder die Maske einer anderen Ebene. Sie lässt sich umkehren.
- **Gruppen (Ergänzung 2.2a):**
  - Effekte, Masken, Deckkraft und Mischmodus wirken auch auf Gruppen, und zwar auf das zusammengeführte Ergebnis.
    Gruppen lassen sich verschachteln.
  - Im PSD werden sie zu Ebenengruppen.
- **Seed:** Jeder Effekt mit Zufall ist reproduzierbar. Der Zufall hängt an der Leinwandposition, deshalb sind Vorschau,
  Kacheln und Export gleich. Ein Würfel-Knopf erzeugt einen neuen Seed.
- **Presets:** eigene Effekt-Presets mit Vorschaubild, Stapel-Presets, Export und Import. Jeder Effekt bringt mindestens
  zwei Presets mit.
- **Analysekarten:** „Helligkeit“ und „Kanten“ (Stärke, Richtung, Kohärenz) werden im Browser auf der GPU berechnet.
  Ansicht „Karten“ (Taste 5) mit Deckkraft. Jede Karte ist als Effektmaske nutzbar.
- **Asynchrone Effekte:** Effekte können im Web Worker (CPU) oder im Python-Dienst laufen. Dazu gibt es:
  - eine Job-Anzeige mit Fortschritt und Abbruch,
  - einen Hash-Cache,
  - „Vollauflösung rendern“,
  - einen Export, der auf die Ergebnisse wartet.
- **14 neue Effekte:**

  | Gruppe                   | Effekte                                                                                                          |
  | ------------------------ | ---------------------------------------------------------------------------------------------------------------- |
  | GPU, Bild & Licht        | RGB-Versatz, Pixel/Mosaik, Filmkorn & Halation, Bloom, Tilt-Shift, Posterisierung mit Palette (k-Means in Oklab) |
  | GPU, Zeichnung & Malerei | Tusche-Linien (XDoG), Comic, Halbton/Siebdruck (CMYK), Ölbild (anisotroper Kuwahara), Doppelbelichtung           |
  | Browser-CPU              | Dithering (eigenes Blue Noise), Pixel-Sorting                                                                    |
  | Browser-CPU und Dienst   | Low-Poly (Vorschau im Browser, Endrender im Dienst, pixelgleich)                                                 |

- **Effekt-Browser:**
  - Kennzeichen für Kosten, CPU/Dienst, „NC“ und benötigte Karten.
  - GPU-Effekte zeigen eine Live-Vorschau auf einem 1:1-Ausschnitt.
  - Nicht-kommerzielle Effekte sind im Modus „Kommerziell“ gesperrt.
  - Die Parametergruppe „Erweitert“ ist eingeklappt.
  - Fehlergrenzen schützen die einzelnen UI-Bereiche.
- **Ausschnitt in voller Auflösung:**
  - Beim Hineinzoomen über die Vorschau hinaus rendert die App den sichtbaren Bereich nach 150 ms Ruhe in voller
    Auflösung. Er ist pixelgleich zum Export.
  - Ausnahmen: Worker- und Dienst-Effekte sowie Parallax.
- **PSD:**
  - Gruppen werden immer als Ebenengruppen ausgegeben, mit aktiver Gruppenmaske.
  - Option „Effekte als eigene Ebenen“: Jede Ebene bekommt einen Ordner aus Basis plus je einer gerasterten Ebene pro
    Effekt. Stärke wird zur Deckkraft, der Mischmodus wird übernommen, die Effektmaske wird zur Ebenenmaske.
- **Tests:**
  - Golden-Tests für alle Effekte, mit Prüfung auf Kachelnähte, NaN/Inf und Bildrand.
  - CPU-Referenzen für Seed und Doppelbelichtung.
  - Prüfung der PSD mit psd-tools.
  - Insgesamt 100 E2E-Tests, 101 Unit-Tests und 22 Dienst-Tests.
- **Lizenzen:** `LICENSES-THIRD-PARTY.md` neu angelegt. Neu hinzugekommen: delaunator (ISC), robust-predicates (Unlicense),
  scipy (BSD-3-Clause).

## Abnahmekriterium

> Mindestens drei Effekte gleichzeitig auf unterschiedlichen, maskierten Ebenen kombinierbar; Export als PSD und PNG in voller
> Auflösung.

Automatisch geprüft in `tests/e2e/acceptanceE1.spec.ts` mit einem Testbild von 6000 × 4000 px (24 MP):

| Ebene / Knoten | Maske                  | Effekte                                                          |
| -------------- | ---------------------- | ---------------------------------------------------------------- |
| Vordergrund    | Maske A (Kreis)        | Ölbild (Radius 12) + Tusche-Linien (Mischmodus „Multiplizieren“) |
| linkes Drittel | Maske B (weicher Rand) | Halbton CMYK                                                     |
| Rest           | ¬B mit Lochfüllung     | Pixel/Mosaik + Filmkorn (Effektmaske: Helligkeit 40–100 %)       |
| äußere Gruppe  | –                      | Bloom (Gruppeneffekt auf das Gesamtergebnis)                     |

| Prüfung                                                                            | Ergebnis |
| ---------------------------------------------------------------------------------- | -------- |
| Drei maskierte Ebenen mit zusammen 6 Effekten plus 1 Gruppeneffekt                 | ✅       |
| PNG in voller Auflösung, 6000 × 4000 px, jede Ebene im Ergebnis sichtbar verändert | ✅       |
| PSD in voller Auflösung, 6000 × 4000 px, verschachtelte Ebenengruppen              | ✅       |
| Lint, Typecheck, Unit-, Dienst- und E2E-Tests, Build                               | ✅       |

### Messwerte

Werte aus dem Abnahmelauf am 17.10.2026:

| Messung (24 MP, Szene oben)                         | Wert                           |
| --------------------------------------------------- | ------------------------------ |
| Vorschau (2048 px) nach Parameteränderung am Ölbild | Median 24 ms, max. 70 ms       |
| Ausschnitt in voller Auflösung bei 100 %            | 186 ms, davon 150 ms Ruhepause |
| PNG-Export                                          | 1,3 s                          |
| PSD-Export (Standard)                               | 6,1 s                          |

Vorschau 1600 × 1067 px, ganzer Frame neu gerechnet, ein Effekt mit Standardwerten, Median.
Ziel der Spec: Echtzeit ≥ 30 fps, also < 33 ms.

| Effekt                                  | Kosten     | ms      |
| --------------------------------------- | ---------- | ------- |
| Tusche-Linien, Bloom, Tilt-Shift, Comic | Echtzeit   | 2,5–2,7 |
| Halbton CMYK                            | Echtzeit   | 1,2     |
| übrige GPU-Effekte                      | Echtzeit   | 0,4–0,9 |
| Ölbild (Kuwahara)                       | interaktiv | 19      |
| ohne Effekt                             | –          | 0,3     |

CPU- und Dienst-Effekte beim Export in 24 MP:

| Effekt             | Wert  |
| ------------------ | ----- |
| Dithering          | ≤ 3 s |
| Pixel-Sorting      | ≤ 3 s |
| Low-Poly im Dienst | 14 s  |

Einzelheiten in [optimierungen-und-varianten.md](optimierungen-und-varianten.md#messwerte-cpu--und-dienst-effekte).

## Demo-Liste: so kann man es ausprobieren

`npm run dev` startet App und Dienst. Dann http://localhost:5317 öffnen und ein Foto laden (z. B. aus `tests/fixtures/`).

1. **Effekt-Browser:** rechts im Inspektor „+ Effekt“ öffnen.
   - Kategorien und Suche ausprobieren.
   - Die Kennzeichen ansehen: Kosten (interaktiv/langsam), CPU/Dienst, NC, Karten.
   - GPU-Effekte zeigen eine Live-Vorschau des eigenen Bildes.
2. **Mehrere Effekte stapeln:**
   - Ölbild hinzufügen, dann Tusche-Linien darüber.
   - Bei den Tusche-Linien den Mischmodus „Multiplizieren“ wählen.
   - Reihenfolge per Ziehen ändern. Die Stärke regelt die Deckkraft des Effekts.
3. **Effektmaske:** in der Effektkarte die Maske „Helligkeitsbereich“ wählen und den Bereich einstellen.
   Der Effekt wirkt dann nur in hellen oder dunklen Partien. Mit „Maske umkehren“ wird es umgekehrt.
4. **Analysekarten:** Taste 5 (Ansicht „Karten“), dann „Helligkeit“ oder „Kanten“ wählen. Bei den Kanten zeigt die Farbe die
   Richtung. Mit dem Regler die Deckkraft einstellen.
5. **Seed:** Filmkorn oder Dithering hinzufügen. Unter „Erweitert“ den Würfel drücken. Mit ⌘Z kommt der alte Seed zurück,
   und das Bild ist wieder exakt gleich.
6. **Presets:**
   - Im Preset-Menü einer Effektkarte ein mitgeliefertes Preset wählen.
   - Eigene Einstellungen als Preset speichern.
   - Den ganzen Stapel als Stapel-Preset sichern und auf eine andere Ebene anwenden.
7. **Gruppen:**
   - Zwei Ebenen markieren (⌘- oder Shift-Klick in der Ebenenliste) und gruppieren.
   - Auf die Gruppe einen Effekt legen, z. B. Bloom. Er wirkt auf das zusammengeführte Ergebnis.
   - Der Gruppe eine Maske geben (Ebenenmaske oder Kartenbereich) und Deckkraft und Mischmodus einstellen.
8. **CPU- und Dienst-Effekte:**
   - Dithering, Pixel-Sorting oder Low-Poly hinzufügen.
   - Unten erscheint die Job-Anzeige mit Fortschritt und „Abbrechen“.
   - Bis das Ergebnis da ist, zeigt die Vorschau den Eingang. Mit „Vollauflösung rendern“ wird vorab gerechnet.
9. **Lizenzmodus:**
   - Im Modus „Kommerziell“ sind NC-Effekte im Browser ausgegraut.
   - In „Alle“ lassen sie sich nutzen. Der Export warnt dann.
10. **Hineinzoomen:** ein großes Foto (über 2048 px) laden und auf 100 % oder mehr zoomen (⌘1).
    - Nach einem kurzen Moment wird der Ausschnitt scharf, in voller Auflösung, genau wie im Export.
    - Beim Ziehen eines Reglers sieht man kurz die Vorschau.
11. **Doppelbelichtung:** Effekt hinzufügen, ein Zweitbild wählen, Mischart und Maske (z. B. Helligkeit) einstellen.
12. **Export:**
    - ⌘E öffnet den Export, Format PSD wählen.
    - Einmal ohne und einmal mit „Effekte als eigene Ebenen“ exportieren und in Photoshop, Affinity oder Photopea öffnen.
    - Gruppen erscheinen als Ebenengruppen, Effekte als eigene Ebenen mit Maske, Deckkraft und Mischmodus.

## Bekannte Grenzen nach E1

- Effekte aus Worker oder Dienst rechnen auf dem ganzen Bild. Bis zum Ergebnis zeigt die Vorschau den unbearbeiteten Eingang,
  und der Ausschnitt in voller Auflösung entfällt.
- Halbton, Linsen-, Bewegungs- und Zoom-Unschärfe: Zwischen Kacheln weichen einzelne Pixel um ±1 Stufe ab (Metal fast-math bzw.
  Hardware-Sampler).
- Das Ölbild ist „interaktiv“ (19 ms bei 1600 px) und nicht ganz Echtzeit. Bei großen Radien plus Iterationen bleibt es über 33 ms.
- Die Mehrfachauswahl dient nur zum Gruppieren.
- PSD-Programme mischen in 8-Bit-sRGB. An weichen Kanten weicht die PSD deshalb minimal von der App ab.
