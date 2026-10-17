# ML-Dienst (lokal)

Liefert bessere Masken als die Browser-Modelle (BiRefNet in voller Größe auf der Apple-GPU). Ist er nicht gestartet,
arbeitet die App mit den Browser-Modellen weiter.

```bash
npm run dev            # Web-App und Dienst gemeinsam (aus dem Projektordner)
npm run service        # nur der Dienst: uv run --project ml-service ml-service
npm run test:service   # pytest
```

- Bindet nur an `127.0.0.1:8765`; CORS nur für die Web-App (`localhost:5317`, Preview `4317`).
- Python 3.12 und Pakete verwaltet `uv` (`uv sync` im Ordner `ml-service`).
- Modelle aus `../models/registry.json`; kommerziell nutzbare werden beim ersten Start geladen (Fortschritt in `/health`),
  Cache unter `~/.cache/blur-layer-studio/models/<id>/` (änderbar mit `BLS_CACHE`); Downloads lassen sich in der App
  unter „Modelle“ pausieren, fortsetzen, stoppen und löschen.
- NC-Modelle (z. B. RMBG-2.0) nur, wenn die App den Lizenzmodus „Alle“ meldet; RMBG-2.0 braucht zusätzlich einen
  Hugging-Face-Zugang (`HF_TOKEN`).

| Endpunkt                              | Eingang                                                          | Ausgang                                                                                       |
| ------------------------------------- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `GET /health?license_mode=…`          | –                                                                | Gerät, Version, je Modell Lizenz/geladen/verfügbar                                            |
| `POST /segment/foreground`            | multipart: `image`, `model`, `license_mode`                      | Job `{ id, status, progress }`                                                                |
| `POST /depth`                         | multipart: `image`, `model`, `license_mode`                      | Job; Ergebnis: Tiefe als 16-Bit-PNG (0 = nah)                                                 |
| `GET /effects` → in `/health`         | –                                                                | Effekte mit Python-Implementierung, Lizenz, verfügbar                                         |
| `PUT /images/{sha256}?width=&height=` | rohes RGBA float16 (linear, vormultipliziert)                    | speichert das Bild (Prüfsumme wird geprüft)                                                   |
| `HEAD /images/{sha256}`               | –                                                                | 200 = schon vorhanden, 404 = hochladen                                                        |
| `POST /effects/{id}/render`           | JSON `{ image, params, scale, origin, canvasSize, licenseMode }` | Job; Ergebnis-Cache über Hash aus Bild, Effekt, Version, Parametern, Lage                     |
| `GET /jobs/{id}`                      | –                                                                | Status (`queued`, `running`, `done`, `error`, `cancelled`), Fortschritt, `resultUrl`          |
| `DELETE /jobs/{id}`                   | –                                                                | Abbruch (wartend sofort, laufend beim nächsten Fortschrittsschritt)                           |
| `GET /jobs/{id}/result`               | –                                                                | Maske als 16-Bit-PNG bzw. Effektergebnis als RGBA float16 (`X-Width`, `X-Height`, `X-Cached`) |

**Effekte im Dienst:** Der Dienst liest dieselben `effects/*/manifest.json` wie die App und lädt `effects/<id>/effect.py`
(Vertrag siehe `src/ml_service/effects.py`). Bilder und Ergebnisse liegen unter `~/.cache/blur-layer-studio/images|results`
(Budget je 4 GB, änderbar mit `BLS_EFFECT_CACHE_GB`). Test-Effekte aus `tests/effects/` nur mit `BLS_TEST_EFFECTS=1`.
