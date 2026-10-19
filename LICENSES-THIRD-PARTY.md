# Fremdkomponenten und Lizenzen – Gesamtübersicht

Zentrale Liste aller Fremdkomponenten (Spec „Effekte & Malvorlagen“, Abschnitt 9). Details und Prüfvermerke:
[DEPENDENCIES.md](DEPENDENCIES.md) (Bibliotheken), [MODELS.md](MODELS.md) und `models/registry.json` (Modelle),
[tests/fixtures/LICENSES.md](tests/fixtures/LICENSES.md) (Testbilder). Lizenzen werden vor dem Einbau an der Quelle geprüft
(npm-/PyPI-Metadaten, LICENSE-Datei, Modellkarte).

**Regel für verkaufte Werke:** Im Lizenzmodus „Kommerziell“ sind nur Komponenten aktiv, deren Spalte „Kommerziell“ = ja ist.

## Web-App (im Bundle)

| Komponente                 | Version | Lizenz     | Kommerziell | Zweck                         |
| -------------------------- | ------- | ---------- | ----------- | ----------------------------- |
| react, react-dom           | 19.3.0  | MIT        | ja          | Oberfläche                    |
| zustand                    | 5.0.15  | MIT        | ja          | Zustand                       |
| @radix-ui/react-dialog     | 1.3.1   | MIT        | ja          | Dialoge                       |
| fflate                     | 0.8.3   | MIT        | ja          | Projektdatei (ZIP)            |
| fast-png                   | 8.0.0   | MIT        | ja          | 16-Bit-PNG (Masken, Tiefe)    |
| ag-psd                     | 31.0.3  | MIT        | ja          | PSD-Export                    |
| delaunator                 | 5.1.0   | ISC        | ja          | Delaunay (Low-Poly, Vorschau) |
| robust-predicates          | 3.0.3   | Unlicense  | ja          | Abhängigkeit von delaunator   |
| onnxruntime-web            | 1.30.0  | MIT        | ja          | ML im Browser                 |
| @mediapipe/tasks-vision    | 1.1.0   | Apache-2.0 | ja          | Landmarken (Fokuspunkte)      |
| @fontsource-variable/inter | 5.3.0   | OFL-1.1    | ja          | Schrift Inter                 |

## Python-Dienst

| Komponente       | Version        | Lizenz (PyPI-Metadaten)                                                              | Kommerziell |
| ---------------- | -------------- | ------------------------------------------------------------------------------------ | ----------- |
| fastapi          | 0.143.1        | MIT                                                                                  | ja          |
| uvicorn          | 0.54.0         | BSD-3-Clause                                                                         | ja          |
| python-multipart | 0.0.32         | Apache-2.0                                                                           | ja          |
| pillow           | 12.3.0         | MIT-CMU                                                                              | ja          |
| numpy            | 2.5.4          | BSD-3-Clause AND 0BSD AND MIT AND Zlib AND CC0-1.0                                   | ja          |
| torch            | 2.14.1         | Apache-2.0 AND Apache-2.0 WITH LLVM-exception AND BSD-2/3-Clause AND BSL-1.0 AND MIT | ja          |
| torchvision      | 0.29.1         | BSD                                                                                  | ja          |
| transformers     | 5.19.0         | Apache-2.0                                                                           | ja          |
| huggingface-hub  | 2.2.0          | Apache-2.0                                                                           | ja          |
| timm / kornia    | 1.0.30 / 0.8.3 | Apache-2.0                                                                           | ja          |
| einops           | 0.8.2          | MIT                                                                                  | ja          |
| scipy            | 1.18.1         | BSD-3-Clause                                                                         | ja          |
| pytest, httpx    | 9.1.1, 0.28.1  | MIT, BSD-3-Clause (nur Tests)                                                        | ja          |

## Modelle

Siehe [MODELS.md](MODELS.md). Kurzfassung: kommerziell nutzbar – BiRefNet (lite/voll, MIT), MediaPipe Face/Pose
(Apache-2.0), Depth Anything V2 Small (Apache-2.0); **nur nicht-kommerziell** – RMBG 1.4/2.0, Depth Anything V2 Large.

## Effekte, Algorithmen und Daten

Alle Effekte unter `effects/` sind eigene Implementierungen (Lizenz des Projekts). Verfahren aus der Literatur (z. B.
Kuwahara, XDoG, Floyd-Steinberg) sind als Algorithmen nicht urheberrechtlich geschützt; die Quelle steht im Manifest
(`license.notes`). Texturen werden prozedural erzeugt; Blue-Noise-Masken erzeugt der Code selbst (keine Fremddateien).

| Daten                                                | Lizenz                                               | Herkunft                                                                                       |
| ---------------------------------------------------- | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Testfotos                                            | CC0 1.0                                              | Wikimedia Commons (Unsplash/Pixabay), siehe tests/fixtures                                     |
| Synthetische Bilder                                  | eigene                                               | `tests/fixtures/generate.mjs`                                                                  |
| Pigmentdatenbank                                     | eigene Näherungsdaten                                | `src/pigments/pigments.json` (Vollton- und Aufhellungsfarben geschätzt, keine Herstellerdaten) |
| CIE-1931-2°-Normspektralwerte, Normlicht D65 (10 nm) | frei veröffentlichte Normdaten der CIE (Zahlenwerte) | `src/pigments/spectral.ts`                                                                     |

## Nicht verwendet (bewusst)

| Komponente               | Grund                                    |
| ------------------------ | ---------------------------------------- |
| Mixbox (Pigmentmischung) | für kommerzielle Nutzung lizenzpflichtig |
| ISNet-ONNX               | AGPL-3.0                                 |
