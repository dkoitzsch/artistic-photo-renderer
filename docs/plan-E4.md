# Plan Phase E4 – Pigmente, Striche & Malplan komplett

Grundlage: [spec-effekte-und-malvorlagen.md](spec-effekte-und-malvorlagen.md) Abschnitte 5.3, 5.9, 6, 7 und 10,
Entscheidungen in [DECISIONS.md](../DECISIONS.md) („E4: Pigmente, Striche, Malplan“). Freigabe durch den Nutzer am
19.10.2026. Jeder Schritt endet lauffähig, mit grünen Tests, aktueller `PROGRESS.md`, Commit und Push auf `main`.

- [x] 0. Plan, Entscheidungen, PROGRESS.md
- [ ] 1. Pigment-Engine (`src/pigments/`): Pigmentdatenbank (JSON, ~26 Künstlerpigmente mit Colour-Index, Deckkraft,
      Lichtechtheit, Granulation), Spektren mit 31 Stützstellen (400–700 nm) aus Vollton- und Aufhellungsfarbe,
      Kubelka-Munk mit zwei Konstanten, `mix`, `findMix` (bis 3 Pigmente + Weiß), ΔE2000; Unit-Tests nach 6.3
- [ ] 2. „Meine Farben“ (Auswahl im Malplan, Profile speicherbar), reduzierte Palette nur aus mischbaren Tönen,
      Mischrezepte (Teile, Farbfeld Soll/Mischung, ΔE), Farbfeld-Karte (nummerierte Flächen)
- [ ] 3. Kanten-Karte (hart/weich/verloren aus Kontrast und Gradientenbreite, Schwellwerte einstellbar)
- [ ] 4. Effekte `stroke-paint` (Hertzmann 1998, Striche als Daten), `impasto`, `saliency-abstraction`
- [ ] 5. Schichtplan (4–8 Schritte je Maltechnik, neu + kumuliert) und Strichführung (aus `stroke-paint` bzw. `flow`,
      Pinselbreite in mm)
- [ ] 6. PDF-Malmappe vollständig (Palette mit Rezepten, Farbfeld-Karte, Kanten-Karte, Schichtplan, Strichführung),
      einzelne Hilfen als PNG
- [ ] 7. Abnahme (10 eigene Farben → vollständige Malmappe mit Mischrezepten, Kanten-Karte und Schichtplan), Spec
      abhaken, CLAUDE.md
