# Bericht Phase M0 – Analyse und Machbarkeit (ML-Fotobearbeitung)

Stand 07.11.2026 · Grundlage: [spec-ml-fotobearbeitung_v2.md](../spec-ml-fotobearbeitung_v2.md) (Version 1.2).
Hardware: Apple M4 Pro (14 CPU-, 20 GPU-Kerne), **48 GB** Unified Memory, macOS, PyTorch 2.14.1 mit MPS, diffusers 0.42.1.

**Wichtig vorweg:** Das echte Modell FLUX.2 [klein] 9B lag beim Erstellen dieses Berichts **nicht auffindbar** auf dem Rechner
(gesucht: Hugging-Face-Cache, übliche Modellordner; nur CLIP aus einem anderen Projekt). Alle Messwerte zu Zeit und Speicher mit
dem echten Modell **stehen deshalb noch aus**. Das Messskript ist fertig und läuft mit einem Befehl (Abschnitt 4). Mit einem
winzigen, zufällig initialisierten FLUX.2-Pipeline-Ordner ist die gesamte Kette (Laden vom Ordner, Referenzbilder, Größen, Seeds,
Abbruch, API, App) getestet; das beweist die Technik, nicht die Qualität oder die Geschwindigkeit des echten Modells.

## 1. Andockpunkte im Bestand

| Bereich                                     | Befund                                                                                                                                                                                                              | Eingriff für ML-Ebenen                                                                                                                                                                             | Risiko                                                                             |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Ebenenmodell (`SceneNode` = Layer \| Group) | Ein Layer verweist auf ein unveränderliches **Original** (`originalId`); Ergebnisse von ML (LaMa, Stil-Übertragung) lassen sich als weiteres Original im Projekt ablegen und über den vorhandenen Bildpfad rendern. | Neue Ebenenart `ml` als dritte Variante, die (a) Metadaten (Prompt, Modell, Seed, Quelle, Varianten) und (b) ein Ergebnis-Original trägt; Rendern wie eine Bildebene.                              | mittel (Union erweitern: Ebenenliste, Schema, PSD, Malplan prüfen)                 |
| Compositor                                  | Bildebenen, Masken, Mischmodi, Effekte, Transform fertig. `Layer.inpaint` (Phase 6) nutzt bereits „Ergebnisbild als Original“.                                                                                      | Keiner für das Anzeigen; „Quelle = darunterliegende Ebenen zusammengeführt“ über vorhandenes Rendern in eine Textur (`renderRegionImage`/`renderTexture`).                                         | niedrig                                                                            |
| Job-API des Dienstes                        | `JobRunner` (ein Hintergrund-Thread, Fortschritt, Abbruch), Ergebnisse als Bytes mit Kopfzeilen.                                                                                                                    | `/ml/edit` nutzt sie unverändert (umgesetzt).                                                                                                                                                      | niedrig                                                                            |
| Python-Dienst                               | FastAPI, PyTorch/MPS, Modell-Downloads über das Register.                                                                                                                                                           | Neu: ML-Modellverwaltung (Konfiguration in `~/.config/artistic-photo-renderer/models.yaml`, nur Pfade), `DiffusersEngine`. Das Register `models/registry.json` bleibt für die eingebauten Modelle. | niedrig (additiv, eigene Module)                                                   |
| Projektdatei                                | Format 10, optionale Felder, Migration vorhanden.                                                                                                                                                                   | Format 11 für `ml`-Ebene und Herkunftsdaten (Modell-Fingerprint, Seed, Prompt).                                                                                                                    | niedrig                                                                            |
| Pinsel/Masken/SAM                           | Pinsel (Phase 5), Smarte Auswahl, Segmente, Analysekarten.                                                                                                                                                          | Maskenquellen der Bearbeitungs-Ebene wiederverwenden.                                                                                                                                              | niedrig                                                                            |
| PSD-Export, Parallax, Malplan               | Behandeln Bildebenen mit Maske.                                                                                                                                                                                     | `ml`-Ebene als gerasterte Bildebene mit Kennzeichnung „ML“.                                                                                                                                        | niedrig                                                                            |
| **Leinwand**                                | Größe = erstes Bild, **nicht änderbar** (`project.canvas`); Effekte und Malplan beziehen sich auf die Leinwand.                                                                                                     | Neue Basisfunktion (Phase M1b): Versatz aller Transformationen, Ankerpunkt, Warnungen; Voraussetzung für Outpainting.                                                                              | **mittel bis hoch** (berührt Transformationen, Masken-/Fokus-Koordinaten, Malplan) |
| Lizenzumschalter                            | Prüft `commercialUse` des Modells an drei Stellen.                                                                                                                                                                  | Neues Feld `outputCommercialUse` für Modelle der neuen Verwaltung; bestehende Modelle unverändert (umgesetzt für `/ml/edit`).                                                                      | niedrig                                                                            |

**Neu geschaffene allgemeine Bausteine** (klein, ohne Bruch des Bestands): Effekte können ein **Bedienfeld** (`panel`) und
**verborgene Parameter** (`hidden`) deklarieren; der Kern kennt weiterhin keine konkreten Effekte. Textparameter dürfen leer starten.

## 2. Hardware und Speicher (Schätzung, nicht gemessen)

- FLUX.2 [klein] 9B besteht aus Transformer (ca. 9 Mrd. Parameter, bf16 ≈ 18 GB), Textkodierer **Qwen3-8B** (≈ 16 GB bf16) und VAE
  (klein): **≈ 35 GB** Gewichte. Bei 48 GB Unified Memory (≈ 60 % davon ohne Auslagerung nutzbar ≈ 29 GB) passt das **nicht
  bequem komplett** neben macOS, Browser und Dienst.
- Umsetzung: Auslagerung **„automatisch“**: alles im Speicher, wenn die Gewichte ≤ 60 % des Arbeitsspeichers belegen, sonst
  Modell für Modell (`enable_model_cpu_offload`; der Textkodierer wandert nach dem Kodieren des Prompts aus dem GPU-Speicher).
  Beides ist in den Einstellungen wählbar (auch „schichtweise“, sehr langsam).
- Erwartung: einige zehn Sekunden je Variante bei 1 MP (laut Spec); **Messung offen** (Abschnitt 4).
- FLUX.2 [klein] **4B** (Apache-2.0 laut Modellkarten-Spiegeln) wäre mit ≈ 16 GB deutlich genügsamer und eine saubere Alternative,
  falls die Lizenzfrage oder der Speicher drückt – nur über den Speicherort austauschbar, ohne Codeänderung.

## 3. Was getestet ist (mit dem Mini-Modell)

- Laden von einem **lokalen Ordner** (`local_files_only`, nichts wird heruntergeladen, nichts kopiert); Entfernen des Eintrags
  lässt die Dateien unberührt.
- `Flux2KleinPipeline` mit **Referenzbildern** (`image=[Quelle, Stilbild]`), Größen als Vielfache von 16 (mindestens 64 px),
  gleiche Seeds → gleiches Ergebnis, andere Seeds → anderes, Fortschritt je Schritt, Abbruch über die Job-API.
- Pipeline-Klasse kommt aus `model_index.json`: **neue Modellfamilien laufen ohne Codeänderung**, sofern diffusers sie kennt
  und die Pipeline Referenzbilder annimmt. diffusers 0.42.1 enthält bereits `Flux2KleinPipeline` **und** `Flux3…`-Klassen.
- Ganze Kette in der App: Modell in den Einstellungen einrichten → Stilbild wählen → Lauf → Aktualisieren → Prompt ändern →
  Verlauf als Ebenen / Ergebnis im Effekt → Vorlagen → Eintrag entfernen (E2E-Test `styleFlux.spec.ts`).

## 4. Messskript (ausführen, sobald der Modellordner bekannt ist)

```
uv run --project ml-service python ml-service/prototypes/m0_flux_prototype.py \
  --model /pfad/zum/flux-2-klein-9b --source tests/fixtures/photo-portrait-street.jpg --style STILBILD.jpg \
  --out /tmp/m0 --max-edge 1024 --steps 4
```

Es misst Ladezeit, Spitzenspeicher (RSS und Metal), Zeit je Variante für: Stil-Übertragung englisch, deutsch und mit zweitem
Seed, **Outpainting** (Foto um 25 % nach rechts, Vorfüllung mit gespiegeltem Rand) und **Text-zu-Bild**, und schreibt Bilder und
`m0_messwerte.json`. Danach werden die Zahlen hier und in `PROGRESS.md` nachgetragen.

## 5. Vorschläge zu den offenen Entscheidungen (Spec Abschnitt 9)

1. **Andockpunkt:** neue Ebenenart `ml` (Variante in `SceneNode`), Ergebnis als Original; Quelle = Zusammenführung der Ebenen
   darunter über das vorhandene Rendern. Vorläufer ist der Effekt „Stil übertragen (FLUX)“ (Ergebnis-Original + Aktualisieren).
2. **Standardwerte FLUX.2 klein 9B:** bf16, Auslagerung automatisch, 4 Schritte, Guidance 1,0, Arbeitsauflösung 1024 px – **nach
   Messung bestätigen**. PyTorch/MPS ist gesetzt; eine Apple-spezifische Laufzeit (MLX o. ä.) erst prüfen, wenn die Messung zu
   langsam ist.
3. **Backends:** Diffusers-Ordner (umgesetzt). Einzelne Safetensors-Dateien später.
4. **Upscaler:** noch offen (klassisch bikubisch als Rückfall; Modell nach M0-Messung vorschlagen).
5. **Prompt-Übersetzung:** deutsche und englische Prompts werden im Messskript verglichen; Entscheidung nach Messung. Die
   mitgelieferten Prompt-Vorlagen sind englisch (Modelle folgen so am besten), im Effekt frei änderbar.
6. **Ordner-Browser:** vorerst Texteingabe des absoluten Pfads (Prüfung mit Status). Ein Browser mit freigegebenen Basisordnern
   folgt in M1.
7. entschieden (nativ auf macOS).
8. **Inpainting-Modell:** zunächst Standardverfahren mit `image-edit` (+ vorhandenes LaMa für „Entfernen“ ohne Prompt); eigenes
   Füllmodell erst nach Messung.
9. **Generierung:** Standardformat = Arbeitsfläche, Obergrenze 4 MP; Hochskalieren mit Hinweis.
10. **Leinwandmodell (M1b):** Versatz aller Ebenentransformationen um den Ankerversatz (nichts am Ebeneninhalt ändern),
    `project.canvas` wird größer; maximale Größe = GPU-Limit mit Warnung ab 24 MP. Leinwandbezogene Effekte passen sich an.
11. **Outpainting:** Überlappung 64 px (bei 1 MP), schrittweise in Streifen von ≤ ½ Modellausschnitt, Vorfüllung per Push-Pull als
    Startbild (Wirkung im Messskript prüfen).

## 6. Fazit und Freigabe

M0 ist **technisch bestanden, inhaltlich offen**: Architektur, Andockpunkte und Risiken sind geklärt, die Kette läuft mit einem
Mini-Modell. Offen bleiben die **Messwerte, deutsche Prompts, Qualität der Stil-Übertragung und des Outpaintings** mit dem echten
9B-Modell. Freigabe von M1 (Modellverwaltung komplett), M1b (Leinwand) und M2 durch dich.
