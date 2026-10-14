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
  Cache unter `~/.cache/blur-layer-studio/` (änderbar mit `BLS_CACHE`).
- NC-Modelle (z. B. RMBG-2.0) nur, wenn die App den Lizenzmodus „Alle“ meldet; RMBG-2.0 braucht zusätzlich einen
  Hugging-Face-Zugang (`HF_TOKEN`).

| Endpunkt                     | Eingang                                     | Ausgang                                            |
| ---------------------------- | ------------------------------------------- | -------------------------------------------------- |
| `GET /health?license_mode=…` | –                                           | Gerät, Version, je Modell Lizenz/geladen/verfügbar |
| `POST /segment/foreground`   | multipart: `image`, `model`, `license_mode` | Job `{ id, status, progress }`                     |
| `GET /jobs/{id}`             | –                                           | Status und Fortschritt                             |
| `GET /jobs/{id}/result`      | –                                           | Maske als 16-Bit-PNG in Originalgröße              |
