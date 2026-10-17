# Spec: ML-Fotobearbeitung mit Prompts
## artistic-photo-renderer – Blur & Layer Studio (eigenständige Erweiterung)

Version 1.0 · Stand: 17.10.2026
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

Fotos per Texteingabe mit einem ML-Bildbearbeitungsmodell verändern, zum Beispiel:
- „mach den Himmel zu einem Gewittersturm“
- „ersetze den Hintergrund durch einen Wald im Nebel“
- „gib der Szene das Licht eines Sonnenuntergangs“

Die Änderungen leben in einer **eigenen Ebenenart (ML-Ebene)**, die jederzeit ein- und ausgeschaltet werden kann und mit allen vorhandenen Ebenen, Masken, Effekten, Exporten und dem Malplan zusammenarbeitet.

Standardmodell: **FLUX.2 [klein] 9B** (Black Forest Labs), austauschbar.

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

---

## 3. Modellverwaltung

### 3.1 Grundsatz
- ML-Modelle sind **frei wählbar**. Das Tool kennt **Rollen**, für die ich Modelle auswähle.
- Modelle werden **dort verwendet, wo sie liegen**. Sie werden **niemals** in das Tool-Verzeichnis kopiert, verschoben oder dupliziert.
- Das Tool lädt **nichts automatisch aus dem Internet** herunter. Downloads nur auf ausdrückliche Aktion und nur in einen von mir gewählten Ordner.

### 3.2 Rollen
| Rolle | Wofür |
|---|---|
| `image-edit` | Prompt-basierte Bildbearbeitung (ML-Ebene) |
| `upscale` | Hochskalieren der Modellergebnisse auf Originalauflösung |
| `translate` | (optional) Übersetzung deutscher Prompts, siehe 5.6 |

Pro Rolle kann es **mehrere registrierte Modelle** geben, eines davon als Standard. Jede ML-Ebene kann ein anderes Modell wählen.

**Bestehende ML-Funktionen** (Tiefe, Segmentierung, Saliency, Gesichter, Style-Transfer aus der Effekt-Spec) bleiben, wie sie sind. Eine spätere Übernahme in diese Modellverwaltung ist optional (Phase M3) und nur, wenn sie ohne Risiko möglich ist.

### 3.3 Modell-Eintrag (Vorschlag)

```yaml
- id: flux2-klein-9b                 # frei vergebener, eindeutiger Name
  name: "FLUX.2 [klein] 9B"
  role: image-edit
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
  isDefaultForRole: true
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
- Neue Ebenenart **„ML-Ebene“**, eingebaut über den vorhandenen Erweiterungsmechanismus für Ebenen bzw. Effekte. Ist keiner vorhanden, wird er minimal-invasiv ergänzt (in M0 vorlegen).
- **Nicht-destruktiv:** Das Original und alle anderen Ebenen bleiben unverändert. Die ML-Ebene enthält nur ihr eigenes, gecachtes Ergebnis.
- Optisch klar erkennbar (eigenes Symbol, Kennzeichnung „ML“).

### 4.2 Ein- und Ausschalten
- Jede ML-Ebene ist **jederzeit ein- und ausschaltbar**. Ausgeschaltet verhält sich der Stapel exakt so, als gäbe es die Ebene nicht (pixelgenau).
- Ausschalten verwirft das Ergebnis **nicht**; Wiedereinschalten zeigt sofort das gecachte Ergebnis ohne Neuberechnung.
- Globaler Schalter **„Alle ML-Ebenen aus“**, z. B. zum schnellen Vergleich oder wenn kein Modell verfügbar ist.
- Projekte mit ML-Ebenen lassen sich auch öffnen und bearbeiten, wenn das Modell gerade fehlt. Die gecachten Ergebnisse bleiben nutzbar, nur Neuberechnung ist dann gesperrt.

### 4.3 Inhalt einer ML-Ebene
- **Prompt** (Text)
- **Quelle:** alle darunterliegenden Ebenen zusammengeführt (Standard) oder eine bestimmte Ebene
- **Maske** (optional): begrenzt die Änderung; nutzt alle vorhandenen Maskenquellen (Pinsel, Analysekarten, Klick-Segmentierung)
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
- Eingabe auf Deutsch soll möglich sein. In M0 wird getestet, wie gut das Standardmodell deutsche Prompts versteht.
- Falls nötig: optionale Übersetzung ins Englische (Rolle `translate`); der übersetzte Prompt wird angezeigt und ist editierbar.

---

## 6. Nicht-funktionale Anforderungen

- **Keine Regressionen:** Die gesamte bestehende Testsuite muss nach jeder Phase grün sein. Bestehende Projektdateien ohne ML-Ebenen öffnen und exportieren sich unverändert.
- **Projektdatei-Kompatibilität:** Neue Felder werden additiv ergänzt; Versionsnummer wird erhöht, Migration vorhanden. Ältere Programmversionen müssen neue Projekte nicht öffnen können, aber das Programm darf bei unbekannten Ebenenarten nicht abstürzen.
- **Isolation:** Fehler im ML-Teil (Modell fehlt, Speicher voll, Absturz der Inferenz) dürfen den Rest des Programms nicht beeinträchtigen. Fehlermeldungen klar und auf Deutsch.
- **Keine Modelldateien im Repo oder Tool-Verzeichnis.** `.gitignore` und Build-Skripte schließen versehentliches Einchecken oder Kopieren aus.
- **Keine stillen Netzwerkzugriffe** durch ML-Bibliotheken (Offline-Modus erzwingen, außer bei `remote-api` und explizitem Download).
- **Abschaltbar:** Der ML-Teil lässt sich per Konfiguration komplett deaktivieren; das Programm verhält sich dann exakt wie vorher.
- **Tests:** Modellverwaltung und ML-Ebene werden mit Mocks bzw. Mini-Modellen getestet, damit Tests ohne die großen Modelle laufen. Integrationstests mit echten Modellen separat startbar.
- **Performance-Ziel:** Eine Bearbeitung mit FLUX.2 [klein] 9B soll auf der vorhandenen Hardware im Bereich weniger Sekunden pro Variante liegen; die tatsächlich erreichbaren Werte werden in M0 ermittelt.

---

## 7. Akzeptanzkriterien (gesamt)
- Mit Maske bearbeitete Bereiche fügen sich ohne sichtbare Kanten oder Farbsprünge ein; außerhalb der Maske bleibt das Bild **pixelgenau** unverändert.
- Eine ausgeschaltete ML-Ebene verändert das Gesamtbild **pixelgenau nicht**.
- Ein 24-MP-Foto lässt sich regional bearbeiten und in voller Auflösung exportieren (PNG und PSD).
- Gleicher Prompt + gleiches Modell (gleicher Fingerprint) + gleicher Seed + gleiche Parameter ergeben dasselbe Ergebnis, im Rahmen der Determinismus-Grenzen der Hardware (Abweichungen dokumentieren).
- Wechsel des `image-edit`-Modells funktioniert ohne Codeänderung, sofern das Backend unterstützt wird.
- Ein Modell auf einer externen Platte wird registriert und genutzt; nach Abziehen der Platte wird es sauber als „nicht verfügbar“ angezeigt, das Programm läuft weiter. Im Tool-Verzeichnis liegt zu keinem Zeitpunkt eine Kopie.
- Alle bisherigen Funktionen und Tests laufen unverändert.

---

## 8. Phasenplan

Jede Phase endet mit: lauffähigem Stand, grüner Testsuite (alt und neu), kurzer Änderungsnotiz, Demo-Liste.

### Phase M0 – Analyse & Machbarkeit (kein Produktivcode)
- Bestand analysieren: Ebenenmodell und Erweiterbarkeit, Job-API, Python-Dienst, vorhandene ML-Anbindung, Projektdateiformat, PSD-Export, Malplan-Schnittstellen.
- Benennen, wo die ML-Ebene andockt und welche minimalen Eingriffe in bestehenden Code nötig sind, mit Risikobewertung.
- Hardware des Python-Dienstes ermitteln; kleiner Prototyp außerhalb des Hauptcodes: FLUX.2 [klein] 9B von seinem Pfad laden, eine Bearbeitung ausführen, Zeit und Speicher messen, deutsche Prompts testen.
- Vorschläge zu den offenen Entscheidungen (Abschnitt 9).
**Abnahme:** Bericht mit Andockpunkten, Risiken, Messwerten und Entscheidungsvorschlägen. Freigabe durch mich.

### Phase M1 – Modellverwaltung
- Konfiguration, Rollen, Registrierung, Pfadprüfung, Fingerprint, Lazy Loading, Speicherbudget, Offline-Modus, UI „Modelle“, Ordner-Browser.
- Erweiterung des Umschalters nach Abschnitt 2.2 (nur für neu registrierte Modelle).
**Abnahme:** FLUX.2 [klein] 9B ist von seinem Speicherort registriert und testgeladen; externe-Platte-Szenario funktioniert; keine Kopie im Tool-Verzeichnis; bestehende Funktionen unverändert.

### Phase M2 – ML-Ebene & Prompt-Bearbeitung
- Ebenenart „ML-Ebene“ mit Ein-/Ausschalten, globalem Schalter, Cache, Neuberechnung auf Aktion.
- Prompt, Maske, Referenzbilder, Seed, Varianten, Verlauf, iteratives Arbeiten.
- Auflösungsstrategie inkl. Rolle `upscale`.
- Integration in PSD-Export, Parallax-Vorschau, Malplan, Projektdatei.
**Abnahme:** Akzeptanzkriterien aus Abschnitt 7.

### Phase M3 – Ausbau (optional, einzeln freizugeben)
- Prompt-Bibliothek mit Beispielen
- Prompt-Übersetzung (Rolle `translate`), falls in M0 als nötig ermittelt
- Backend `remote-api`
- Herkunftsnachweis-Export pro Werk
- Optionale Übernahme der bestehenden ML-Funktionen (Tiefe, Segmentierung usw.) in die Modellverwaltung, nur wenn ohne Risiko möglich
- Weitere Backends (z. B. ONNX, GGUF)

---

## 9. Offene Entscheidungen (vor Umsetzung vorlegen)
1. **Andockpunkt der ML-Ebene** im bestehenden Ebenenmodell und nötige Eingriffe, mit Risikobewertung.
2. **Hardware** für den Python-Dienst und daraus folgende Standardwerte (Präzision, Quantisierung, Offloading) für FLUX.2 [klein] 9B.
3. **Unterstützte Backends** in M1/M2 (Vorschlag: Diffusers-Ordner und einzelne Safetensors-Dateien).
4. **Upscaler:** Verfahren bzw. Modell als Standard, mit Lizenzangabe.
5. **Prompt-Übersetzung** nötig? Wenn ja, wie.
6. **Ordner-Browser:** freigegebene Basisordner und Absicherung.
7. **Container ja/nein** für den Python-Dienst und damit die Pfadzuordnung.
