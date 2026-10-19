# Entscheidungen

Abweichungen von der Spec und Festlegungen bei unklaren Anforderungen. Neueste oben.

<!-- Vorlage
## JJJJ-MM-TT – Kurztitel
- **Frage:**
- **Entscheidung:**
- **Begründung:**
- **Betrifft:** (Spec-Abschnitt / Phase)
-->

## 2026-10-19 – E5: Simulationen

- **Simulationsraster:** Iterative Simulationen (Reaktions-Diffusion, Kristallwachstum, Erosion, Ausbreitung chemischer
  Prozesse, Aquarell) rechnen auf einem festen Raster über der ganzen Leinwand (lange Kante einstellbar, Standard
  1024–1536 Zellen), unabhängig von Vorschau- oder Exportauflösung. Das Ergebnis wird auf die Ausgabe hochskaliert und
  dort mit ortsfestem Detail in voller Auflösung verbunden (Papier, Körnung, Kantenschärfe aus dem Original). Folge:
  Vorschau und Export zeigen dieselbe Simulation, ein 24-MP-Endrender kostet nur das Hochskalieren. Die Effekte geben
  als Reichweite die ganze Leinwand an und werden im Export am Stück gerendert (wie die globalen Effekte aus E2).
- **Ausführungsorte:** alle Simulationen auf der GPU (WebGPU, viele Durchgänge je Effekt), außer `watercolor-sim` im
  Browser-Worker: Es nutzt die Pigment-Engine (Rezepte je Lasur, Kubelka-Munk-Schichten mit 31 Stützstellen, Granulation
  aus der Pigmentdatenbank). Kein Effekt braucht den Python-Dienst.
- **Aquarell vereinfacht:** statt der vollständigen Flachwasser-Simulation von Curtis et al. werden Lasuren je Farbfläche
  (hell → dunkel) mit Wasserausbreitung (Diffusion im nassen Bereich), Randverdunkelung beim Trocknen, Blüten
  (Backruns), Nass-in-Nass-Verlauf und Granulation auf der Papierstruktur gerechnet.
- **Kubistisch:** Neuprojektion als Rückwärts-Verschiebung nach der Tiefe je Blickwinkel; Lückenfüllung mit
  geglättetem Bild („Inpainting“ vereinfacht), Farbfläche oder offen.
- **Betrifft:** Effekte `reaction-diffusion`, `crystal-growth`, `erosion`, `chemical`, `aging`, `memory`, `cubist`,
  `watercolor-sim`

## 2026-10-19 – E4: Pigmente, Striche, Malplan

- **Pigmentdaten (13.5):** eigene Näherungsdaten je Pigment – Vollton- und Aufhellungsfarbe (1 Teil Pigment : 4 Teile
  Titanweiß) in sRGB. Daraus werden glatte Reflexionsspektren mit 31 Stützstellen (400–700 nm) rekonstruiert
  (geringste Krümmung unter der Bedingung, dass das Spektrum unter D65 genau die Farbe ergibt; Verfahren nach Burns),
  und je Wellenlänge K und S des Pigments bestimmt (Zwei-Konstanten-Kubelka-Munk mit Titanweiß als Bezug, S_Weiß = 1).
  Mischungen: K und S anteilig, R aus K/S, Saunderson-Korrektur für die Oberfläche. Die Werte sind Näherungen; die UI
  sagt das. CIE-1931-2°-Normspektralwerte und D65 (10-nm-Tabellen) als Konstanten im Code.
- **Rezeptsuche:** erschöpfend über alle Kombinationen aus 1–3 Pigmenten der Auswahl (grobes Mengengitter), danach
  Verfeinerung der besten Kandidaten; Weiß aus der Auswahl darf zusätzlich beigemischt werden. Bewertet mit ΔE2000.
  Teile werden auf kleine ganze Zahlen gerundet („2 Teile … + 1 Teil … + etwas …“ unter 10 %).
- **„Meine Farben“:** Auswahl im Projekt (`malplan.myColors`, Projektdatei), Profile zusätzlich im Browser-Speicher.
- **`stroke-paint`:** Striche sind reproduzierbare Daten (Seed, Parameter, Bild): der Strichgenerator ist ein reines Modul
  (`effects/stroke-paint/strokes.ts`), das Effekt und Malplan gemeinsam nutzen; der Malplan rechnet die Striche für den
  Zuschnitt neu statt sie als großen Datenblock im Projekt zu speichern. Export der Strichdaten als JSON möglich.
- **Kanten-Karte:** je Grenzpixel zwischen zwei Malplan-Flächen Kontrast (ΔL der Flächen) und Breite des Übergangs im
  geglätteten Bild (Kontrast / größter Gradient in px): verloren = Kontrast unter Schwelle, hart = schmaler Übergang,
  sonst weich.
- **Schichtplan:** Schritte je Maltechnik aus Flächen, Tonwerten und Flächengröße (Öl/Acryl dunkel → hell, Aquarell
  hell → dunkel, Bleistift/Kohle Formen → Massen → Details); jeder Schritt zeigt Neues hervorgehoben und den Stand.
- **Betrifft:** Pigment-Engine, Malplan, Effekte, PDF

## 2026-10-18 – E3: Analysekarten, Segmente, Stil

- **Modelle (Spec 13.3, an der Quelle geprüft 18.10.2026):**
  - `depth`: Depth Anything V2 Small (Apache-2.0, Browser und Dienst) – automatisch berechnete Analysekarten nutzen immer
    Small. Large (CC BY-NC 4.0, Dienst) bleibt über den Dialog „Tiefenebenen“ wählbar; deren Tiefenkarte hat Vorrang.
  - `saliency`: **U²-Net-p** (xuebinqin/U-2-Net, Code und Gewichte Apache-2.0; ONNX aus der rembg-Veröffentlichung, MIT),
    4,6 MB, im Browser. Das volle U²-Net (176 MB) bringt für eine weiche Aufmerksamkeitskarte keinen sichtbaren Gewinn.
  - `faces`: MediaPipe Face Landmarker (Apache-2.0, vorhanden) – Gesichtsfläche = Hülle der Landmarken, weich gezeichnet.
  - `segmentation`: SAM 2.1 Tiny (vorhanden) per Klick, dazu der Vordergrund aus BiRefNet/RMBG (Lizenzmodus wie bisher).
  - `style-transfer`: **AdaIN** (Huang & Belongie 2017; PyTorch-Gewichte naoto0804/pytorch-AdaIN, Code MIT). Für die
    Gewichte (Decoder, normalisiertes VGG-19) ist keine Lizenz angegeben, der Decoder wurde mit WikiArt-Bildern trainiert →
    **nur nicht-kommerziell** (Modus „Alle“), im Dienst (PyTorch/MPS). Kommerzieller Ersatz: eigener Effekt `style-match`
    (klassische Stilübertragung ohne Modell: Farbstatistik in Oklab und Detail-Statistik je Frequenzband einer
    Laplace-Pyramide, nach Heeger & Bergen 1995 / Reinhard 2001), Browser-CPU.
- **Analysekarten je Original, nicht im Verlauf:** Karten sind abgeleitete Daten eines Originals (wie ein Cache), keine
  Bearbeitung. Sie liegen in `Project.analysis[originalId]` (Projektformat 9) und werden in **alle** Verlaufseinträge
  geschrieben – Undo entfernt sie nicht, ein erneutes Berechnen nach Undo entfällt. Berechnet wird automatisch, sobald ein
  sichtbarer Effekt (`requires`) oder eine Effekt-/Gruppenmaske eine fehlende Karte braucht; bis dahin bekommt der Effekt
  eine neutrale Karte. Eine Karte aus einem NC-Modell zählt für die Exportwarnung wie eine NC-Maske und wird im Modus
  „Kommerziell“ durch eine kommerzielle ersetzt. Die Tiefenkarte einer Ebene (`Layer.depthMap`, Tiefenebenen) hat Vorrang
  vor der Analysekarte des Originals – Tiefenebenen, Parallax und Tiefeneffekte nutzen dieselbe Karte.
- **`normals`** aus der Tiefe auf der GPU (geglätteter Gradient, Ebenenraum, gecacht); Bindung 12 `map_normals`
  (xyz Normale, w = 1 gültig), Bindung 13 `map_semantic` (r Salienz, g Gesichter). Segmente sind keine Bindung, sondern
  Masken (Effektmaske, Ebenenmaske über „Stil je Bereich“).
- **Segmente** (`Project.segments`, im Verlauf): benannte Masken eines Originals (Grundmaske + Pinselstriche wie die
  Markierung). Effekt- und Gruppenmasken bekommen die Art `segment` (mit Umkehren).
- **`style-per-region` ist kein Plugin**, sondern ein Befehl „Stil je Bereich“: Er baut aus einer Ebene eine Gruppe mit einer
  Ebene je Bereich (Rest/Hintergrund unten, dann Segmente oder Tiefenbereiche als Ebenenmasken) und gibt jeder Ebene den
  gewählten Effekt bzw. das gewählte Stapel-Preset. Grund: Ein Plugin kann keine Effektstapel enthalten; über Ebenen bleiben
  Stapel, Masken, PSD-Export (Ebenen) und Parallax (Tiefe je Bereichsebene) ohne Sonderfälle nutzbar.
- **Ausführungsorte:** `linocut`, `cut-paper`, `depth-bokeh` laufen auf der GPU (Spec: P bzw. B/P), `gouache-flat`,
  `textile`, `flow-lines`, `tsp-art` im Browser-Worker (Spec: P) – gemäß Grundsatz „Simulationen bevorzugt WebGPU,
  sequenzielle Verfahren auf der CPU“; der Dienst ist dafür nicht nötig. Nur `style-transfer` braucht den Dienst.
- **Punkt-Parameter ziehen:** Effekte mit Parametern vom Typ `point` (z. B. Lichtquelle von `relight`, `god-rays`) zeigen
  auf der Leinwand einen ziehbaren Griff, solange ihre Effektkarte aufgeklappt ist.
- **Betrifft:** Analysekarten, Effekte, Masken, Projektformat 9, Dienst (Downloads mit festen URLs + SHA-256)

## 2026-10-18 – Phase 5: Pinsel und Smarte Auswahl

- **Freigabe:** Der Nutzer hat Phase 5 und danach E3 am 18.10.2026 freigegeben.
- **Striche als Vektordaten (Abweichung vom Plan „Maskenversionen mit Kachel-Deltas“, Datenmodell/Phase 1):** Jeder
  Pinselstrich wird mit Punkten (Ebenen-px), Druck, Größe, Weichheit, Fluss und Modus im Projekt gespeichert und auf der
  GPU als Folge weicher Tupfer gerastert (Reihenfolge = Malreihenfolge). Vorteile: winzige Projektdateien, Undo über die
  bestehende History, auflösungsunabhängig, Export in voller Auflösung ohne Treppen. Gerastert wird im Ebenenraum und
  gecacht (Schlüssel aus den Strichen).
- **Drei Ziele des Pinsels:** _Markierung_ (je Ebene, Farbschleier; Grundlage für Hervorheben/Extrahieren), _Maske_
  (verfeinert die bestehende Ebenenmaske, Striche wirken nach dem Kantenübergang) und _Fokuskarte_ (schärfer = hinzufügen,
  unschärfer = entfernen, verrechnet mit den Fokuspunkten).
- **Neue Maskenart `empty`:** leere Grundmaske, z. B. für hervorgehobene Ebenen aus einer gemalten Markierung.
- **Smarte Auswahl:** SAM 2.1 Hiera Tiny (Meta, Apache-2.0; ONNX-Export onnx-community, fp16, 78 MB) im Browser über
  ONNX Runtime/WebGPU. Bild auf 1024 × 1024 gestreckt (wie das Preprocessing des Modells), Bildmerkmale je Original
  zwischengespeichert, Klicks (positiv/negativ, Alt = negativ) liefern eine 256er-Maske, die mit dem Guided Filter auf
  Maskenauflösung gebracht und als unveränderliche Maske gespeichert wird. Ergebnis ist die Grundlage der Markierung; der
  Pinsel verfeinert sie. Kommerziell nutzbar, daher in beiden Lizenzmodi.
- **Hervorheben:** neue Ebene direkt über der Quelle (gleiches Original und gleiche Transformation, Maske = Markierung,
  keine Effekte, damit sie scharf ist). Optional füllt die Quelle die markierte Stelle per Lochfüllung auf.
  **Extrahieren:** die Maske der Ebene wird zur Markierung (vorherige Maske bleibt für „Zurücksetzen“ erhalten).
- **Zurücksetzen:** jede Ebene merkt sich beim Anlegen ihren Ausgangszustand (Maske, Kantenübergang, Lochfüllung); fehlt
  er, gilt „ganze Fläche ohne Effekte“.
- **Betrifft:** Basis-Spec g, Datenmodell, Phase 5; Plan [docs/plan-P5.md](docs/plan-P5.md)

## 2026-10-17 – E2: Grundsatzentscheidungen

- **Freigabe:** Der Nutzer hat E2 am 17.10.2026 freigegeben („E2 umsetzen“). Laut Entscheidung „Reihenfolge“ (E1) folgt
  danach die alte Phase 5, dann E3.
- **Ausführungsorte (Abweichung von Spec 5):** Alle E2-Effekte laufen im Browser. Die mit „B/P“ markierten (`datamosh`,
  `hatching`, `charcoal`, `pointillism`, `mosaic-glass`) rechnen Vorschau **und** Endrender auf der GPU – kachelgenau, Vorschau
  und Export sind dasselbe Verfahren. `stipple` (Spec: P) läuft als Browser-CPU-Effekt im Web Worker. Begründung: auf der
  Referenz-Hardware schnell genug, ohne Dienst nutzbar, kein zweites Verfahren mit Abgleich. Eine Dienst-Fassung lässt sich
  über `implementations.final = "python"` jederzeit nachrüsten.
- **Analysekarte `flow`:** Richtungsfeld aus der Summe zweier geglätteter Strukturtensoren, J(σ = 6) + ¼ · J(σ = 24)
  (Original-px): nah an Kanten folgt die Richtung der Kante, in ruhigen Flächen setzt sich die großräumige Richtung fort.
  Kanal rg = Tangente, b = Kohärenz. Gleiches Verfahren auf der GPU, im Worker und im Dienst (Abgleich-Tests wie bei `edges`).
- **ASCII-Schrift:** Glyphen werden zur Laufzeit per Canvas 2D in einen Atlas gerendert (Kern-Hilfe `ctx.glyphs`), Schriften:
  die mitgelieferte Inter (OFL-1.1) und die System-Monospace. Gerenderte Bilder sind keine Schriftsoftware; keine Lizenzfrage.
  Neuer Parametertyp `text` (Zeichenkette, im Shader nur ihre Länge).
- **Globale Effekte** (`kaleido`, `polar`, `god-rays`, Wölbung bei `scanlines-crt`) lesen weit entfernte Pixel. Ihre
  Reichweite deckt die Leinwand; der Export rendert dann am Stück statt in Kacheln, der Ausschnitt in voller Auflösung
  entfällt bei zu großer Fläche.
- **Malplan:** Einstellungen im Projekt (`project.malplan`, Projektformat 7). Analyse im Web Worker auf dem gerenderten
  Ergebnis mit höchstens 1600 px langer Kante: Glättung, Farbreduktion (k-Means in Oklab, „Anzahl Farben“), Flächen
  (Zusammenhangskomponenten, Verschmelzen bis „Anzahl Formen“). Alle Hilfen leiten sich daraus ab. Konturen sind Vektoren
  (Flächengrenzen → Douglas-Peucker → Chaikin), damit die Vorlage in Originalgröße scharf druckt.
- **Maltechnik:** wird in E2 gespeichert und im PDF genannt; Schichtreihenfolge und technikabhängige Hilfen folgen mit dem
  Schichtplan (E4).
- **Beamer-Modus:** eigenes Fenster (aufs Projektor-Display ziehen, dort Vollbild), Bild per `postMessage`, Trapezkorrektur
  als Homographie (CSS `matrix3d`) über vier Eckgriffe; Ecken werden im Projekt gespeichert.
- **PDF:** eigener kleiner PDF-Schreiber (`src/io/pdf.ts`, PDF 1.4, Standardschrift Helvetica mit WinAnsi-Kodierung,
  Bilder JPEG/Flate, Vektorpfade). Verworfen: pdf-lib (seit 2021 ohne Pflege, viel ungenutzter Umfang), jsPDF (Größe).
  Einmalige unabhängige Prüfung mit pypdf über `uv run --with pypdf` (nicht installiert), wie psd-tools in Phase 3.
- **Betrifft:** Spec „Effekte“ 4, 5, 7, 10; Plan [docs/plan-E2.md](docs/plan-E2.md)

## 2026-10-17 – Ausschnitt in voller Auflösung beim Hineinzoomen (E1 Schritt 16)

- **Frage:** Die Vorschau hat höchstens 2048 px. Beim Hineinzoomen in große Bilder sieht man Vorschau-Pixel, und auflösungsabhängige
  Effekte (Raster, Striche, Pixel) wirken anders als im Export.
- **Entscheidung:** Sobald ein Geräte-Pixel kleiner als 1/1,25 Vorschau-Pixel ist und der sichtbare Bereich höchstens 8 MP
  umfasst, rendert die Engine nach 150 ms Ruhe den sichtbaren Bereich (plus 25 % Vorrat) in Leinwandauflösung. Das geschieht
  wie beim Export (Rand = Effekt-Reichweite, auf 64 px ausgerichtet), daher ist der Ausschnitt pixelgleich zum Export. Die
  Anzeige legt ihn über die Vorschau. Jede Änderung (Projekt, Vorher/Nachher, Verlassen des Bereichs) verwirft ihn sofort.
  Während man zieht, sieht man deshalb die Vorschau, und erst danach das Detail.
  Ausgenommen sind Projekte mit Worker- oder Dienst-Effekten, die auf dem ganzen Bild rechnen, und Parallax.
  Prüfansichten (Maske, Karten) liegen weiter in Vorschau-Auflösung darüber.
- **Begründung:** Dafür genügt ein einziger Render-Durchlauf ohne zweiten Cache-Pfad, und die Interaktion bleibt bei 60 fps.
- **Betrifft:** Spec „Effekte“ 2.4, Plan E1 Schritt 16.

## 2026-10-17 – E1: PSD-Export von Gruppen und Effekten

- **Gruppen** sind immer PSD-Ebenengruppen (Deckkraft, Mischmodus, Sichtbarkeit; Gruppenmaske als **aktive** Maske der
  PSD-Gruppe). Gruppen mit eigenen Effekten: die Kinder bleiben erhalten, aber **ausgeblendet**; darüber liegt das
  gerenderte Gruppenergebnis („<Gruppe> – <Effekte> (gerendert)“). So stimmt das Gesamtbild exakt (psd-tools-Gegenprobe:
  99 % der Pixel ≤ 1 Stufe), und die Kinder lassen sich in Photoshop weiterbearbeiten.
- **Option „Effekte als eigene Ebenen“:** jede Ebene mit Effekten wird eine PSD-Gruppe aus Basisebene (Ebenenmaske
  deaktiviert beigelegt) und je Effekt einer gerasterten Ebene (Name = Effektname; reines Effektergebnis auf seinem
  Eingang; Stärke → Deckkraft, Mischmodus → Mischmodus, Effektmaske → aktive Ebenenmaske). Gruppeneffekte ebenso als
  oberste Ebenen der Gruppe. In deckenden Bereichen entspricht das genau der Mischung der App; in halbtransparenten
  Bereichen legt Photoshop die Effekt-Ebene **über** ihren Eingang statt ihn zu ersetzen – dort kleine Abweichungen.
- **Namen** im Standardmodus unverändert (Ebenenname), damit bestehende Exporte gleich bleiben.
- Wirkbereich „Fokus-gewichtet“ eines Effekts wird in der Effekt-Ebene nicht als Maske abgebildet (selten; Hinweis).

## 2026-10-17 – E1: Asynchrone Effekte (Browser-CPU und Python-Dienst)

- **Ablauf:** Der Compositor bleibt synchron. Fehlt das Ergebnis eines Worker-/Dienst-Effekts, meldet er eine Anfrage mit
  einer Kopie seines Eingangs und reicht den Eingang durch. Nach dem Frame wird das Arbeitsformat (RGBA float16) roh
  ausgelesen und an Worker bzw. Dienst gegeben; das Ergebnis kommt als Textur in einen Cache (Budget 1,5 GB), die Vorschau
  rendert neu. Stärke, Wirkbereich, Effektmaske und Mischmodus wirken danach wie bei GPU-Effekten.
- **Export:** Enthält das Projekt solche Effekte, rendert der Export am Stück (ohne Kacheln, bis 24 MP) und wiederholt den
  Durchlauf, bis alle Ergebnisse vorliegen (eine Runde je verketteter asynchroner Effekt). Fehler/Abbruch beenden den
  Export mit Meldung. „Vollauflösung rendern“ in der unteren Leiste rechnet vorab.
- **Dienst:** Bild über SHA-256 adressiert und nur einmal hochgeladen; Ergebnis-Cache im Dienst über Hash aus Bild,
  Effekt, Version, Parametern und Lage. Zufall in Shader, Browser-CPU und Python bitgleich (PCG3D, Referenzwerte in Tests).
- **Tests:** eigener Testdienst auf Port 8766 (Test-Effekte, keine Modell-Downloads, eigener Cache), damit ein laufender
  Dev-Dienst auf 8765 nicht stört; im Dev-Server über `localStorage['bls.serviceUrl']` umschaltbar.

## 2026-10-17 – Spec-Ergänzung Gruppen (2.2a): Abgleich mit dem Bestand

- **Vorhanden:** Gruppen inkl. Verschachtelung, Gruppieren/Auflösen/Ziehen (Phase 3), Effekte auf Gruppen (wirken auf das
  zusammengeführte Ergebnis), Deckkraft und Mischmodus von Gruppen (Gruppen werden isoliert zusammengeführt).
- **Ergänzt in E1:** `Group.mask` (gleiche Maskenarten wie Effektmasken: Maske einer Ebene oder Bereich von Helligkeit/
  Kantenstärke/Tiefe – bei Gruppen aus dem zusammengeführten Ergebnis vor den Gruppeneffekten), Kartenmasken für Effekte
  auf Gruppen (aus dem Eingang des Effekts), PSD: Gruppen mit Effekten bleiben Ebenengruppen (Kinder + je Effekt eine
  gerasterte Ebene), Gruppenmaske als Maske der PSD-Gruppe.
- **Reihenfolge in der Gruppe:** zusammenführen → Gruppeneffekte → Gruppenmaske → Deckkraft/Mischmodus in die Elterngruppe.
- **Begriff:** Der „Gruppenmodus“ (Gruppe/Einzeln, Parameter an alle Kinder) bleibt davon unabhängig.

## 2026-10-17 – Erweiterung „Effekte & Malvorlagen“ (E1–E5): Grundsatzentscheidungen

Vom Nutzer freigegeben (alle Vorschläge aus der Analyse übernommen); Spec: `docs/spec-effekte-und-malvorlagen.md`.

- **Effekte als Filter (13.1):** Effekte bleiben ein nicht-destruktiver Filterstapel auf Ebenen und Gruppen; jeder Effekt
  erhält zusätzlich eigene Maske und eigenen Mischmodus. Einstellungsebenen („wirkt auf alles darunter“) erst bei Bedarf.
- **WebGPU (13.2):** keine WebGL2-Implementierungen.
- **Dritter Ausführungsort „Browser-CPU“:** globale/sequenzielle Effekte (Fehlerdiffusion, Pixel-Sort, Delaunay) laufen in
  einem Web Worker auf der ganzen Ebene statt in Kacheln; gemeinsamer asynchroner Ablauf mit Python-Effekten.
- **Analysekarten:** `luminance`, `edges` (später `flow`, `normals`) im Browser auf der GPU, im Ebenenraum gecacht wie die
  Tiefenkarte; ML-Karten im Dienst mit Browser-Rückfall. Python-Effekte berechnen dieselben Karten selbst (gleiches
  Verfahren, durch Tests abgeglichen).
- **Ein Manifest, zwei Implementierungen:** Der Dienst liest dieselben `effects/*/manifest.json` und lädt `effect.py`.
- **Vorschau:** bleibt 2048 px (einstellbar); Parameter bleiben in Leinwand-px gespeichert (Vorschau skaliert); zusätzlich
  Ausschnitt in voller Auflösung beim Hineinzoomen (E1).
- **PSD:** Option „Effekte als eigene Ebenen“ (Basis + je Effekt eine gerasterte Ebene mit Effektmaske/Mischmodus).
- **Lizenzen:** `license.commercialUse` je Effekt, Behandlung wie NC-Masken; Gesamtübersicht `LICENSES-THIRD-PARTY.md`.
- **Reihenfolge:** alte Spec-Phase 5 (Pinsel, SAM) wird vor E3 umgesetzt; Korn/Halation/Doppelbelichtung der alten Phase 6
  gehen in `film-grain`/`double-exposure` auf.
- **Modelle (13.3):** Depth Anything V2 Small/Large (vorhanden), SAM 2.1, U²-Net, MediaPipe Face; AdaIN nur nach geklärter
  VGG-Gewichtslizenz, sonst nur im Modus „Alle“ – jeweils vor E3 an der Quelle prüfen.
- **GPU im Dienst (13.4):** PyTorch/MPS für ML; Simulationen bevorzugt WebGPU im Browser, sequenzielle Verfahren mit
  NumPy/SciPy im Dienst.
- **Pigmente (13.5):** eigene Näherungsdaten (Reflexionsrekonstruktion aus Pigmentfarben, Kubelka-Munk mit zwei Konstanten);
  Mixbox ausgeschlossen.
- **Ablauf:** nach jedem Schritt Tests, Commit und Push; Plan in `docs/plan-E1.md`.

## 2026-10-15 – Phase 4: Transform und weitere Bilder

- **Frage:** In welchem Raum wirken Maske, Lochfüllung und Effekte einer transformierten Ebene?
- **Entscheidung:** Maske, Lochfüllung, Tiefenkarte und Fokuspunkte gehören zum **Original** (Ebenen-px) und bewegen sich mit
  der Ebene. Sie werden in einer passenden Auflösung des Originals aufbereitet (Viertel-Oktaven-Stufen, damit Caches beim
  Skalieren stabil bleiben) und dann per Warp-Shader (bilinear, geglättete Kanten, 4 Proben beim Verkleinern) auf die Leinwand
  gelegt. **Effekte** (Unschärfe, Schatten, …) wirken danach in Leinwand-px – ein Radius von 20 px bleibt 20 px, egal wie
  groß die Ebene skaliert ist; die Kachel-Überlappung des Exports bleibt dadurch unverändert. Kantenbreiten der Maske
  (Kantenhärte/-versatz, Ebenen-Überlappung) gelten in Ebenen-px. Ebenen in Leinwandgröße mit neutraler Transformation
  nehmen den bisherigen Pfad ohne Neuabtastung (Golden-Tests unverändert).
- **Transform-Semantik:** `x/y` = Versatz der Bildmitte zur Leinwandmitte (Leinwand-px), `scale` = Leinwand-px pro Original-px,
  `rotation` in Grad im Uhrzeigersinn, neu `flipX`/`flipY` (optional). Projektformat 4 (Migration 3 → 4 ohne Änderung, da die
  Transformation bisher immer neutral war). Fokuspunkte liegen in Ebenen-px (bei Hauptbildern identisch mit Leinwand-px).
- **Import als Ebene:** „+ Bild“ in der Ebenenliste, ⇧⌘O oder Bild auf die Leinwand ziehen (bei offenem Projekt; mehrere Dateien
  möglich). „Öffnen“ (⌘O) legt weiterhin ein neues Projekt an. Die Ebene kommt über die Auswahl (in dieselbe Gruppe).
  Deckende Bilder (JPEG oder ohne Transparenz) füllen die Leinwand – typisch für einen neuen Hintergrund –, Bilder mit
  Transparenz werden eingepasst. Die Leinwandgröße bleibt die des ersten Bildes.
- **Reihenfolge:** „Eine Ebene nach vorn/hinten“ springt über genau eine **sichtbare** Ebene und betritt bzw. verlässt dabei
  Gruppen (so wandert ein Hintergrund schrittweise zwischen Tiefenebenen); ausgeblendete Knoten werden übersprungen.
  „Ganz nach vorn/hinten“ zuerst innerhalb der Gruppe, beim zweiten Mal in der Wurzel. Kürzel nach dem eingegebenen Zeichen
  (`]`, `[`, mit ⇧ `}`/`{`): auf der deutschen Mac-Tastatur also ⌘⌥6 / ⌘⌥5; die US-Tastenposition wird bewusst nicht
  ausgewertet, weil dort auf deutscher Tastatur „+“ (Zoom) liegt.
- **Rahmen auf der Leinwand** (Werkzeug „Verschieben“): Fläche ziehen = verschieben, Ecke = skalieren um die Mitte, Griff =
  drehen (⇧ = 15°), Pfeiltasten = 1 px (⇧ = 10 px). Gruppen haben nur einen Verschieben-Rahmen (alle Ebenen der Gruppe);
  Skalieren/Drehen ganzer Gruppen fehlt (Gruppen haben im Datenmodell keine Transformation). Gesperrte Ebenen bewegen sich nicht.
- **Zusätzlich:** Löschen von Ebenen/Gruppen (Papierkorb, ⌘⌫); Originale bleiben im Projekt (Undo).
- **Betrifft:** Spec f, Datenmodell, Phase 4

## 2026-10-14 – Phase 3: Tiefenebenen

- **Frage:** Wie werden Tiefenbänder lückenlos und ohne Halo zusammengesetzt?
- **Entscheidung:** Neue Maskenart `depth` (`depthId`, `near`, `far`, `overlap`, `fillBelow`) statt gespeicherter Masken je Band.
  Die Bandmaske entsteht auf der GPU aus der Tiefenkarte (weiche Kanten, Überlappung = Dilatation + Weichzeichnen in px).
  Die fernste Ebene deckt das ganze Bild ab (`near = 0`); jede fernere Ebene füllt Inhalte näherer Ebenen per Lochfüllung
  (Push-Pull, Bereich `[0, fillBelow]`) auf, damit ihre Unschärfe keine Farben des Vordergrunds hineinzieht.
  Tiefenkarten liegen als 16-Bit-PNG im OPFS (`depth/`) und in der Projektdatei; Projektformat 3 (Migration 2 → 3 ohne Änderung).
- **Tiefenmodelle:** Browser Depth Anything V2 Small (ONNX fp16, 518 px, Apache-2.0); Dienst dasselbe Modell mit 1022 px
  (feinere Kanten) und Depth Anything V2 Large (CC BY-NC 4.0, nur im Modus „Alle“). Base/Large laufen nicht im Browser (Größe, NC).
  Die rohe Disparität wird auf das 1.–99. Perzentil normiert und invertiert (0 = nah, 1 = fern), danach per Guided Filter
  kantenbewusst auf volle Auflösung gebracht.
- **Grenzen:** Quantile (gleich viele Pixel je Ebene) oder k-Means auf dem Histogramm; Griffe im Histogramm verschiebbar,
  Mindestabstand 2 %.
- **Preset:** eigenes Plugin `haze` („Dunst“: Entsättigen, Aufhellen, Tönen; optional zusätzlich nach Tiefenkarte) statt einer
  Kern-Stufe – Effekte bleiben Plugins. Unschärfe ~ (Rang/(n−1))^1,3 · Maximum, Dunst ~ (Rang/(n−1))^1,1 · Maximum.
  Jede Tiefenebene erhält beide Effekte (die nächste mit 0), damit der Gruppenmodus alle Ebenen erreicht.
- **Zurückgestellt:** Der Modus „objekttreu“ (SAM-Objekte ganz einer Ebene zuordnen) braucht SAM (Spec e) und folgt mit Phase 5/6.
- **Betrifft:** Spec d, Datenmodell, Phase 3

## 2026-10-14 – Phase 3: Gruppenmodus und Entkoppeln

- **Frage:** Was bedeutet „Parameter in der Gruppe ändern“ bei unterschiedlichen Werten der Kinder?
- **Entscheidung:** Im Modus „Gruppe“ setzt eine Änderung den **absoluten** Wert bei allen Kindern der Gruppe (auch in
  verschachtelten Gruppen), die einen Effekt mit derselben `effectId` haben (jeweils die erste Instanz) – egal ob am gemeinsamen
  Regler im Gruppen-Inspektor oder an einer einzelnen Ebene. Ausgenommen sind Parameter, die eine Ebene per Schloss entkoppelt hat
  (`EffectInstance.decoupled`). Eine Änderung = ein Undo-Schritt. Relative Änderungen (Faktoren) wären mit dem Preset-Verlauf
  verträglicher, widersprechen aber dem Spec-Satz „wirkt auf alle“ mit sichtbarem Gruppenwert.
- **Ebenenliste:** Baum mit Ziehen (oben/unten/in Gruppe), „Gruppieren“ (Ebene in neue Gruppe) und „Auflösen“.
- **Betrifft:** Spec h, Phase 3

## 2026-10-14 – Phase 3: Parallax und PSD-Export

- **Parallax:** reine Vorschau, verändert das Projekt nicht. Jede Ebene wird beim Mischen um `Zeiger · Stärke · (0,5 − Tiefe)`
  verschoben (max. 8 % der langen Kante, Rand geklemmt); Tiefe = Mitte des Bandes, bei Gruppen der Mittelwert der Kinder.
  Lücken an Kanten verdecken die überlappenden, lochgefüllten Ebenen.
- **PSD (ag-psd, MIT):** Jede Ebene wird **mit angewendeten Effekten** als Pixelebene in voller Auflösung exportiert, mit Deckkraft,
  Mischmodus, Sichtbarkeit und Namen; Gruppen ohne eigene Effekte werden PSD-Gruppen (beliebig verschachtelt). Weil die Maske
  bereits in den Pixeln steckt, liegt sie zusätzlich als **deaktivierte** Ebenenmaske bei (aktiviert würde sie doppelt wirken).
  Gruppen mit eigenen Effekten gibt es in PSD nicht → sie werden als eine Ebene „… (gerendert)“ exportiert. Schatten werden
  eigene Ebenen unter ihrer Ebene. Option: unbearbeitete Originale als ausgeblendete Gruppe „Originale“. 8 Bit sRGB.
  Unterschied zur App: PSD-Programme mischen in 8-Bit-sRGB, die App linear in 16-Bit-Float → an weichen Bandkanten
  vereinzelte Abweichungen (gemessen mit psd-tools: Mittel 0,16, 99 % ≤ 2 Stufen).
- **Export-Dialog:** PNG, JPEG (Qualität, auf Weiß), WebP (Qualität), PSD. ⌘E und der Export-Knopf öffnen den Dialog;
  die NC-Warnung gilt für alle Formate. ag-psd wird erst beim ersten PSD-Export geladen.
- **Prüfung der PSD:** automatisch mit ag-psd (`readPsd`) im E2E-Test und einmalig unabhängig mit psd-tools (Python);
  Photopea wurde nicht automatisiert geprüft (Netzwerk, Drittanbieter).
- **Betrifft:** Spec Phase 3, Export

## 2026-10-14 – Modell-Downloads sichtbar und steuerbar

- **Frage (Nutzer):** Sichtbar machen, welche Modelle laden, mit welchem Fortschritt, und welche fertig sind; Pausieren und Stoppen ermöglichen.
- **Entscheidung:** Dialog „Modelle“ (Einstellungen → „Modelle verwalten …“ oder Anzeige in der oberen Leiste, solange etwas lädt) mit allen Modellen aus dem Register, getrennt nach Browser und Dienst: Status, Fortschritt (MB/%), Größe, Lizenz, Knöpfe Herunterladen/Pausieren/Fortsetzen/Stoppen/Löschen. Browser: Download-Manager im ML-Worker, Teil-Downloads als `.part` im OPFS, Fortsetzen per HTTP-Range (auch nach Neuladen), SHA-256 vor dem Umbenennen. Dienst: eigener Downloader statt `snapshot_download` (Dateien des Repos in `~/.cache/blur-layer-studio/models/<id>/`, Range-Fortsetzen, `.complete` mit Revision), Endpunkte `POST /models/{id}/download|pause|stop`, `DELETE /models/{id}`, Zustand in `/health`. NC-Modelle lassen sich im Modus „Kommerziell“ auch nicht herunterladen. Braucht eine Aufgabe ein pausiertes Modell, erscheint ein Hinweis statt stillem Fortsetzen.
- **Betrifft:** Lokaler Python-Dienst, ML-Worker, UI

## 2026-10-14 – Fokuspunkte entfernen; Vorher/Nachher hat Vorrang

- **Frage (Nutzer):** Fokuspunkte wieder entfernen; der Vorher/Nachher-Teiler war über einem Fokuspunkt nicht greifbar.
- **Entscheidung:** Entfernen per × am Punkt, per Entf/Rücktaste (zuletzt angefasster Punkt) und im Inspektor; der Abschnitt „Fokuspunkte“ klappt auf, sobald Punkte existieren. Bei aktivem Teiler sind Fokuspunkte nur sichtbar, nicht greifbar; der Teiler liegt darüber.
- **Betrifft:** UI, Fokus-Werkzeug

## 2026-10-14 – Browser-Vordergrundmodell: BiRefNet lite in 512 × 512

- **Frage:** Spec: „BiRefNet (lite) oder vergleichbares Salient-Object-Modell“ im Browser.
- **Entscheidung:** Browser nutzt den MIT-lizenzierten 512er-Re-Export `studioludens/birefnet-lite-512` (fp16, WebGPU). Die grobe Maske wird mit einem Guided Filter (Bild als Führung) auf volle Auflösung gebracht. Der Python-Dienst nutzt BiRefNet in voller Größe (1024).
- **Begründung:** Alle 1024-ONNX-Fassungen scheitern in Chrome auf dem Referenz-Mac – nachgemessen: JSEP-WebGPU (ungültiges WGSL bei Slice, Concat mit 1024 Eingängen über der Verschachtelungsgrenze), nativer WebGPU-EP (11 Storage-Buffer, Chrome erlaubt 10; auch nach Aufteilen der großen Concat/Split-Knoten anschließend `std::bad_alloc`), WASM (`std::bad_alloc`). Der 512er-Export läuft: 3,6 s beim ersten Mal (Laden + Shader), danach 0,6 s; Spec-Ziel < 3 s. Alternativen verworfen: `onnx-community/ISNet-ONNX` (AGPL-3.0), MODNet (nur Porträts).
- **Betrifft:** Technologie-Stack, Segmentierung, Phase 2

## 2026-10-14 – ONNX Runtime: nativer WebGPU-EP mit eigenem Gerät

- **Entscheidung:** `onnxruntime-web/webgpu` (nativer EP, Laufzeit `ort-wasm-simd-threaded.asyncify`) mit einem eigenen WebGPU-Gerät, das die Adapter-Limits anfordert (Standardgerät: nur 8 Storage-Buffer pro Stufe). Laufzeitdateien von ORT und MediaPipe liegen unter `/vendor/` (Vite-Plugin `vendorAssets`), nicht auf einem CDN.
- **Begründung:** Der JSEP-Pfad erzeugt für BiRefNet ungültige Shader; die Spec verbietet Netzwerkanfragen außer Modellen.
- **Betrifft:** ML-Worker

## 2026-10-14 – MediaPipe im Modul-Worker

- **Entscheidung:** Fokuspunkte laufen im selben ML-Worker (CPU-Delegate). Der Modul-Loader von MediaPipe wird selbst importiert und `ModuleFactory` vor jedem `createFromOptions` gesetzt (MediaPipe löscht sie nach dem ersten Landmarker, ein ES-Modul läuft aber nur einmal).
- **Betrifft:** Fokuspunkte

## 2026-10-14 – Fokuspunkte aus der Pose, wenn das Gesicht nicht erkannt wird

- **Entscheidung:** Findet das Face-Mesh kein Gesicht (z. B. Hand vor dem Gesicht, Schwarz-Weiß-Foto), kommen Augen und Gesichtsmitte aus den Kopfpunkten des Pose-Landmarkers. Punkte bis 15 % außerhalb des Bildes werden an den Rand gesetzt (Brust bei Brustbildern), weiter draußen verworfen. Radien: Augen 0,22 × Gesichtsbreite, Gesicht 0,75 ×, Brust 0,55 × Schulterbreite, Hände 0,3 × Schulterbreite.
- **Betrifft:** Segmentierung (b), Fokuskarte

## 2026-10-14 – Hintergrund: Lochfüllung statt invertierter Maske

- **Frage:** Spec: Hintergrund-Layer „invertierte Maske“ plus Lochfüllung.
- **Entscheidung:** Der Hintergrund speichert die invertierte Maske, rendert mit eingeschalteter Lochfüllung aber das per Push-Pull aufgefüllte, deckende Bild (Loch = Vordergrundmaske, leicht erweitert; Pixel mit Vordergrundanteil zählen nicht). Abschaltbar im Inspektor; dann wirkt die invertierte Maske.
- **Begründung:** Nur so bleiben Vordergrundfarben beim Weichzeichnen aus dem Hintergrund und es entsteht weder ein dunkler noch ein durchsichtiger Saum. Gemessen (synthetische Szene, 80 px Unschärfe): Ring außerhalb der Kante 225/225 mit Lochfüllung, 170 ohne.
- **Betrifft:** Segmentierung (b), Render-Pipeline

## 2026-10-14 – Fokuskarte und ortsabhängige Unschärfe

- **Entscheidung:** Fokuskarte = max. über Punkte von (1 − Abstand / Radius); der Kern rendert sie pro Ausschnitt (kachelsicher) und reicht sie Effekten als `focus_tex` mit Flag `has_focus()` (ohne Fokuskarte: 0 = volle Wirkung). „Fokus-Weichheit“ formt den Übergang (`focus_sharpness(p, softness)` im Vorspiel). Ortsabhängiger Gauß: Stapel von Gauß-Stufen (Faktor √2) mit linearer Interpolation pro Pixel; Linse/Bewegung/Zoom: Radius pro Pixel. Pinsel auf der Fokuskarte folgt in Phase 5.
- **Betrifft:** Effekte (a, b), Plugin-Vertrag

## 2026-10-14 – Erweiterungen des Plugin-Vertrags (Phase 2)

- **Entscheidung:** Neu im Vorspiel: Kernfeld `flags` (Bit 0 = Fokuskarte), zweiter Eingang `src_b` (Bindung 8, `ctx.run(…, { srcB })`), Hilfen `has_focus()`/`focus_sharpness()`. Neu in `effect.ts`: `ctx.gaussian()` (Kern-Gauß), `ctx.hasFocus`, `ctx.canvasSize`. `reach`-Ausdrücke dürfen `canvasWidth`/`canvasHeight` nutzen. Alles abwärtskompatibel; dokumentiert in `effects/README.md`.
- **Betrifft:** Effekt-Plugin-System

## 2026-10-14 – Schatten-Plugin: Parameter und Perspektive

- **Entscheidung:** Plugin `effects/shadow` mit Richtung, Entfernung, Weichheit, Randausblendung, Verlaufsstärke, Farbe, Skalierung (`shadowScale`, weil `scale` reserviert ist), Neigung und Bodenlinie (Achse für Skalierung/Neigung). Deckkraft und Mischmodus (Standard 65 %, Multiplizieren) gehören zum Schatten-Layer. Die Verlaufsstärke misst den Abstand zum Objekt entlang der Richtung (bis 24 Abtastungen).
- **Betrifft:** Schatten (e)

## 2026-10-14 – Mischmodi im Compositor

- **Entscheidung:** Alle Spec-Mischmodi (Normal, Multiplizieren, Negativ multiplizieren, Ineinanderkopieren, Weiches Licht, Aufhellen, Abdunkeln, Differenz) für Ebenen, Gruppen und Schatten; Mischfunktion auf sRGB-kodierten Werten, Alpha-Compositing linear (W3C), wie in der Entscheidung „Mischmodi wahrnehmungsnah“ vorgesehen.
- **Betrifft:** Render-Pipeline

## 2026-10-14 – Python-Dienst: Jobs, Lizenzprüfung, Remote-Code

- **Entscheidung:** `/segment/foreground` liefert immer einen Job (Status/Fortschritt per `/jobs/{id}`, Ergebnis 16-Bit-PNG). NC-Modelle: HTTP 403, wenn die App nicht „Alle“ meldet; `/health` meldet sie als nicht verfügbar. Modelle über `transformers` mit `trust_remote_code=True`, Revision auf einen Commit festgelegt. MPS mit fp16. `npm run dev` startet App und Dienst (ohne `uv` nur die App); Tests starten nur Vite (`npm run dev:web`).
- **Betrifft:** Lokaler Python-Dienst

## 2026-10-14 – Masken speichern

- **Entscheidung:** Masken in voller Originalgröße als 16-Bit-Graustufen-PNG (fast-png, MIT) im OPFS (`masks/<id>.png`) und in der Projektdatei (`masks/`); jede neue Maske bekommt eine neue ID (unveränderlich). Auf der GPU als `r16float`. Projektformat 2 (Format 1 wird beim Laden migriert).
- **Betrifft:** Speichern, Datenmodell

## 2026-10-14 – Dienst-Abfrage und Ansichten

- **Entscheidung:** `/health` alle 5 s, solange der Dienst antwortet, sonst alle 20 s (jeder Fehlversuch erscheint in der Browser-Konsole); im ML-Modus „Browser“ gar nicht. Prüfansichten (Tasten 1–3): Ergebnis, Maske (rot = ausgeblendet), Fokuskarte (gelb, mit Punkten). Fokuspunkt-Werkzeug (F): Klick setzt Punkt, Mitte ziehen verschiebt, Ring ziehen ändert den Radius.
- **Betrifft:** UI

## 2026-10-14 – Undo/Redo: Befehle mit Zustands-Schnappschuss

- **Frage:** Spec: „Undo/Redo über Command-Pattern“.
- **Entscheidung:** Jede Änderung läuft als benannter Befehl (`src/state/commands.ts`) durch die History; gespeichert wird der unveränderliche Projektzustand danach (Memento) statt einer Umkehroperation. Reglergesten werden per `coalesceKey` zu einem Eintrag zusammengefasst. Limit 500 Schritte (Spec: ≥ 200).
- **Begründung:** Das Projekt ist unveränderlich mit strukturellem Teilen – ein Schnappschuss kostet nur die geänderten Knoten, Umkehroperationen entfallen als Fehlerquelle. Masken (Phase 5) werden als unveränderliche Versionen referenziert, die Kachel-Deltas liegen im Maskenspeicher; das Modell trägt dort weiter.
- **Betrifft:** Speichern, Undo, Export; Phase 1

## 2026-10-14 – History nicht in der Projektdatei

- **Entscheidung:** Die History ist Sitzungszustand. Autosave und `.blurstudio` enthalten nur den aktuellen Stand; das Feld `history` aus dem Spec-Typ `Project` entfällt im gespeicherten Format.
- **Begründung:** Hält Dateien klein; Undo über Sitzungen hinweg ist kein Spec-Ziel.
- **Betrifft:** Datenmodell, Projektdatei

## 2026-10-14 – Manifest-Erweiterungen

- **Frage:** Der Plugin-Vertrag der Spec kennt keine Reichweite, keine Presets und keine bedingte Sichtbarkeit; Schwarz-Weiß braucht Presets, Duotone braucht ausblendbare Farben, der Kachel-Export braucht die Reichweite.
- **Entscheidung:** Optionale Felder `reach` (Ausdruck über Parameter, sicher ausgewertet, kein `eval`), `presets`, `visibleIf`, `description` und pro Parameter `hint`/`step`. Alle optional; das Spec-Beispiel bleibt gültig.
- **Begründung:** Ohne `reach` entstehen Nähte im gekachelten Export; Presets und Sichtbarkeit sind generisch statt pro Effekt im Kern verdrahtet.
- **Betrifft:** Effekt-Plugin-System; dokumentiert in `effects/README.md`

## 2026-10-14 – Einheiten im Shader-Vertrag

- **Entscheidung:** Farben werden im Projekt sRGB-kodiert gespeichert (wie im Farbwähler) und dem Shader linear übergeben; Winkel im Projekt in Grad, im Shader in Radiant; `enum` als Index, `bool` als 0/1; `px`-Parameter und `point` werden mit dem Skalierungsfaktor umgerechnet. Der Kern erzeugt `struct Params` (mit `resolution`, `origin`, `canvas_size`, `scale` vorneweg) und stellt Hilfsfunktionen voran. Einstufige Effekte definieren `fn effect(p: vec2i) -> vec4f`; mehrstufige definieren Einstiegspunkte und steuern sie über `effect.ts`.
- **Begründung:** Plugin-Autoren rechnen nie selbst mit Ausrichtung, Skalierung oder Farbraum; `origin` macht ortsfeste Muster (Korn) kachelsicher.
- **Betrifft:** Effekt-Plugin-System

## 2026-10-14 – Mischmodi wahrnehmungsnah

- **Frage:** Mischmodi linear oder auf sRGB-kodierten Werten (siehe Risiko D3 im Plan)?
- **Entscheidung:** Unschärfe und Normal-Mischung rechnen linear. Kontrast-Mischmodi (Multiplizieren, Negativ multiplizieren, Ineinanderkopieren, Weiches Licht, Farbe, Farbton) rechnen auf sRGB-kodierten Werten (Formeln nach W3C Compositing Level 1) – so wie Bildprogramme, damit der PSD-Export später gleich aussieht. Umgesetzt im Farb-Overlay; der Compositor beherrscht in Phase 1 nur „Normal“ (es gibt noch keine überlagerten Ebenen), die übrigen Modi folgen in Phase 2 nach derselben Regel.
- **Betrifft:** Render-Pipeline, Farb-Overlay, Phase 1–3

## 2026-10-14 – Gauß-Radius und Pyramide

- **Entscheidung:** „Stärke“ ist der Radius in px mit σ = Radius / 3. Große Radien laufen über eine 2×2-Box-Pyramide bis σ ≤ 6 Stufen-px; die Varianz von Box-Verkleinerung und bilinearem Hochskalieren wird herausgerechnet. Gemessen gegen eine exakte CPU-Faltung: max. 3/255 Abweichung, im Mittel < 0,2/255.
- **Begründung:** Exakter Gauß-Charakter bei konstanter Laufzeit auch für 300 px.
- **Betrifft:** Effekte/Unschärfe

## 2026-10-14 – Keine Halbauflösung beim Ziehen (vorerst)

- **Frage:** Spec: „Während des Ziehens bei sehr großen Radien Vorschau automatisch auf halbe Auflösung“.
- **Entscheidung:** Nicht eingebaut, weil nicht nötig: 2048 px mit Gauß (1–300 px), Schwarz-Weiß mit Korn und Farb-Overlay brauchen pro geändertem Frame im Median 1,7 ms, p90 7,5 ms (Referenz-Mac) – weit unter 33 ms. Wird mit Linsenunschärfe (Phase 2) erneut gemessen und dann ggf. nachgerüstet.
- **Betrifft:** Performance-Ziele

## 2026-10-14 – Effekt-Browser mit Live-Miniaturen

- **Entscheidung:** `preview.jpg` ist optional. Der Effekt-Browser zeigt den Effekt mit Standardwerten live am aktuellen Bild; `preview.jpg` dient als Ersatz ohne Bild.
- **Begründung:** Neue Plugins brauchen kein Vorschaubild, und die Vorschau zeigt die Wirkung am eigenen Motiv.
- **Betrifft:** Effekt-Plugin-System

## 2026-10-14 – UI: „Mischung“ statt „Stärke“, Bereich ausgeblendet

- **Entscheidung:** Der vom Kern verwaltete Wert `strength` heißt auf der Effektkarte „Mischung“ (Gauß-Blur und Schwarz-Weiß haben eigene Parameter namens „Stärke“). Die Auswahl `region` (ganz / fokusgewichtet / invers) ist implementiert, im UI aber ausgeblendet, bis es Fokuskarten gibt (Phase 2).
- **Betrifft:** UI, Effekte

## 2026-10-14 – Lokaler Speicher, Projektübersicht, Sitzung

- **Entscheidung:** Speicherung vollständig im OPFS (`originals/<sha256>`, `projects/<id>.json`, `thumbs/<id>.webp`); IndexedDB wird nicht gebraucht. Autosave 1 s nach der letzten Änderung, inkl. Miniatur. Beim Start erscheint die Projektübersicht, wenn Projekte existieren; lädt man denselben Tab neu, öffnet sich das zuletzt offene Projekt wieder (auch nach einem von Vite ausgelösten Neuladen). Eine geöffnete `.blurstudio`-Datei wird als neues lokales Projekt (neue ID) angelegt, damit nichts überschrieben wird; Originale werden per SHA-256 geprüft.
- **Betrifft:** Speichern, Undo, Export

## 2026-10-14 – Ein Bild = ein Projekt (bis Phase 4)

- **Entscheidung:** In Phase 1 legt jedes geöffnete Bild ein neues Projekt an (Wurzelgruppe „Bild“ mit einer Ebene); Leinwand = Bildgröße. Weitere Bilder als Ebenen kommen in Phase 4. Effekte lassen sich auf die Ebene oder die Wurzelgruppe legen (Spec a: „Effekt auf die Wurzelgruppe oder einen ungeteilten Layer“).
- **Betrifft:** Phase 1/4

## 2026-10-14 – Export-Kacheln

- **Entscheidung:** Kacheln 2048 px; Überlappung = Summe der `reach`-Werte entlang des tiefsten Pfads + 8 px, auf 64 px ausgerichtet (gleiche Pyramidenraster in allen Kacheln). Gemessen: gekachelt (96 px) und ungekachelt sind pixelgleich.
- **Betrifft:** Render-Pipeline, Export

## 2026-10-14 – Dev-Port 5317

- **Frage:** Vite-Standardport 5173?
- **Entscheidung:** Dev-Server auf 5317, Preview auf 4317 (`strictPort`).
- **Begründung:** Auf dem Entwicklungsrechner belegt ein anderes Projekt 5173; Playwright hätte sonst die falsche App testen können. Die CORS-Origin des Python-Dienstes (Phase 2) ist entsprechend `http://localhost:5317`.
- **Betrifft:** Lokaler Python-Dienst (CORS), Tests

## 2026-10-14 – Zoom/Pan-Bedienung

- **Frage:** Die Spec nennt nur „Zoom/Pan“.
- **Entscheidung:** Trackpad-Pinch bzw. ⌘/Strg + Mausrad zoomt um den Cursor; Scrollen ohne Taste verschiebt; Leertaste + Ziehen oder mittlere Maustaste verschiebt; ⌘0 einpassen, ⌘1 100 %, ⌘+/⌘− zoomen. Ab 200 % Zoom Pixel scharf (nearest).
- **Begründung:** Übliche Konvention in Grafik-Apps (Figma, Photoshop mit Trackpad) und natürlich auf dem MacBook-Trackpad.
- **Betrifft:** UI, Phase 0

## 2026-10-14 – TypeScript 6.0 statt 7.0

- **Frage:** Welche TypeScript-Version?
- **Entscheidung:** TypeScript 6.0.3.
- **Begründung:** TS 7.0.2 ist „latest“, aber typescript-eslint 8.71 unterstützt nur TS < 6.1. Upgrade, sobald typescript-eslint TS 7 unterstützt.
- **Betrifft:** Technologie-Stack, alle Phasen

## 2026-10-14 – Kein WebGL2-Render-Pfad in Phase 0

- **Frage:** Phase 0 verlangt „WebGPU-Initialisierung mit verständlicher Meldung bzw. WebGL2-Fallback“. Wie weit geht der Fallback?
- **Entscheidung:** Phase 0 erkennt WebGPU/WebGL2 und zeigt eine verständliche Meldung; ohne WebGPU wird nicht gerendert. Die minimalen WebGL2-Effekte der Spec werden nur nachgezogen, wenn der Nutzer sie braucht.
- **Begründung:** Zielbrowser ist Chrome auf macOS mit stabilem WebGPU; jeder WebGL2-Pfad verdoppelt die Shader-Arbeit. Vom Nutzer bestätigt.
- **Betrifft:** Render-Pipeline (WebGL2-Fallback), Phase 0

## 2026-10-14 – Plugins werden zur Build-Zeit gefunden

- **Frage:** Wie lädt die App Effekt-Ordner „ohne Codeänderung“?
- **Entscheidung:** Per `import.meta.glob` über `effects/*/`. Im Dev-Server erscheinen neue Ordner sofort (Hot Reload); ein Produktions-Build muss neu gebaut werden. Kein Laden aus frei gewählten Ordnern zur Laufzeit.
- **Begründung:** Einfach, typsicher, Shader-Hot-Reload inklusive; für eine lokale App ausreichend. Vom Nutzer bestätigt.
- **Betrifft:** Effekt-Plugin-System, Phase 1

## 2026-10-14 – Schatten ist ein generierter Layer, gerendert von einem Plugin

- **Frage:** Die Spec nennt den Schatten als mitgelieferten Effekt (Plugin), das Datenmodell aber als `shadow?: ShadowConfig`, das einen eigenen Layer erzeugt.
- **Entscheidung:** Der Schatten ist ein automatisch erzeugter, verknüpfter Layer direkt unter seinem Layer; sein Bild erzeugt das Plugin `effects/shadow` aus der Maske des Quell-Layers. `ShadowConfig` sind die Parameter dieses Plugins. Der Schatten-Layer hat einen eigenen Effekt-Stack.
- **Begründung:** Erfüllt beide Stellen der Spec und hält „Effekte nur als Plugins“ ein. Vom Nutzer bestätigt.
- **Betrifft:** Datenmodell, Effekte/Schatten, Phase 2

## 2026-10-14 – Kantenübergang ist eine Kern-Stufe

- **Frage:** Ist der Kantenübergang (Kantenhärte, Kantenversatz, Verlaufskurve) ein Effekt-Plugin?
- **Entscheidung:** Nein. Er ist eine feste Masken-Stufe im Kern vor dem Effekt-Stack, mit Feldern `maskEdge` am Layer.
- **Begründung:** Die Pipeline der Spec zeigt ihn als Masken-Stufe; er wirkt auf die Maske, nicht auf die Farbe. Vom Nutzer bestätigt.
- **Betrifft:** Datenmodell, Render-Pipeline, Phase 2

## 2026-10-14 – Git-Workflow

- **Entscheidung:** Alles auf `main`; Commit am Ende jeder Phase (bei großen Phasen auch Zwischen-Commits). Push nur auf Anweisung.
- **Begründung:** Vom Nutzer festgelegt.

## 2026-10-14 – Testbilder

- **Entscheidung:** Phase 0/1 nutzen synthetisch erzeugte Testbilder. Für echte Fotos (Portrait, Landschaft, Objekt auf Tisch) werden freie Bilder (CC0/Public Domain) gesucht, die Lizenz an der Quelle geprüft und in `tests/fixtures/LICENSES.md` dokumentiert.
- **Begründung:** Keine Lizenzrisiken in Golden-Tests. Vom Nutzer festgelegt.

## 2026-10-14 – HEIC nicht unterstützt, Import nach sRGB

- **Frage:** Spec: „HEIC falls der Browser es dekodiert“.
- **Entscheidung:** Chrome dekodiert kein HEIC → v1 unterstützt HEIC nicht; der Import zeigt einen Hinweis. Bilder mit breitem Farbraum (Display P3) werden beim Dekodieren nach sRGB konvertiert.
- **Begründung:** libheif-WASM ist LGPL und groß; der Export ist laut Spec sRGB.
- **Betrifft:** Externe Bild-Layer, Import
