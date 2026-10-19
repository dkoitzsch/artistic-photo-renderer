# Plan Phase E3 – Tiefe, Semantik & Stil

Grundlage: [spec-effekte-und-malvorlagen.md](spec-effekte-und-malvorlagen.md) Abschnitte 4, 5 und 10 (Phase E3),
Entscheidungen in [DECISIONS.md](../DECISIONS.md) („E3: Analysekarten, Segmente, Stil“). Freigabe durch den Nutzer am
18.10.2026 („Phase 5 und dann E3 umsetzen“). Nach jedem Schritt: Tests, PROGRESS.md, Commit, Push.

- [x] 0. Plan, Entscheidungen, Modelle prüfen und eintragen (U²-Net-p für Salienz, AdaIN für Style-Transfer)
- [x] 1. Analysekarten `depth`, `normals`, `saliency`, `faces`: je Original berechnet (Modell nach Lizenzmodus),
      gespeichert (Projektformat 9), außerhalb des Undo-Verlaufs; automatisch, sobald ein Effekt oder eine Maske sie
      braucht; `normals` auf der GPU aus der Tiefe; Effekt-Bindungen 12/13; Ansicht „Analysekarte“ für alle Karten
- [x] 2. Segmente (`segmentation`): Markierung (Smarte Auswahl per Klick, Pinsel) als benanntes Segment speichern,
      Segmentliste, „Vordergrund als Segment“; Effekt- und Gruppenmasken aus Segmenten und aus Karten (Salienz,
      Gesichter); Ansicht der Segmente
- [x] 3. Licht & Tiefe: `relight` (Lichtquelle auf der Leinwand ziehen – allgemeiner Griff für Punkt-Parameter),
      `depth-fog`, `depth-bokeh`
- [x] 4. Grafik auf der GPU: `linocut`, `cut-paper`
- [x] 5. CPU-Effekte: `gouache-flat`, `textile`, `flow-lines`, `tsp-art`
- [x] 6. Stil: Zweitbild auch für Worker-/Dienst-Effekte; `style-transfer` (AdaIN im Dienst, nur Modus „Alle“) und
      `style-match` (klassische Stilübertragung, kommerziell); Hinweis zu Stilbildern
- [ ] 7. `style-per-region` („Stil je Bereich“: Region → Effektstapel über das Ebenensystem); Abstimmung mit der
      Parallax-Vorschau (gleiche Tiefenkarte, Tiefe der Bereichsebenen)
- [ ] 8. Abnahme (Person per Klick segmentieren, anderer Stil als der Hintergrund, Licht verschieben, exportieren),
      Spec abhaken, CLAUDE.md
