# Modelle und ML-Bibliotheken

Maschinenlesbar: [models/registry.json](models/registry.json) – die einzige Quelle; die App lädt Modelle nur über das Register.
Jede Lizenz wurde vor dem Einbau an der Quelle geprüft (Modellkarte, LICENSE-Datei bzw. offizielle Modellkarte des Herstellers).
Revisionen sind auf einen Commit festgelegt, Dateien per SHA-256 geprüft.

## Lizenzmodus

- **Kommerziell** (Standard): nur Modelle mit `commercialUse: true`. NC-Modelle sind in allen Dialogen ausgegraut,
  werden weder im Browser noch im Dienst geladen (doppelte Prüfung: App, ML-Worker, Python-Dienst).
- **Alle Modelle**: zusätzlich nicht-kommerzielle Modelle. Ergebnisse tragen ihre Herkunft (Modell-ID, Lizenz);
  Ebenen mit NC-Herkunft zeigen ein „NC“-Badge, der Export warnt und bietet „Mit kommerziellen Modellen neu berechnen“ an.

## Browser (onnxruntime-web / MediaPipe im Web Worker)

| ID                          | Aufgabe                      | Modell                                                       | Lizenz                                                  | Kommerziell | Quelle (Revision)                                                                                                                                                                                             | Geprüft    |
| --------------------------- | ---------------------------- | ------------------------------------------------------------ | ------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| `birefnet-lite`             | Vordergrund                  | BiRefNet lite, Re-Export 512 × 512, fp16 (94 MB)             | MIT                                                     | ja          | [studioludens/birefnet-lite-512](https://huggingface.co/studioludens/birefnet-lite-512) (`962e679`), abgeleitet von [ZhengPeng7/BiRefNet_lite](https://huggingface.co/ZhengPeng7/BiRefNet_lite) (MIT)         | 2026-10-14 |
| `rmbg-1.4`                  | Vordergrund                  | BRIA RMBG 1.4, fp16 (88 MB)                                  | bria-rmbg-1.4 (Creative Commons, nur nicht-kommerziell) | **nein**    | [briaai/RMBG-1.4](https://huggingface.co/briaai/RMBG-1.4) (`2ceba5a`)                                                                                                                                         | 2026-10-14 |
| `mediapipe-face-landmarker` | Fokuspunkte (Augen, Gesicht) | Face Landmarker (BlazeFace + Face Mesh V2), float16 (3,8 MB) | Apache-2.0                                              | ja          | [MediaPipe](https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker), Modellkarten „MediaPipe Face Mesh V2“ und „BlazeFace (Short Range)“: „Licensed under Apache License, Version 2.0“ | 2026-10-14 |
| `mediapipe-pose-landmarker` | Fokuspunkte (Brust, Hände)   | Pose Landmarker full, float16 (9,4 MB)                       | Apache-2.0                                              | ja          | [MediaPipe](https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker), Modellkarte „BlazePose GHUM 3D“: „Licensed under Apache License, Version 2.0“                                     | 2026-10-14 |

**Warum BiRefNet lite in 512 statt 1024?** Die 1024-ONNX-Fassungen (z. B. `onnx-community/BiRefNet_lite-ONNX`, MIT) laufen in
Chrome auf dem Referenz-Mac nicht: JSEP-WebGPU scheitert an ungültigem WGSL (Slice) und einem Concat mit 1024 Eingängen,
der native WebGPU-EP braucht 11 Storage-Buffer pro Shader-Stufe (Chrome erlaubt 10), WASM bricht mit `std::bad_alloc` ab.
Der 512-Re-Export bleibt in den Limits; die Maske wird danach mit einem Guided Filter kantenbewusst auf volle Auflösung gebracht.
Die volle Qualität (BiRefNet 1024, voll) liefert der Python-Dienst. Details: DECISIONS.md.

Nicht verwendet: `onnx-community/ISNet-ONNX` (Lizenzangabe AGPL-3.0).

## Python-Dienst (PyTorch, MPS)

| ID         | Aufgabe     | Modell                | Lizenz                                              | Kommerziell | Quelle (Revision)                                                                                                                                                                      | Geprüft    |
| ---------- | ----------- | --------------------- | --------------------------------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| `birefnet` | Vordergrund | BiRefNet (voll, 1024) | MIT                                                 | ja          | [ZhengPeng7/BiRefNet](https://huggingface.co/ZhengPeng7/BiRefNet) (`e2bf8e4`)                                                                                                          | 2026-10-14 |
| `rmbg-2.0` | Vordergrund | BRIA RMBG 2.0         | bria-rmbg-2.0 (CC BY-NC 4.0, nur nicht-kommerziell) | **nein**    | [briaai/RMBG-2.0](https://huggingface.co/briaai/RMBG-2.0) (`5df4c9c`), **zugangsbeschränkt**: Lizenz auf Hugging Face akzeptieren und `HF_TOKEN` setzen (oder `huggingface-cli login`) | 2026-10-14 |

Beide werden über `transformers` mit `trust_remote_code=True` geladen (Modellcode aus dem Repository, auf die Revision festgelegt).
Die Modellkarte von RMBG-2.0 ist ohne Anmeldung nicht lesbar; die Einstufung „nicht-kommerziell“ folgt den Repository-Metadaten
(`license: other`, `bria-rmbg-2.0`) und der Lizenz der Vorgängerversion.

## Bibliotheken

| Bibliothek                           | Version                   | Lizenz                                   | Laufort                             |
| ------------------------------------ | ------------------------- | ---------------------------------------- | ----------------------------------- |
| onnxruntime-web                      | 1.30.0                    | MIT                                      | Browser                             |
| @mediapipe/tasks-vision              | 1.1.0                     | Apache-2.0                               | Browser                             |
| torch                                | 2.14.1                    | BSD-3-Clause (u. a. freizügige Lizenzen) | Dienst                              |
| transformers                         | 5.19.0                    | Apache-2.0                               | Dienst                              |
| huggingface-hub                      | 2.2.0                     | Apache-2.0                               | Dienst                              |
| timm / kornia / einops               | 1.0.30 / 0.8.3 / 0.8.2    | Apache-2.0 / Apache-2.0 / MIT            | Dienst (vom BiRefNet-Code benötigt) |
| fastapi / uvicorn / python-multipart | 0.143.1 / 0.54.0 / 0.0.32 | MIT / BSD-3-Clause / Apache-2.0          | Dienst                              |

## Laden und Cache

- Browser: einmaliger Download mit Fortschrittsanzeige, SHA-256-Prüfung, Cache im OPFS (`models/`). Laufzeitdateien von ORT und
  MediaPipe (WASM) werden lokal ausgeliefert (`/vendor/…`), nicht per CDN.
- Dienst: Download beim ersten Start (Fortschritt in `/health`), Cache unter `~/.cache/blur-layer-studio/`.
- Tests: `npm run models:fetch` legt die Browser-Modelle in `tests/.cache/models/` ab; der Dev-Server spiegelt sie unter `/__models/`
  (nur mit `localStorage['bls.modelMirror']`, nur im Dev-Modus).
