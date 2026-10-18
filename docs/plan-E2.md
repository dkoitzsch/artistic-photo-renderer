# Plan Phase E2 – Effektbreite & Malplan-Grundlagen

Grundlage: [spec-effekte-und-malvorlagen.md](spec-effekte-und-malvorlagen.md) Abschnitte 4, 5, 7 und 10,
Entscheidungen in [DECISIONS.md](../DECISIONS.md) („E2: Grundsatzentscheidungen“). Freigabe durch den Nutzer am 17.10.2026.
Jeder Schritt endet lauffähig, mit grünen Tests, aktueller `PROGRESS.md`, Commit und Push auf `main`.

- [x] 0. Plan, Entscheidungen, PROGRESS.md
- [x] 1. Analysekarte `flow` (GPU, Browser-CPU, Dienst, Abgleich-Tests), Ansicht „Fluss“; Kern: globale Effekte
      (Reichweite ≥ halbe Leinwand) im Export am Stück, Ausschnitt in voller Auflösung bei zu großer Fläche aus
- [x] 2. Digital & Glitch: `scanlines-crt`, `datamosh`, `displace`, `ascii` (neuer Parametertyp `text`, Glyphen-Atlas)
- [x] 3. Zeichnung & Grafik: `hatching`, `charcoal`, `blueprint`, `stipple` (Browser-CPU)
- [x] 4. Malerei & Druck: `pointillism`, `riso`, `alt-process`, `infrared`, `instant-film`
- [x] 5. Material, Geometrie, Licht: `paper`, `mosaic-glass`, `emboss-foil`, `kaleido`, `polar`, `god-rays`
- [x] 6. Malplan-Grundlagen: Datenmodell (Projektformat 7), Arbeitsbereich „Malplan“, Maltechnik, Untergrundformat in cm
      mit Presets und Zuschnitt, Vereinfachungsgrad (Formen, Farben), Analyse im Worker (Farbreduktion, Flächen)
- [x] 7. Werte- und Farb-Hilfen: Notan, Werteskizze, Wertskala, Warm-Kalt-Karte; PNG je Hilfe
- [x] 8. Übertragungshilfen: Proportionsraster (Vorlage und eigenes Blatt), Konturvorlage als Vektor
- [x] 9. Beamer-Modus (eigenes Fenster, Vollbild, Trapezkorrektur)
- [ ] 10. PDF-Malmappe (eigener PDF-Schreiber): Deckblatt, Werteskizze + Wertskala, Notan, Warm-Kalt, Raster,
      Konturvorlage gekachelt A4/A3 mit Überlappung und Passmarken; Seiten wählbar
- [ ] 11. Abnahme (Foto → druckbare Malmappe im korrekten Maßstab), Demo-Liste, Spec abhaken, CLAUDE.md
