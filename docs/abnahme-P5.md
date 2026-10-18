# Abnahme Phase 5 – Pinsel (Basis-Spec g)

Stand 18.10.2026 · Grundlage: [SPEC-artistic-photo-renderer.md](../SPEC-artistic-photo-renderer.md) „Masken-Pinsel (g)“,
Plan: [plan-P5.md](plan-P5.md), Entscheidungen: [DECISIONS.md](../DECISIONS.md) („Phase 5: Pinsel und Smarte Auswahl“).
Gemessen auf der Referenz-Hardware (Apple M4 Pro, 48 GB, Chrome 155).

## Änderungsnotiz

- **Pinsel (B)** auf drei Ziele: _Markierung_ (Farbschleier, Farbe und Deckkraft wählbar), _Maske_ (verfeinert die
  Ebenenmaske) und _Fokuskarte_ (schärfer/unschärfer malen). Größe 1–800 px mit [ und ], Kantenweichheit, Fluss
  (Aufbau bei mehrfachem Malen), Glättung, Stiftdruck (Pointer Events), Alt = Gegenmodus, Pinselkreis.
- **Striche als Vektordaten** im Projekt (Projektformat 8), auf der GPU als weiche Tupfer gerastert – winzige Dateien,
  Undo je Pinselzug, Export in voller Auflösung ohne Treppen.
- **Smarte Auswahl (W):** SAM 2.1 Hiera Tiny (Apache-2.0) im Browser. Klick = gehört dazu, Alt-Klick = gehört nicht dazu,
  ⇧-Klick = neues Objekt. Danach mit dem Pinsel verfeinern.
- **Aktionen:** _Hervorheben_ (Markierung als neue Ebene direkt über der Quelle, ohne Effekte; optional Lochfüllung in
  der Quelle), _Extrahieren_ (Ebene behält nur die Markierung), _Auf Original zurücksetzen_ (Inspektor).

## Abnahmekriterium

> Hand markieren, als eigenen Layer hervorheben, schärfer stellen; danach per Undo vollständig zurück.

| Prüfung                                                                                                        | Ergebnis                                                                              | Nachweis               |
| -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ---------------------- |
| Porträt mit Gauß 40 px; Hand per Smarter Auswahl (Klick + 2 Alt-Klicks) und Pinselstrich (Handgelenk) markiert | erfüllt: Hand und Handgelenk markiert, Auge und Hintergrund nicht                     | `acceptanceP5.spec.ts` |
| Hervorheben: neue Ebene über der Quelle, ohne Unschärfe                                                        | erfüllt: Schärfe im Handbereich 1591 (Original) → 2 (unscharf) → 1345 (hervorgehoben) | `acceptanceP5.spec.ts` |
| Rest bleibt unscharf                                                                                           | erfüllt: Augenbereich weicht im Mittel < 0,5 Stufen ab                                | `acceptanceP5.spec.ts` |
| Undo vollständig zurück                                                                                        | erfüllt: 7 Schritte, Bild pixelgleich zum Ausgangszustand                             | `acceptanceP5.spec.ts` |

## Messwerte

| Messung                                                    | Wert  |
| ---------------------------------------------------------- | ----- |
| Smarte Auswahl, erster Klick (Modell laden + Bildmerkmale) | 1,3 s |
| Smarte Auswahl, jeder weitere Klick                        | 0,2 s |

## Demo-Liste

1. Porträt öffnen, Gauß-Blur auf die Ebene, Stärke 40.
2. W drücken, auf die Hand klicken; falls das Gesicht mitkommt: Alt-Klick ins Gesicht.
3. B drücken, „Malen auf: Markierung“, fehlende Stellen dazumalen (Alt = wegnehmen), Größe mit [ und ].
4. „Hervorheben“ – die Hand liegt als eigene, scharfe Ebene über dem unscharfen Bild.
5. Pinsel auf „Fokuskarte“: auf dem unscharfen Bild „schärfer“ malen (Gauß mit Fokus-Unschärfe 0 %).
6. ⌘Z bis zum Anfang.

## Bekannte Grenzen

- SAM erfasst bei einem Klick oft das ganze Objekt (z. B. die Person statt der Hand); Alt-Klicks und der Pinsel grenzen
  ein. Die Maske kommt aus 256 × 256 und wird kantenbewusst hochskaliert; feine Ränder ggf. mit dem Pinsel nacharbeiten.
- „Markierung umkehren“ gibt es noch nicht (Alles markieren + Entfernen-Pinsel als Ersatz).
