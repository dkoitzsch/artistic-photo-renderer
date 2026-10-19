# Plan Phase E5 – Simulationen & Experimente

Grundlage: [spec-effekte-und-malvorlagen.md](spec-effekte-und-malvorlagen.md) Abschnitte 5.3, 5.9 und 10 (Phase E5),
Entscheidungen in [DECISIONS.md](../DECISIONS.md) („E5: Simulationen“). Freigabe durch den Nutzer am 19.10.2026.
Jeder Schritt endet lauffähig, mit grünen Tests, aktueller `PROGRESS.md`, Commit und Push auf `main`.

- [x] 0. Plan, Entscheidungen, PROGRESS.md
- [x] 1. `reaction-diffusion` (Gray-Scott, Steuerkarte) und `crystal-growth` (dendritisches Wachstum von Kanten aus) –
      GPU, auf einem festen Simulationsraster
- [x] 2. `erosion` (Höhenfeld aus Helligkeit/Tiefe, Regen trägt ab, Farbe wird mitgetragen) und `chemical` (Rost,
      Bleiche, Solarisation; Wachstum von Kanten, Dunkel oder Tiefe aus)
- [x] 3. `aging` (Craquelé nach Schichtdicke, Firnis, Ausbleichen) und `memory` (Verblassen, Verschwimmen, Auflösen;
      Gesichter und Salientes bleiben)
- [x] 4. `cubist` (Mehrperspektive über die Tiefe, Fragmente wie Joiner, Lückenfüllung)
- [x] 5. `watercolor-sim` (Aquarell nach Curtis et al. 1997, vereinfacht: Lasuren, Wasserfluss, Randverdunkelung,
      Blüten, Granulation; Mischung mit der Pigment-Engine)
- [ ] 6. 24 MP: Simulationsraster + volle Auflösung für Details, Messungen, Abnahme (alle Simulationseffekte mit
      Standard-Presets auf den Testbildern, Endrender 24 MP), Spec abhaken, CLAUDE.md
