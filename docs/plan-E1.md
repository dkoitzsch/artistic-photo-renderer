# Plan Phase E1 – Fundament & erste Effekte

Grundlage: [spec-effekte-und-malvorlagen.md](spec-effekte-und-malvorlagen.md), Entscheidungen vom 17.10.2026 in
[DECISIONS.md](../DECISIONS.md). Jeder Schritt endet lauffähig, mit grünen Tests, Commit und Push auf `main`.

- [x] 1. Testgrundlage: Architektur-Testbild (CC0), Golden-Helfer für Effekte (Parameter, Seed, Toleranz, NaN/Rand-Prüfung),
      `LICENSES-THIRD-PARTY.md`
- [x] 2. Manifest v2: `implementations`, `license`, `cost`, `randomized`, `requires`, Parameter-`group`, Typen `seed`,
      `palette`, `image`; Bestandseffekte migriert
- [x] 3. Maske und Mischmodus je Effekt (Projektformat 5, Migration)
- [x] 4. Seed: Würfel-Knopf, Zufall nach Leinwandposition (kachel- und vorschaustabil)
- [x] 5. Presets: eigene Presets mit Vorschaubild, Stapel-Presets (OPFS, Export/Import), ≥ 2 Presets je Effekt
- [x] 6. Analysekarten `luminance`, `edges` im Browser; Effekt-Eingang über `requires`; Ansicht „Analysekarte“; Karte als
      Effektmaske
- [x] 6a. Gruppen (Spec-Ergänzung 2.2a): eigene Maske auf Gruppen (Ebenenmaske oder Kartenbereich des
      Gruppenergebnisses), Kartenmasken für Effekte auf Gruppen, Oberfläche, Tests
- [x] 7. Dienst: Effekt-Registry (gleiche Manifeste + `effect.py`), `PUT /images/{sha}`, `POST /effects/{id}/render`,
      `GET`/`DELETE /jobs/{id}`, Hash-Cache, Lizenzprüfung
- [x] 8. Asynchrone Effekte im Browser (Ausführungsorte „python“ und „browser-cpu“), Job-Anzeige mit Abbruch,
      „Vollauflösung rendern“, Export wartet
- [ ] 9. Effekte: `rgb-split`, `pixelate`, `film-grain`, `bloom`, `tilt-shift`, `posterize-palette`
- [ ] 10. Effekte: `ink-lines`, `comic`, `halftone-cmyk`
- [ ] 11. Effekt: `kuwahara` (anisotrop)
- [ ] 12. Effekte: `dither`, `pixel-sort`, `low-poly`
- [ ] 13. Effekt: `double-exposure`
- [ ] 14. PSD: Option „Effekte als eigene Ebenen“; Gruppen (auch mit Effekten) als Ebenengruppen mit Gruppenmaske
- [ ] 15. Effekt-Browser: Kennzeichen (Kosten, Lizenz, Karten), Ausschnitt-Vorschau, Sperre im kommerziellen Modus,
      Gruppe „Erweitert“
- [ ] 16. Ausschnitt in voller Auflösung beim Hineinzoomen
- [ ] 17. Abnahme (3 Effekte auf maskierten Ebenen, PSD + PNG in voller Auflösung, 24 MP), Demo-Liste, Optimierungs-Dokument
