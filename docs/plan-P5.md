# Plan Phase 5 – Pinsel (Basis-Spec g)

Grundlage: [SPEC-artistic-photo-renderer.md](../SPEC-artistic-photo-renderer.md) Abschnitte „Masken-Pinsel (g)“ und
„Phase 5“, Entscheidungen in [DECISIONS.md](../DECISIONS.md) („Phase 5: Pinsel und Smarte Auswahl“). Freigabe durch den
Nutzer am 18.10.2026 („Phase 5 und dann E3 umsetzen“). Push nach Abschluss der Phase.

- [x] 0. Plan, Entscheidungen, PROGRESS.md
- [x] 1. Datenmodell (Projektformat 8): Pinselstriche als Vektordaten auf Maske, Markierung und Fokuskarte; Maskenart
      `empty`; Rasterisierung der Striche auf der GPU (Tupfer mit Weichheit, Fluss, Druck), im Ebenenraum gecacht
- [ ] 2. Pinsel-Werkzeug (B): Ziel Markierung/Maske/Fokuskarte, Größe 1–800 px ([ ]), Weichheit, Fluss,
      Hinzufügen/Entfernen (Alt), Glättung, Stiftdruck; Farbschleier (Farbe, ~40 %), Pinselkreis
- [ ] 3. Smarte Auswahl (SAM 2.1 tiny im Browser): Positiv-/Negativ-Klicks, Ergebnis als Markierung, danach mit dem
      Pinsel verfeinern; Modell im Register und in MODELS.md
- [ ] 4. Aktionen: Hervorheben (neue Ebene darüber, optional Lochfüllung im Quell-Layer), Extrahieren, Markierung
      löschen/umkehren, „Layer auf Original zurücksetzen“
- [ ] 5. Abnahme (Hand markieren → hervorheben → schärfer → per Undo vollständig zurück), Spec abhaken, CLAUDE.md
