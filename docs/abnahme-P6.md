# Abnahme Phase 6 – Ausbau (Basis-Spec)

Stand 07.11.2026 · Grundlage: [SPEC-artistic-photo-renderer.md](../SPEC-artistic-photo-renderer.md) „Phase 6 – Ausbau“,
Entscheidungen: [DECISIONS.md](../DECISIONS.md) („Phase 6“). Gemessen auf der Referenz-Hardware (Apple M4 Pro, 48 GB, Chrome 155).

## Änderungsnotiz

- **Effekte:** Neu ist der **Echo-Versatz** (`echo-offset`: bis zu 16 versetzte, abklingende Echos mit Richtung, Farbton- und
  Größenversatz je Echo; Überlagerung Aufhellen, Negativ multiplizieren, Mittelwert, hinter dem Original). Die weiteren
  genannten Effekte gab es schon seit E1: **Doppelbelichtung** (`double-exposure`), **Korn und Halation** (`film-grain`,
  „Filmkorn & Halation“; zusätzlich `bloom`).
- **SAM-Objektaufteilung (Modus 3):** Im Aufteilen-Dialog „Objekte (automatisch, SAM)“. Ein Raster von Punktaufforderungen
  ergibt je drei Maskenkandidaten; Güte-, Stabilitäts- und Flächenfilter, Unterdrückung ähnlicher Masken und eine
  Etikettenkarte ohne Überlappung (große Objekte zuerst) liefern die Objekte. Ergebnis: Gruppe **„Objekte“** mit dem
  ausgeblendeten Original, dem **Hintergrund** (Lochfüllung) und **einer Ebene je Objekt**. Im Dienst läuft
  **SAM 2.1 Large** (`POST /segment/objects`), sonst **SAM 2.1 Tiny im Browser** (8 × 8 Punkte, dieselben Regeln).
- **LaMa-Inpainting:** `POST /inpaint` im Dienst (LaMa, ONNX über onnxruntime, Apache-2.0). Im Inspektor einer Ebene mit
  Lochfüllung: **„Mit LaMa auffüllen (KI)“**; „Schnelle Füllung“ geht zurück zur Füllung aus der Umgebung. Das Ergebnis liegt
  als Original im Projekt (Projektformat **10**, `Layer.inpaint`) und gilt nur im Lochbereich; außerhalb bleibt das Bild
  pixelgleich.

## Prüfung

Die Spec nennt für Phase 6 keine eigenen Abnahmekriterien; geprüft wurde je Punkt:

| Prüfung                                                                                                             | Ergebnis                                                        | Nachweis                                               |
| ------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------ |
| Echo-Versatz: 3 Golden-Fälle (Zeitspur, Mehrfachbelichtung, Farbiges Echo), Kachelgleichheit ±1                     | erfüllt                                                         | `effectCases.ts`, `tests/golden/effects/echo-offset-*` |
| Objekte im Browser: Szene mit zwei Flächen → ≥ 2 Objekte, Gruppe „Objekte“, Summe der Ebenen ≈ Original, Rückgängig | erfüllt: 3 Objekte, mittlere Abweichung zum Original < 8 Stufen | `objectsSam.spec.ts`                                   |
| Objekte im Dienst (Tiny-Gewichte unter der Kennung `sam2.1-large`)                                                  | erfüllt: ≥ 2 Objekte, Herkunft `sam2.1-large`                   | `objectsSam.spec.ts`, `test_objects.py`                |
| Auswahlregeln (Güte, Stabilität, Duplikate, Verdeckung, Höchstzahl) in Python und TypeScript                        | erfüllt                                                         | `test_objects.py`, `objectsSelect.test.ts`             |
| LaMa im Dienst mit dem echten Modell: Loch wird plausibel gefüllt, Rest bleibt unverändert                          | erfüllt                                                         | `test_inpaint.py`                                      |
| LaMa in der App: Hintergrund-Loch gefüllt, Rest unverändert (< 0,5 Stufen), Kacheln gleich, Rückgängig pixelgleich  | erfüllt                                                         | `inpaintLama.spec.ts`                                  |
| Lizenz- und Fehlerfälle der Endpunkte (unbekanntes Modell, NC-Sperre), Maskenformat 8/16 Bit                        | erfüllt                                                         | `test_inpaint.py`, `test_objects.py`                   |
| Projektformat 10: Lochfüllung wird gespeichert, geprüft (fehlendes Original, fehlende Herkunft) und von 9 migriert  | erfüllt                                                         | `project.test.ts`                                      |
| Oberfläche: Modus „Objekte“, LaMa-Knopf gesperrt ohne Dienst (mit Begründung)                                       | erfüllt                                                         | `phase6.spec.ts`                                       |

## Messwerte

| Messung                                                                       | Wert                                            |
| ----------------------------------------------------------------------------- | ----------------------------------------------- |
| LaMa im Dienst (CPU), Bild 1024 × 683, Loch 250 × 220 px                      | 1,1 s                                           |
| Objekte im Browser (SAM Tiny, 8 × 8 Punkte, Bild 384 × 256, Modell im Cache)  | 1,6 s                                           |
| Objekte im Dienst (SAM Tiny als Ersatz, CPU, 16 × 16 Punkte, Bild 1024 × 683) | 2,3 s                                           |
| SAM 2.1 Large im Dienst                                                       | nicht gemessen (898 MB, nur auf Wunsch geladen) |

## Demo-Liste

1. Foto öffnen → Ebene → „Aufteilen“ → „Objekte (automatisch, SAM)“ → Anzahl wählen → „Objekte suchen“.
2. In der Gruppe „Objekte“ jedes Objekt einzeln weichzeichnen, färben oder ausblenden; der Hintergrund füllt das Loch.
3. Dienst starten (`npm run dev`), im Dialog „Modelle“ **LaMa** herunterladen (208 MB).
4. Hintergrund-Ebene wählen (Lochfüllung an) → **„Mit LaMa auffüllen (KI)“**; vorher/nachher vergleichen, „Schnelle Füllung“.
5. Effekt „Echo-Versatz“ mit den Presets „Zeitspur“ und „Mehrfachbelichtung“.

## Bekannte Grenzen

- LaMa rechnet fest mit 512 × 512 px je Lochbereich (Ausschnitt um das Loch samt Umgebung); große Löcher werden dadurch
  weicher als die Umgebung. An den Dienst gehen höchstens 1024 px; im Lochbereich wird das Ergebnis hochskaliert.
- Mehrere weit auseinanderliegende Löcher werden einzeln gefüllt (höchstens 6 Bereiche).
- Die Objekt-Aufteilung findet nur, was SAM mit einem Punktraster trennt; kleine oder teilweise verdeckte Objekte fehlen,
  Personen werden oft als ein Objekt erfasst. Im Browser (Tiny) ist die Qualität geringer als im Dienst (Large).
- SAM 2.1 Large läuft im Dienst auf der CPU (Apple-GPU mit `BLS_SAM_DEVICE=mps`, ungetestet).
- Tiefenebenen „objekttreu“ (Objekte quer durch Tiefenbänder zusammenhalten) bleibt offen.
