# Spec: ML-Fotobearbeitung mit Prompts
## artistic-photo-renderer – Blur & Layer Studio (eigenständige Erweiterung)

Version 1.2 · Stand: 07.11.2026
Änderung gegenüber 1.1: Leinwand vergrößern (Basisfunktion ohne ML, Abschnitt 5.8) und Outpainting (Modus „Erweitern“, Abschnitt 5.9) mit eigener Phase M1b ergänzt; Style-Transfer als Anwendungsfall der Bearbeitungs-Ebene (Abschnitt 5.10).
Änderung gegenüber 1.0: Generierungs-Ebene (Text-zu-Bild, Abschnitt 4.6) und Inpainting mit Pinselmaske samt Rolle `inpaint` (Abschnitt 5.7) ergänzt.
Umsetzungsstand: M0 durchgeführt ([docs/m0-bericht.md](docs/m0-bericht.md)); der Anwendungsfall Stil-Übertragung (5.10) ist vorab als Effekt umgesetzt (Modellort in den Einstellungen, Dienst-Endpunkt `/ml/edit`).
Status: Eigenständige Spec. Wird **erst nach Abschluss** der Phasen aus `spec-effekte-und-malvorlagen.md` (E1–E5) umgesetzt.
Die bisherigen Specs bleiben **unverändert** gültig.

---

## 0. Hinweise für die Umsetzung (bitte zuerst lesen)

- Diese Spec erweitert ein **fertiges, funktionierendes Programm**. Oberstes Ziel: **Nichts Bestehendes darf kaputtgehen.** Alle vorhandenen Funktionen, Tests, Projektdateien und Exporte müssen nach jeder Phase unverändert funktionieren.
- Die Erweiterung wird **additiv** gebaut: neue Module, neue Ebenenart, neue Dienst-Endpunkte. Eingriffe in bestehenden Code nur dort, wo eine Erweiterung zwingend andocken muss, und dann minimal.
- Vor jeder Implementierung wird der Bestand analysiert (Phase M0). Namen, Pfade und Schnittstellen in dieser Spec sind **Vorschläge** und werden an den Bestand angepasst.
- Phasen heißen **M0 bis M3**, um Verwechslungen mit anderen Phasen zu vermeiden.
- Entscheidungen aus Abschnitt 9 werden **nicht** eigenmächtig getroffen, sondern vorgelegt.

---

## 1. Ziel

Vier Fähigkeiten mit ML-Modellen (die vierte braucht zusätzlich die Basisfunktion „Leinwand vergrößern“):

1. **Bearbeiten:** Fotos per Texteingabe verändern, zum Beispiel:
   - „mach den Himmel zu einem Gewittersturm“
   - „ersetze den Hintergrund durch einen Wald im Nebel“
   - „gib der Szene das Licht eines Sonnenuntergangs“
2. **Generieren:** neue Bilder per Texteingabe erzeugen (Text-zu-Bild), z. B. als Hintergrund, Textur oder Ausgangsmaterial.
3. **Inpainting:** Teile eines Bildes mit dem Pinsel maskieren und gezielt ersetzen, entfernen oder anpassen.
4. **Erweitern (Outpainting):** Die Leinwand unter dem Bild vergrößern (Abschnitt 5.8) und die neue Fläche vom Modell passend zur Szene füllen lassen (Abschnitt 5.9).

Alles lebt in **eigenen Ebenenarten (ML-Ebenen: Bearbeitungs-Ebene und Generierungs-Ebene)**, die jederzeit ein- und ausgeschaltet werden können und mit allen vorhandenen Ebenen, Masken, Effekten, Gruppen, Exporten und dem Malplan zusammenarbeiten.

Standardmodell für Bearbeiten und Generieren: **FLUX.2 [klein] 9B** (Black Forest Labs), austauschbar. Für Inpainting ist ein eigenes Füllmodell optional wählbar (Rolle `inpaint`).

---

## 2. Lizenzlogik

### 2.1 Ausgangslage
- **Das Tool ist nicht kommerziell.** Es wird nur von mir privat genutzt, nicht verkauft, nicht als Dienst angeboten.
- **Die erzeugten Bilder werden kommerziell genutzt** (verkauft, ausgestellt).

### 2.2 Verhalten des bestehenden Umschalters für ML-Ebenen
- Für Modelle, die über die **Modellverwaltung dieser Spec** (Abschnitt 3) registriert werden, richtet sich der bestehende Umschalter „kommerziell / nicht-kommerziell“ nach dem Feld `outputCommercialUse`, also nach den **Nutzungsrechten an den erzeugten Bildern**.
- **FLUX.2 [klein] 9B** ist in **beiden Modi** aktiv (`outputCommercialUse: true`, meine Einstufung).
- Die Einstufung jedes Modells treffe **ich**. Das Tool trifft diese Entscheidung nicht selbst, sondern zeigt die hinterlegten Lizenzangaben an.
- Das Verhalten des Umschalters für alle **bestehenden** Effekte und Modelle bleibt unverändert.

### 2.3 Herkunftsnachweis
- In der Projektdatei wird festgehalten, welche Modelle (inkl. Fingerprint, Abschnitt 3.6) für ein Bild verwendet wurden.
- Export pro Werk als Text/JSON: verwendete Modelle mit Lizenzangaben, ML-Ebenen mit Prompts, Effekte, Datum.
- Jede ML-Ebene (Bearbeitung, Generierung, Inpainting) wird darin als **KI-erzeugt oder KI-bearbeitet** gekennzeichnet, mit Modell, Seed und Prompt. Das dient meiner Dokumentation für Verkauf und Ausstellung.

---

## 3. Modellverwaltung

### 3.1 Grundsatz
- ML-Modelle sind **frei wählbar**. Das Tool kennt **Rollen**, für die ich Modelle auswähle.
- Modelle werden **dort verwendet, wo sie liegen**. Sie werden **niemals** in das Tool-Verzeichnis kopiert, verschoben oder dupliziert.
- Das Tool lädt **nichts automatisch aus dem Internet** herunter. Downloads nur auf ausdrückliche Aktion und nur in einen von mir gewählten Ordner.

### 3.2 Rollen
| Rolle | Wofür |
|---|---|
| `image-edit` | Prompt-basierte Bildbearbeitung (Bearbeitungs-Ebene) |
| `image-generate` | Text-zu-Bild (Generierungs-Ebene) |
| `inpaint` | (optional) Füllmodell für Inpainting mit Pinselmaske, siehe 5.7 |
| `upscale` | Hochskalieren der Modellergebnisse auf Originalauflösung |
| `translate` | (optional) Übersetzung deutscher Prompts ins Englische, siehe 5.6 |

Pro Rolle kann es **mehrere registrierte Modelle** geben, eines davon als Standard. Jede ML-Ebene kann ein anderes Modell wählen. **Ein Modell kann mehrere Rollen erfüllen:** FLUX.2 [klein] 9B wird einmal registriert und für `image-edit` und `image-generate` eingetragen (Feld `roles`, siehe 3.3), ohne dass Dateien doppelt angelegt oder geladen werden.

**Bestehende ML-Funktionen** (Tiefe, Segmentierung, Saliency, Gesichter, Style-Transfer aus der Effekt-Spec) bleiben, wie sie sind. Eine spätere Übernahme in diese Modellverwaltung ist optional (Phase M3) und nur, wenn sie ohne Risiko möglich ist.

### 3.3 Modell-Eintrag (Vorschlag)

```yaml
- id: flux2-klein-9b                 # frei vergebener, eindeutiger Name
  name: "FLUX.2 [klein] 9B"
  roles: [image-edit, image-generate]   # ein Modell, mehrere Rollen
  backend: diffusers                 # diffusers | safetensors | remote-api (weitere später)
  paths:                             # absolute Pfade, werden NUR gelesen
    root: /Volumes/Modelle/flux2-klein-9b
    # alternativ einzelne Komponenten:
    # transformer: /pfad/flux-2-klein-9b.safetensors
    # text_encoder: /pfad/qwen3-8b/
    # vae: /pfad/flux2-vae.safetensors
  adapters:                          # optionale LoRAs, ebenfalls nur Pfadverweise
    # - path: /pfad/meine-lora.safetensors
    #   weight: 0.8
  precision: bf16                    # fp32 | fp16 | bf16 | fp8 | int8 | int4 …
  device: auto                       # auto | cuda | mps | cpu
  memory:
    offload: auto                    # none | model | sequential | auto
  defaults:
    steps: 4
  license:
    name: "FLUX Non-Commercial License"
    url: "https://…"
    notes: "Tool privat/nicht-kommerziell, Outputs kommerziell genutzt"
  outputCommercialUse: true          # MEINE Einstufung
  defaultForRoles: [image-edit, image-generate]   # für welche Rollen dies der Standard ist
```

Für `backend: remote-api` statt Pfaden: Endpunkt, **Name** einer Umgebungsvariable für den API-Schlüssel (der Schlüssel selbst wird weder in der Konfiguration noch in Projektdateien gespeichert), Kostenhinweis.

### 3.4 Speicherort der Konfiguration
- Außerhalb des Tool-Verzeichnisses im Benutzer-Konfigurationsordner (z. B. `~/.config/artistic-photo-renderer/models.yaml` bzw. plattformübliches Äquivalent). Updates des Tools überschreiben sie nicht.
- Pfad per Umgebungsvariable überschreibbar.
- Kommentierte Beispieldatei `models.example.yaml` im Repo.

### 3.5 Zugriff ohne Kopieren
- Laden direkt vom Pfad, **nur lesend**. Symlinks, externe Platten und Netzlaufwerke erlaubt. Das Tool schreibt nie in Modellordner.
- **Hugging-Face-Cache:** Verweis auf den vorhandenen Snapshot-Ordner. Bibliotheken werden **offline** betrieben (z. B. `HF_HUB_OFFLINE=1`, `local_files_only=True`), damit nichts heruntergeladen oder in einen anderen Cache dupliziert wird.
- Läuft der Python-Dienst in einem Container: Modellordner **read-only mounten**, nicht ins Image kopieren; Zuordnung Host-Pfad → Container-Pfad in der Konfiguration.
- Ist ein Pfad nicht erreichbar, wird das Modell als **„nicht verfügbar“** markiert. Das Tool startet trotzdem normal; nur die betroffenen ML-Funktionen sind deaktiviert.

### 3.6 Prüfung & Fingerprint
- Beim Registrieren: Pfade prüfen, Format erkennen, Pflichtkomponenten prüfen, optional Testladen per Knopf.
- **Fingerprint** aus Dateinamen, Größen und Änderungszeiten (kein vollständiges Hashing großer Dateien bei jedem Start; vollständiger Hash optional auf Anforderung).
- Fingerprint wird in Projektdateien gespeichert. Hat sich ein Modell geändert oder fehlt es, wird beim Öffnen gewarnt.

### 3.7 Laden & Speicherverwaltung
- Laden erst bei Bedarf, Entladen bei Speicherknappheit (zuletzt ungenutzt zuerst).
- Einstellbares Speicherbudget (GPU/RAM). Die bestehenden ML-Funktionen dürfen dadurch nicht beeinträchtigt werden; Anzeige, was gerade geladen ist.
- Beschleuniger je nach Plattform: CUDA, Apple MPS, CPU-Fallback. Verfügbare Hardware wird beim Start erkannt und angezeigt.
- Offloading und Quantisierung gemäß Modelleintrag.
- Option „ML-Modelle entladen“ per Knopf.

### 3.8 Oberfläche „Modelle“
- Liste aller registrierten Modelle nach Rolle: Status (verfügbar / nicht gefunden / geladen), Lizenz, `outputCommercialUse`, Speicherbedarf.
- **Modell hinzufügen:** Pfad eingeben oder über einen vom Python-Dienst bereitgestellten **Ordner-Browser** wählen (beschränkt auf von mir freigegebene Basisordner).
- Standardmodell pro Rolle festlegen, testen, Eintrag bearbeiten/entfernen. **Entfernen löscht nur den Eintrag, nie die Dateien.**

---

## 4. Die ML-Ebene

### 4.1 Eigene Ebenenart
- Neue Ebenenarten **„ML-Ebene“** in zwei Ausprägungen: **Bearbeitungs-Ebene** (verändert vorhandene Bildinhalte, 4.3, inkl. Inpainting 5.7) und **Generierungs-Ebene** (erzeugt neue Bilder ohne Quellbild, 4.6). Eingebaut über den vorhandenen Erweiterungsmechanismus für Ebenen bzw. Effekte. Ist keiner vorhanden, wird er minimal-invasiv ergänzt (in M0 vorlegen).
- Beide Ausprägungen teilen sich dieselbe Grundlogik (Ein-/Ausschalten, Cache, Neuberechnung auf Aktion, Varianten, Verlauf, Job-API). Abschnitte 4.2, 4.4 und 4.5 gelten für beide.
- **Nicht-destruktiv:** Das Original und alle anderen Ebenen bleiben unverändert. Die ML-Ebene enthält nur ihr eigenes, gecachtes Ergebnis.
- Optisch klar erkennbar (eigenes Symbol, Kennzeichnung „ML“).

### 4.2 Ein- und Ausschalten
- Jede ML-Ebene ist **jederzeit ein- und ausschaltbar**. Ausgeschaltet verhält sich der Stapel exakt so, als gäbe es die Ebene nicht (pixelgenau).
- Ausschalten verwirft das Ergebnis **nicht**; Wiedereinschalten zeigt sofort das gecachte Ergebnis ohne Neuberechnung.
- Globaler Schalter **„Alle ML-Ebenen aus“**, z. B. zum schnellen Vergleich oder wenn kein Modell verfügbar ist.
- Projekte mit ML-Ebenen lassen sich auch öffnen und bearbeiten, wenn das Modell gerade fehlt. Die gecachten Ergebnisse bleiben nutzbar, nur Neuberechnung ist dann gesperrt.

### 4.3 Inhalt einer Bearbeitungs-Ebene
- **Prompt** (Text)
- **Modus:** „Bearbeiten“ (Standard, Verfahren nach 5.1), „Füllen (Inpaint)“ (nach 5.7, nur mit Maske) oder „Erweitern (Outpaint)“ (nach 5.9, nur wenn die Leinwand größer ist als die Bildebene)
- **Quelle:** alle darunterliegenden Ebenen zusammengeführt (Standard) oder eine bestimmte Ebene
- **Maske** (optional beim Bearbeiten, Pflicht beim Füllen): begrenzt die Änderung; nutzt alle vorhandenen Maskenquellen (Pinsel, Analysekarten, Klick-Segmentierung)
- **Referenzbilder** (optional, Anzahl nach Modellfähigkeit): Stilvorlage, Objekt, Farbstimmung
- **Modell** (Standard oder Auswahl), **Seed**, modellspezifische Parameter (nur anbieten, was das Modell unterstützt)
- Deckkraft, Blend-Mode wie bei anderen Ebenen
- **Ergebnis** (gecacht) und **Verlauf** aller Varianten

### 4.4 Neuberechnung
- Eine ML-Ebene wird **nur auf ausdrückliche Aktion** neu berechnet („Ausführen“), nicht automatisch, wenn sich darunterliegende Ebenen ändern. Ändert sich die Quelle, zeigt die Ebene den Hinweis „Quelle geändert – neu berechnen?“.
- Begründung: Neuberechnungen sind teuer, und das Ergebnis eines generativen Modells soll nicht unbemerkt wechseln.

### 4.5 Zusammenspiel
- Darüberliegende Effekt-Ebenen wirken auf das Ergebnis der ML-Ebene wie auf jede andere Ebene.
- Funktioniert mit PSD-Export (gerasterte Ebene mit Maske, Ebenenname mit Kennzeichnung „ML“; ausgeschaltete ML-Ebenen werden als ausgeblendete Ebene exportiert), Parallax-Vorschau und Malplan.
- Ausführung als Job über die bestehende Job-API (Fortschritt, Abbruch, Cache).

### 4.6 Die Generierungs-Ebene (Text-zu-Bild)

Zweite ML-Ebenenart: erzeugt ein neues Bild allein aus Prompt und optionalen Referenzbildern, **ohne Quellbild**. Standardmodell: FLUX.2 [klein] 9B über die Rolle `image-generate`.

**Inhalt:**
- **Prompt** (Deutsch oder Englisch, siehe 5.6)
- **Format:** Seitenverhältnis (Standard: das der Arbeitsfläche; frei wählbar) und Zielgröße innerhalb der vom Modell sinnvoll unterstützten Auflösung (ca. 1–4 MP; die Obergrenze wird aus dem Modelleintrag bzw. M0 übernommen)
- **Referenzbilder** (optional, Anzahl nach Modellfähigkeit), mit den Hinweisen aus 5.5
- **Modell** (Standard oder Auswahl), **Seed**, modellspezifische Parameter (nur anbieten, was das Modell unterstützt)
- **Maske** (optional): bestimmt, wo das generierte Bild sichtbar ist (z. B. nur als Hintergrund hinter einer freigestellten Person)
- **Platzierung:** füllt standardmäßig die Arbeitsfläche; alternativ frei positionier- und skalierbar wie ein Bildobjekt
- Deckkraft, Blend-Mode wie bei anderen Ebenen
- **Ergebnis** (gecacht) und **Verlauf** aller Prompts und Varianten

**Verhalten:**
- Varianten, Verlauf, Ein-/Ausschalten, globaler Schalter, Neuberechnung nur auf Aktion und Job-API wie bei der Bearbeitungs-Ebene (4.2, 4.4, 5.2).
- **Auflösung:** Das Ergebnis entsteht in Modellauflösung und wird über die Rolle `upscale` (oder klassisches Hochskalieren) auf die Zielgröße gebracht. Der Hinweis „Details wurden hochgerechnet“ wird angezeigt, wenn die Zielgröße die Modellauflösung deutlich übersteigt.
- **Weiterverwenden:** Eine Variante lässt sich (a) als Quelle einer neuen Bearbeitungs-Ebene verwenden, (b) in eine normale Bildebene umwandeln (löst die Verbindung zu Prompt und Modell, Herkunftsangabe bleibt in den Metadaten) oder (c) als PNG exportieren.
- **Zusammenspiel:** Effekte, Masken und Gruppen wirken auf eine Generierungs-Ebene wie auf jede andere Ebene. PSD-Export, Parallax-Vorschau und Malplan funktionieren wie bei der Bearbeitungs-Ebene (4.5).
- **Typische Einsätze:** Hintergründe, Texturen und Materialien als Ausgangsmaterial, Referenzbilder für den Malplan, Rohmaterial für Collagen.

---

## 5. Prompt-Bearbeitung im Detail

### 5.1 Auflösungsstrategie (bis 24 MP)
Bildbearbeitungsmodelle arbeiten nur bei ca. 1–4 MP. Daher:
1. **Regional (Standard bei Maske):** Bounding-Box der Maske plus einstellbarer Rand ausschneiden, auf Modellauflösung bringen, bearbeiten, über die Rolle `upscale` (oder klassisches Hochskalieren, falls kein Modell gewählt) auf Originalgröße zurückbringen und **nur innerhalb der Maske** mit weicher Kante einsetzen. Farb- und Helligkeitsangleich an den Übergängen.
2. **Ganzes Bild:** auf Modellauflösung verkleinern, bearbeiten, hochskalieren. Option „nur geänderte Bereiche übernehmen“ (Differenzmaske), damit unveränderte Bereiche die Originalschärfe behalten.
3. Ist der maskierte Bereich zu groß für die Modellauflösung, Hinweis anzeigen und Strategie 2 anbieten. Kachelung ist eine spätere Option (Nahtkonsistenz ist schwierig).

### 5.2 Varianten & Verlauf
- Pro Ausführung N Varianten (Standard 4) mit unterschiedlichen Seeds, als Kacheln zur Auswahl.
- Verlauf aller Prompts und Varianten pro Ebene; jede Variante wiederherstellbar.

### 5.3 Iteratives Arbeiten
- „Weiter bearbeiten“: eine Variante als Quelle für eine **neue ML-Ebene darüber** verwenden. So bleibt jeder Schritt einzeln ein- und ausschaltbar.

### 5.4 Prompt-Bibliothek
- Prompts als Vorlagen speichern (Name, Text, empfohlene Referenzbilder, Maskenhinweis).
- Mitgelieferte Beispiele für künstlerische Zwecke: Lichtstimmungen, Wetter, Jahreszeiten, Materialien, Hintergründe.

### 5.5 Mehrere Referenzbilder
- Referenzbilder werden in der Ebene verwaltet (hinzufügen, entfernen, Reihenfolge), mit kurzer Beschreibung, wofür sie dienen.
- Hinweis beim Hinzufügen: Für verkaufte Werke nur eigene oder lizenzfreie Referenzbilder verwenden.

### 5.6 Sprache der Prompts
- Unterstützte Prompt-Sprachen: **nur Deutsch und Englisch**. Weitere Sprachen werden nicht unterstützt.
- Englische Prompts gehen unverändert an das Modell.
- In M0 wird getestet, wie gut das Standardmodell deutsche Prompts versteht.
- Falls nötig: optionale Übersetzung Deutsch → Englisch (Rolle `translate`); der übersetzte Prompt wird angezeigt und ist editierbar. Die Spracherkennung muss nur zwischen Deutsch und Englisch unterscheiden; zusätzlich manuell umschaltbar.
- Gilt für Bearbeitungs-, Generierungs- und Inpainting-Prompts gleichermaßen.

### 5.7 Inpainting mit Pinselmaske

**Ziel:** Einen mit dem Pinsel markierten Bereich gezielt ersetzen, entfernen oder anpassen, ohne den Rest des Bildes zu verändern.

**Maske:**
- Pinselwerkzeug mit einstellbarer Größe, Härte und Deckkraft sowie Radiergummi; Zoomen und Verschieben beim Malen.
- Weitere Maskenquellen wie überall im Tool (Analysekarten, Klick-Segmentierung), kombinierbar mit dem Pinsel (hinzufügen/abziehen).
- Maske **invertieren**, **ausdehnen/verkleinern** und **Kante weichzeichnen** (Weichheit einstellbar). Eine leicht ausgedehnte Maske verbessert meist die Übergänge.
- Maskenvorschau als Überlagerung (Farbe und Deckkraft wählbar).

**Verwendungszwecke (über den Prompt):**
- **Entfernen:** leerer Prompt oder „entferne das Objekt“, der Bereich wird passend zur Umgebung gefüllt.
- **Ersetzen oder Hinzufügen:** Prompt beschreibt, was im markierten Bereich entstehen soll.
- **Anpassen:** Prompt beschreibt die Änderung (Farbe, Material, Licht) im markierten Bereich.

**Verfahren:**
1. Ist ein Modell für die Rolle `inpaint` belegt, wird es verwendet. Es bekommt Bildausschnitt, Maske und Prompt.
2. Ist **keines** belegt, greift das Standardverfahren aus 5.1 mit der Rolle `image-edit`. Das Tool weist darauf hin, dass die Übergänge dann stärker von Rand und Farbangleich abhängen.
3. In beiden Fällen: Ausschnitt = Bounding-Box der Maske plus einstellbarer **Kontextrand**, Bearbeitung in Modellauflösung, Rückführung über `upscale`, Einsetzen **nur innerhalb der Maske** (mit weicher Kante) sowie Farb- und Helligkeitsangleich an den Übergängen (wie 5.1).
4. Bereiche außerhalb der Maske samt weicher Kante bleiben **pixelgenau** unverändert.

**Mehrere Eingriffe:** Jeder Inpainting-Eingriff ist eine eigene Bearbeitungs-Ebene im Modus „Füllen“ mit eigener Maske, Prompt, Seed und Varianten. So lässt sich jeder Eingriff einzeln ein- und ausschalten, wiederholen oder löschen.

**Modellwahl und Lizenz:**
- Das Füllmodell wird, wie alle Modelle, frei in der Modellverwaltung registriert und vom Speicherort genutzt (3.1, 3.5). **Es wird nichts mitgeliefert und nichts automatisch geladen.**
- Ein mögliches Modell ist **FLUX.1 Fill** von Black Forest Labs. Lizenz von Code **und** Gewichten ist vor der Registrierung zu prüfen und im Modelleintrag zu hinterlegen. `outputCommercialUse` stufe ich selbst ein (2.2).
- Füllmodelle sind in der Regel größer als FLUX.2 [klein] 9B. Der tatsächliche Speicherbedarf auf dem MacBook wird gemessen (siehe Abschnitt 10).

### 5.8 Leinwand vergrößern (Basisfunktion, ohne ML)

Bisher ist die Leinwand so groß wie das erste Bild und lässt sich nicht ändern. Diese Basisfunktion ändert das und ist **unabhängig von ML** nutzbar (Phase M1b).

- **Dialog „Leinwand“:** neue Größe in px oder Rand je Seite (oben, unten, links, rechts; px oder %), Seitenverhältnis-Vorgaben (z. B. 1:1, 4:5, 3:2, 16:9), **Ankerpunkt** (neun Positionen: wohin das bisherige Bild wandert), Hintergrund der neuen Fläche (transparent oder Farbe). Vorschau mit Rahmen, Zahlenangabe der neuen Größe in px und MP.
- **Verhalten:** Alle Ebenen behalten ihre Lage relativ zum Bild (Transformationen werden um den Versatz des Ankers verschoben, nicht verzerrt). Ebenenmasken, Fokuspunkte, Striche und Markierungen verschieben sich mit. Effekte arbeiten im Leinwandraum und sehen die größere Leinwand; Effekte mit Leinwandbezug (z. B. Vignette, Verlauf, Lichtleck) passen sich an die neue Größe an (Hinweis darauf im Dialog).
- **Nicht-destruktiv und rückgängig:** ein Verlaufseintrag; Verkleinern zurück ist möglich (Bildteile außerhalb der Leinwand bleiben erhalten, solange nicht exportiert wird).
- **Grenzen:** Warnung ab 24 MP (Zielgröße der App), harte Grenze durch das GPU-Limit; die Leinwand kann nicht kleiner als 64 px werden.
- **Zusammenspiel:** Malplan (Format und Zuschnitt werden neu berechnet), Parallax, PSD- und PNG-Export (neue Größe; die neue Fläche ist transparent oder in der gewählten Farbe), Projektdatei (Projektformat erhöhen, Migration).
- **Ohne ML nutzbar:** Die neue Fläche kann auch klassisch gefüllt werden (Farbe, bestehende Lochfüllung Push-Pull als „Rand fortsetzen“).

### 5.9 Outpainting (Modus „Erweitern“)

**Ziel:** Die durch 5.8 neu entstandene Fläche vom Modell passend zur Szene füllen lassen, ohne das vorhandene Bild zu verändern.

**Maske und Kontext:**
- Die Maske ist **automatisch die neue Fläche** (alles außerhalb der bisherigen Bildfläche) plus ein einstellbarer **Überlappungsrand** ins vorhandene Bild (Standard z. B. 64 px bei 1 MP Arbeitsauflösung), damit die Kante zusammenwächst. Der Überlappungsrand kann zusätzlich pinselmaskiert werden; Weichheit der Kante einstellbar.
- Bereiche des vorhandenen Bildes außerhalb von Überlappungsrand und weicher Kante bleiben **pixelgenau** unverändert.

**Prompt:**
- Leer = „setze die Szene natürlich fort“ (Standardprompt, anpassbar). Mit Prompt kann die Erweiterung gelenkt werden („mehr Himmel mit Wolken“, „der Raum setzt sich fort“). Sprachen wie 5.6.

**Verfahren:**
1. Ausschnitt = neue Fläche plus Überlappungsrand plus Kontextrand (vorhandenes Bild), auf Modellauflösung gebracht. Eine klassische Vorfüllung der neuen Fläche (Push-Pull, „Rand fortsetzen“) dient als Startbild, damit Farben und Helligkeit stimmen.
2. Bearbeitung mit der Rolle `inpaint` (falls belegt) oder `image-edit` (Standardverfahren aus 5.1/5.7). Rückführung über `upscale`, Einsetzen nur in der Maske mit weicher Kante, Farb- und Helligkeitsangleich an den Übergängen.
3. **Große Erweiterungen:** Ist die neue Fläche größer als ein Modellausschnitt (z. B. die Leinwand wird verdoppelt), wird **schrittweise** erweitert: Streifen je Seite in Schritten von höchstens der Hälfte des Modellausschnitts, jeweils mit dem vorherigen Ergebnis als Kontext (Zeit und Drift steigen; Hinweis im Dialog). Mehrere Seiten werden nacheinander gefüllt (einstellbare Reihenfolge, Standard: größte Seite zuerst).
4. **Varianten und Verlauf** wie bei jeder Bearbeitungs-Ebene (5.2). Jede Seite oder jeder Schritt darf einzeln neu berechnet werden.

**Als ML-Ebene:**
- Outpainting ist eine **Bearbeitungs-Ebene im Modus „Erweitern“** (4.3): ein-/ausschaltbar, Cache, Neuberechnung nur auf Aktion, Seed, Varianten. Ausgeschaltet bleibt die vergrößerte Leinwand mit unveränderter (transparenter oder farbiger) neuer Fläche, die übrigen Ebenen sind unberührt.
- Im Dialog „Leinwand“ gibt es zusätzlich den Knopf **„Vergrößern und erweitern“**: vergrößert die Leinwand und legt direkt die Erweiterungs-Ebene an (Modell vorausgesetzt, sonst nur die Vergrößerung).
- Mehrere Erweiterungen hintereinander (z. B. zuerst oben, später links) sind je eine eigene Ebene.

**Grenzen (zu dokumentieren):** Nahtlosigkeit, Perspektive und Stil lassen sich nur begrenzt garantieren; sehr große Erweiterungen driften. Die Erweiterung ist generiert, nicht fotografiert (Kennzeichnung im Herkunftsnachweis nach 2.3).

### 5.10 Anwendungsfall Stil-Übertragung

Die Bearbeitungs-Ebene mit Referenzbild ist die Grundlage einer **Stil-Übertragung** per Modell (Referenz = Stilbild). Umgesetzt wird sie zuerst als Effekt „Stil übertragen (FLUX)“ (Modellort in den Einstellungen, Prompt-Vorlagen, manuelles „Aktualisieren“, Verlauf als Ebenen). Sie nutzt dieselbe Modellverwaltung und ML-Dienst-API wie die ML-Ebenen und lässt sich später in die Bearbeitungs-Ebene überführen.

---

## 6. Nicht-funktionale Anforderungen

- **Keine Regressionen:** Die gesamte bestehende Testsuite muss nach jeder Phase grün sein. Bestehende Projektdateien ohne ML-Ebenen öffnen und exportieren sich unverändert.
- **Projektdatei-Kompatibilität:** Neue Felder werden additiv ergänzt; Versionsnummer wird erhöht, Migration vorhanden. Ältere Programmversionen müssen neue Projekte nicht öffnen können, aber das Programm darf bei unbekannten Ebenenarten nicht abstürzen.
- **Isolation:** Fehler im ML-Teil (Modell fehlt, Speicher voll, Absturz der Inferenz) dürfen den Rest des Programms nicht beeinträchtigen. Fehlermeldungen klar und auf Deutsch.
- **Keine Modelldateien im Repo oder Tool-Verzeichnis.** `.gitignore` und Build-Skripte schließen versehentliches Einchecken oder Kopieren aus.
- **Keine stillen Netzwerkzugriffe** durch ML-Bibliotheken (Offline-Modus erzwingen, außer bei `remote-api` und explizitem Download).
- **Abschaltbar:** Der ML-Teil lässt sich per Konfiguration komplett deaktivieren; das Programm verhält sich dann exakt wie vorher.
- **Tests:** Modellverwaltung und ML-Ebene werden mit Mocks bzw. Mini-Modellen getestet, damit Tests ohne die großen Modelle laufen. Integrationstests mit echten Modellen separat startbar.
- **Leinwandgröße:** Vergrößern ist bis zur GPU-Grenze möglich; ab 24 MP weist das Tool darauf hin. Outpainting-Zeit wächst mit der Zahl der Schritte (5.9, Punkt 3).
- **Performance-Ziel:** Auf der festgelegten Hardware (MacBook Pro M4, Abschnitt 10) eine Variante in möglichst unter 60 Sekunden; die tatsächlich erreichbaren Werte werden in M0 gemessen und das Ziel danach angepasst. Die Oberfläche bleibt während der Berechnung voll bedienbar.

---

## 7. Akzeptanzkriterien (gesamt)
- Mit Maske bearbeitete Bereiche fügen sich ohne sichtbare Kanten oder Farbsprünge ein; außerhalb der Maske bleibt das Bild **pixelgenau** unverändert.
- Eine ausgeschaltete ML-Ebene verändert das Gesamtbild **pixelgenau nicht**.
- Ein 24-MP-Foto lässt sich regional bearbeiten und in voller Auflösung exportieren (PNG und PSD).
- Gleicher Prompt + gleiches Modell (gleicher Fingerprint) + gleicher Seed + gleiche Parameter ergeben dasselbe Ergebnis, im Rahmen der Determinismus-Grenzen der Hardware (Abweichungen dokumentieren).
- Wechsel des `image-edit`-, `image-generate`- oder `inpaint`-Modells funktioniert ohne Codeänderung, sofern das Backend unterstützt wird.
- **Generierung:** Eine Generierungs-Ebene erzeugt aus einem deutschen oder englischen Prompt ein Bild im gewählten Format, lässt sich ein- und ausschalten, mit Effekten und Masken kombinieren und in voller Zielgröße exportieren (PNG und PSD). Eine ausgeschaltete Generierungs-Ebene verändert das Gesamtbild pixelgenau nicht.
- **Inpainting:** Ein mit dem Pinsel markierter Bereich (z. B. ein Objekt) lässt sich entfernen und ersetzen, ohne sichtbare Kanten oder Farbsprünge; außerhalb der Maske bleibt das Bild pixelgenau unverändert. Das gilt mit und ohne belegte Rolle `inpaint` (ohne: Standardverfahren, ggf. mit stärkeren Übergängen, die als bekannte Einschränkung dokumentiert werden).
- **Leinwand vergrößern:** Die Leinwand lässt sich mit Anker und Rand/Zielgröße vergrößern; alle Ebenen bleiben relativ zum Bild an ihrer Stelle, Undo stellt die alte Größe pixelgleich her, Export (PNG und PSD) hat die neue Größe, Projekte von früher öffnen sich unverändert.
- **Outpainting:** Die neue Fläche wird vom Modell passend zur Szene gefüllt; das vorhandene Bild außerhalb von Überlappungsrand und weicher Kante bleibt **pixelgenau** unverändert; ausgeschaltet verändert die ML-Ebene das Gesamtbild nicht (nur die leere Fläche bleibt); größere Erweiterungen laufen schrittweise ohne sichtbare Nähte zwischen den Schritten.
- Ein Modell auf einer externen Platte wird registriert und genutzt; nach Abziehen der Platte wird es sauber als „nicht verfügbar“ angezeigt, das Programm läuft weiter. Im Tool-Verzeichnis liegt zu keinem Zeitpunkt eine Kopie.
- Alle bisherigen Funktionen und Tests laufen unverändert.

---

## 8. Phasenplan

Jede Phase endet mit: lauffähigem Stand, grüner Testsuite (alt und neu), kurzer Änderungsnotiz, Demo-Liste.

### Phase M0 – Analyse & Machbarkeit (kein Produktivcode)
- Bestand analysieren: Ebenenmodell und Erweiterbarkeit, Job-API, Python-Dienst, vorhandene ML-Anbindung, Projektdateiformat, PSD-Export, Malplan-Schnittstellen.
- Benennen, wo die ML-Ebene andockt und welche minimalen Eingriffe in bestehenden Code nötig sind, mit Risikobewertung.
- Hardware-Details ermitteln (MacBook Pro M4, Größe des Arbeitsspeichers, verfügbare MPS-Unterstützung der Bibliotheken); kleiner Prototyp außerhalb des Hauptcodes: FLUX.2 [klein] 9B von seinem Pfad laden, eine Bearbeitung über MPS ausführen, Zeit und Speicher messen, ggf. Varianten mit Quantisierung/Offloading vergleichen, deutsche Prompts testen. Zusätzlich im Prototyp: eine reine Text-zu-Bild-Erzeugung mit demselben Modell (Zeit, Speicher, Qualität).
- Zusätzlich im Prototyp: Outpainting-Test (Foto um 25 % erweitern, mit und ohne Vorfüllung, mit `image-edit`) und Style-Transfer-Test (Referenzbild, Prompt-Vorlagen).
- Vorschläge zu den offenen Entscheidungen (Abschnitt 9).
**Abnahme:** Bericht mit Andockpunkten, Risiken, Messwerten und Entscheidungsvorschlägen. Freigabe durch mich.

### Phase M1 – Modellverwaltung
- Konfiguration, Rollen, Registrierung, Pfadprüfung, Fingerprint, Lazy Loading, Speicherbudget, Offline-Modus, UI „Modelle“, Ordner-Browser.
- Erweiterung des Umschalters nach Abschnitt 2.2 (nur für neu registrierte Modelle).
**Abnahme:** FLUX.2 [klein] 9B ist von seinem Speicherort registriert und testgeladen; externe-Platte-Szenario funktioniert; keine Kopie im Tool-Verzeichnis; bestehende Funktionen unverändert.

### Phase M1b – Leinwand vergrößern (Basisfunktion, ohne ML)
Unabhängig von den ML-Modellen und daher vor M2 (und auch vor M1) lieferbar; Voraussetzung für das Outpainting.
- Dialog „Leinwand“ (5.8): Größe/Rand, Anker, Seitenverhältnis-Vorgaben, Hintergrund, Vorschau, Warnungen.
- Verschieben aller Ebenen, Masken, Fokuspunkte, Striche und Markierungen um den Ankerversatz; Anpassung leinwandbezogener Effekte.
- Verlauf/Undo, Projektformat erhöhen mit Migration, Export (PNG/PSD), Malplan-Neuberechnung, Parallax.
- Klassische Füllung der neuen Fläche („Rand fortsetzen“, Farbe) als Option.
**Abnahme:** Die Leinwand eines Porträts wird um 25 % nach rechts und 20 % nach oben vergrößert (Anker unten links): Ebenen bleiben an ihrer Stelle, PNG/PSD haben die neue Größe, Undo ist pixelgleich, alte Projekte öffnen sich unverändert, Testsuite grün.

### Phase M2 – ML-Ebenen: Bearbeiten und Generieren
Reihenfolge innerhalb der Phase: **zuerst M2a abnehmen, dann M2b**.

**M2a – Bearbeitungs-Ebene**
- Ebenenart „ML-Ebene“ (Bearbeiten) mit Ein-/Ausschalten, globalem Schalter, Cache, Neuberechnung auf Aktion.
- Prompt, Pinselmaske und weitere Maskenquellen, Referenzbilder, Seed, Varianten, Verlauf, iteratives Arbeiten.
- Auflösungsstrategie inkl. Rolle `upscale`.
- Modus „Erweitern“ (Outpainting, 5.9) auf der Grundlage von M1b: automatische Maske aus der neuen Fläche, Überlappungsrand, schrittweise Erweiterung, Knopf „Vergrößern und erweitern“.
- Integration in PSD-Export, Parallax-Vorschau, Malplan, Projektdatei.

**M2b – Generierungs-Ebene**
- Rolle `image-generate`, Ebenenart „Generierungs-Ebene“ (4.6) auf der gemeinsamen ML-Grundlogik.
- Format- und Zielgrößenwahl, Platzierung, Umwandlung in normale Bildebene, Export.
- Integration in PSD-Export, Parallax-Vorschau, Malplan, Projektdatei.

**Abnahme:** Akzeptanzkriterien aus Abschnitt 7 für Bearbeiten und Generieren (der Teil zum Inpainting mit eigenem Füllmodell gehört zu M3; Outpainting mit `image-edit` gehört zu M2a; das Standardverfahren aus 5.1/5.7 Punkt 2 gehört bereits zu M2a).

### Phase M3 – Ausbau (optional, einzeln freizugeben)
- **Outpainting mit eigenem Füllmodell** (Rolle `inpaint`) und weitere Verbesserungen der schrittweisen Erweiterung
- **Inpainting mit eigenem Füllmodell:** Rolle `inpaint`, Modus „Füllen“ komplett nach 5.7 (Maskenwerkzeuge, Kontextrand, Maske ausdehnen/weichzeichnen, Modellanbindung auf dem M4). Hängt vom Messergebnis zum Speicherbedarf ab.
- Prompt-Bibliothek mit Beispielen
- Prompt-Übersetzung (Rolle `translate`), falls in M0 als nötig ermittelt
- Backend `remote-api`
- Herkunftsnachweis-Export pro Werk
- Optionale Übernahme der bestehenden ML-Funktionen (Tiefe, Segmentierung usw.) in die Modellverwaltung, nur wenn ohne Risiko möglich
- Weitere Backends (z. B. ONNX, GGUF)

---

## 9. Offene Entscheidungen (vor Umsetzung vorlegen)
1. **Andockpunkt der ML-Ebene** im bestehenden Ebenenmodell und nötige Eingriffe, mit Risikobewertung.
2. **Standardwerte für FLUX.2 [klein] 9B auf der festgelegten Hardware** (Abschnitt 10): Präzision, Quantisierung, Offloading, ggf. alternative Laufzeit (PyTorch/MPS oder eine Apple-Silicon-optimierte Implementierung, falls verfügbar und lizenzrechtlich passend), gemessen in M0.
3. **Unterstützte Backends** in M1/M2 (Vorschlag: Diffusers-Ordner und einzelne Safetensors-Dateien).
4. **Upscaler:** Verfahren bzw. Modell als Standard, mit Lizenzangabe.
5. **Prompt-Übersetzung:** Unterstützte Prompt-Sprachen sind **nur Deutsch und Englisch** (festgelegt, siehe 5.6). Offen ist nur, ob deutsche Prompts übersetzt werden müssen und wie (Ergebnis aus M0).
6. **Ordner-Browser:** freigegebene Basisordner und Absicherung.
7. ~~Container ja/nein~~ – entschieden: Der Python-Dienst läuft **nativ auf macOS** (siehe Abschnitt 10).
8. **Inpainting-Modell:** Ob ein eigenes Füllmodell überhaupt nötig ist oder das Standardverfahren mit `image-edit` ausreicht. Falls ja: welches Modell (z. B. FLUX.1 Fill), Lizenz von Code und Gewichten, Speicherbedarf und Geschwindigkeit auf dem M4. Empfehlung aus Messungen in M0/M3.
9. **Generierung:** Standardformat und maximale Zielgröße der Generierungs-Ebene, Umgang mit Zielgrößen über der Modellauflösung (Hochskalieren ja/nein, Hinweis).
10. **Leinwandmodell (M1b):** Wie wird die Vergrößerung im Projekt abgebildet (Versatz aller Transformationen oder ein Leinwand-Ursprung im Projekt), maximale Größe, Verhalten leinwandbezogener Effekte. Vorschlag in M0.
11. **Outpainting:** Standardüberlappung, maximale Schrittweite, Reihenfolge der Seiten, ob die klassische Vorfüllung (Push-Pull) als Startbild die Ergebnisse verbessert; Messung in M0 (Prototyp: Erweiterung eines Fotos um 25 % mit FLUX.2 klein).
---

## 10. Festgelegte Hardware

- **Rechner:** MacBook Pro mit Apple M4. Der Python-Dienst läuft auf diesem Rechner.
- **Beschleuniger:** Apple GPU über **MPS** (Metal). Kein CUDA. CPU-Fallback bleibt vorhanden.
- **Arbeitsspeicher (Unified Memory):** genaue Größe in M0 ermitteln und im Bericht nennen. Sie entscheidet, ob FLUX.2 [klein] 9B in bf16 komplett passt (Modell inkl. Text-Encoder benötigt grob um die 30 GB) oder ob Quantisierung bzw. Offloading nötig ist.
- **Kein Docker für den ML-Teil:** Container auf macOS haben keinen Zugriff auf die Apple-GPU. Der Python-Dienst bzw. zumindest sein ML-Teil läuft daher nativ (z. B. in einer virtuellen Umgebung). Abschnitt 3.5 zum Container entfällt damit.
- **Speicher sparen:** Text-Encoder nach dem Kodieren des Prompts entladen bzw. auslagern, damit Transformer und VAE mehr Platz haben. Prompt-Kodierungen cachen (gleicher Prompt → keine erneute Kodierung).
- **Systemstabilität:** Das Speicherbudget aus 3.7 so wählen, dass macOS nicht ins starke Auslagern (Swap) gerät; Bearbeitung lieber ablehnen bzw. quantisiert ausführen als den Rechner einfrieren.
- **Erwartete Geschwindigkeit:** deutlich langsamer als auf einer großen NVIDIA-GPU. Realistisch eher im Bereich von einigen zehn Sekunden pro Variante statt unter einer Sekunde; tatsächliche Werte in M0 messen. Varianten werden nacheinander berechnet, die erste wird angezeigt, sobald sie fertig ist.
- **Mac im Akkubetrieb/Thermik:** Lange Läufe können gedrosselt werden; Fortschrittsanzeige und Abbruch (Job-API) sind deshalb Pflicht.
