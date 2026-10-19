# Abnahme Phase E3 – Tiefe, Semantik & Stil

Stand 19.10.2026 · Grundlage: [spec-effekte-und-malvorlagen.md](spec-effekte-und-malvorlagen.md) Abschnitte 4, 5 und 10,
Plan: [plan-E3.md](plan-E3.md), Entscheidungen: [DECISIONS.md](../DECISIONS.md) („E3: Analysekarten, Segmente, Stil“).
Gemessen auf der Referenz-Hardware (Apple M4 Pro, 48 GB, Chrome 155).

## Änderungsnotiz

- **Analysekarten aus Modellen** je Original: Tiefe (Depth Anything V2 Small), Normalen (auf der GPU aus der Tiefe),
  Salienz (U²-Net-p, neu im Register), Gesichter (MediaPipe-Landmarken). Sie werden automatisch berechnet, sobald ein Effekt
  oder eine Maske sie braucht, liegen außerhalb des Undo-Verlaufs und sind in der Ansicht „Analysekarte“ (Taste 5) zu sehen.
- **Segmente:** Markierung (Smarte Auswahl per Klick, Pinsel) oder Vordergrund als benanntes Segment; Effekt- und
  Gruppenmasken aus Segmenten, Salienz und Gesichtern; Ansicht „Segmente“.
- **Neue Effekte (13):** Neu beleuchten (Lichtquelle auf der Leinwand ziehen), Nebel nach Tiefe, Tiefenschärfe (Bokeh),
  Linolschnitt, Papierschnitt, Gouache (flach), Kreuzstich, Fließlinien, Eine Linie (TSP-Art), Stil übertragen
  (klassisch, kommerziell), Stil übertragen (KI/AdaIN, im Dienst, nur „Alle“), dazu **Stil je Bereich** (Dialog).
- **Punkt-Parameter** (Lichtquelle, Lichtstrahlen) haben einen ziehbaren Griff auf der Leinwand.
- **Parallax:** Bereichsebenen aus „Stil je Bereich“ bekommen ihre mittlere Tiefe; Tiefeneffekte, Tiefenebenen und
  Parallax nutzen dieselbe Tiefenkarte.
- Behoben: gespeicherte Masken von Markierungen fehlten in Projektdatei und Aufräumen (Phase 5); MediaPipe-WASM im Worker.

## Abnahmekriterium

> Person per Klick segmentieren, ihr einen anderen Stil geben als dem Hintergrund, Licht nachträglich verschieben,
> Ergebnis exportieren.

| Prüfung                                                                                                    | Ergebnis                                                                                                    | Nachweis               |
| ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ---------------------- |
| Person per Klick (Smarte Auswahl, Klick Gesicht + Klick Jacke), als Segment „Person“ gespeichert           | erfüllt: Gesicht und Jacke markiert, Straße und Wand nicht                                                  | `acceptanceE3.spec.ts` |
| Anderer Stil als der Hintergrund („Stil je Bereich“: Person Ölbild/Kuwahara, Hintergrund Linolschnitt)     | erfüllt: Hintergrund zu 80 % Druckfarbe/Papier, Person 16 %; Farbe der Jacke bleibt (Sättigung 0,35 → 0,27) | `acceptanceE3.spec.ts` |
| Licht nachträglich verschieben („Neu beleuchten“ auf der Gruppe, Griff von links oben nach rechts gezogen) | erfüllt: rechte Gesichtshälfte 88 → 107, linke dunkler; Tiefenkarte automatisch berechnet                   | `acceptanceE3.spec.ts` |
| Ergebnis exportieren (Export-Dialog, PNG, volle Auflösung 1600 × 1067)                                     | erfüllt: Datei = gerendertes Ergebnis (±2 Stufen)                                                           | `acceptanceE3.spec.ts` |

Weitere Nachweise: `analysisMaps.spec.ts` (Karten, Undo, Gesichtermaske), `segments.spec.ts`, `styleRegions.spec.ts`
(Parallax-Tiefe), `effectsE3.spec.ts` (Lichtgriff, Stil klassisch, AdaIN im Test-Dienst), Golden-Fälle aller neuen
Effekte in `effectCases.ts`, Dienst-Tests `test_style_transfer.py`.

## Messwerte

| Messung                                                           | Wert                            |
| ----------------------------------------------------------------- | ------------------------------- |
| Smarte Auswahl, 2 Klicks inkl. Modell laden                       | 1,5 s                           |
| Tiefenkarte (automatisch, Browser)                                | 0,9 s                           |
| Export PNG 1600 × 1067 mit Kuwahara, Linolschnitt, Neu beleuchten | 0,7 s                           |
| AdaIN 384 × 256 im Dienst (MPS)                                   | 1,3 s (erster Aufruf mit Laden) |

## Demo-Liste

1. Straßenporträt öffnen, W drücken, auf das Gesicht und die Jacke klicken.
2. Inspektor → „Segmente“: Name „Person“, „Markierung speichern“.
3. „Stil je Bereich …“: Person → „Kuwahara-Ölbild“, Hintergrund → „Linolschnitt“, Anwenden.
4. Gruppe „Stil je Bereich“ auswählen, Effekt „Neu beleuchten“ hinzufügen; die Sonne auf der Leinwand ziehen.
5. Taste 5 → Karte „Normalen“, „Salienz“, „Gesichter“ oder „Segmente“ ansehen.
6. Parallax (P): Person und Hintergrund verschieben sich gegeneinander.
7. Modus „Alle“ (Einstellungen), Modell „AdaIN“ im Dialog „Modelle“ laden, Effekt „Stil übertragen (KI)“ mit einem
   gemeinfreien Gemälde als Stilbild.
8. Exportieren (⌘E).

## Bekannte Grenzen

- Analysekarten nutzen immer Depth Anything Small; die große NC-Fassung nur über den Dialog „Tiefenebenen“.
- Salienz kommt aus 320 × 320 (U²-Net-p) – eine weiche Karte, keine genauen Kanten.
- „Stil übertragen (KI)“ braucht den Dienst und die AdaIN-Gewichte (nur nicht-kommerziell). Der klassische Stilübertrag
  übernimmt Farben und Oberflächenstruktur, malt aber keine neuen Pinselstriche.
- „Stil je Bereich“ legt die Bereiche einmalig als Ebenen an; geänderte Segmente wirken nicht nachträglich auf sie.
- Gruppen-Effekte nutzen die Analysekarten der ersten sichtbaren Ebene der Gruppe.
