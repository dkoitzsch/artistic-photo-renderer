"""FastAPI-Dienst: /health, /segment/foreground (+ Jobs). Bindet nur an 127.0.0.1."""

from __future__ import annotations

import os
import threading
from typing import Callable

import numpy as np
from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response

from . import __version__
from .imageio import decode_image, encode_mask_png16
from .jobs import JobRunner
from .registry import ServiceModel, is_allowed, load_registry

HOST = "127.0.0.1"
PORT = int(os.environ.get("BLS_PORT", "8765"))
# Nur die Origins der Web-App (Dev-Server und Preview)
ALLOWED_ORIGINS = ["http://localhost:5317", "http://127.0.0.1:5317", "http://localhost:4317", "http://127.0.0.1:4317"]

SegmenterFactory = Callable[[ServiceModel, str], Callable]


class State:
    def __init__(self, factory: SegmenterFactory | None = None, prefetch: bool = True):
        from . import models

        self.models = load_registry()
        self.loaded: dict[str, Callable] = {}
        self.downloading: dict[str, float] = {}
        self.errors: dict[str, str] = {}
        self.lock = threading.Lock()
        self.jobs = JobRunner()
        self._models = models
        self.factory = factory or (lambda m, d: models.HfSegmenter(m, d))
        self.device = "test" if factory else models.pick_device()
        if prefetch:
            # Kommerziell nutzbare Modelle beim Start herunterladen (Fortschritt in /health)
            for m in self.models.values():
                if m.commercial_use and not m.gated:
                    threading.Thread(target=self._prefetch, args=(m,), daemon=True).start()

    def _prefetch(self, m: ServiceModel) -> None:
        self.downloading[m.id] = 0.0

        def progress(p: float) -> None:
            self.downloading[m.id] = p

        try:
            self._models.download(m, progress)
        except Exception as e:
            self.errors[m.id] = f"Download fehlgeschlagen: {e}"
        finally:
            self.downloading.pop(m.id, None)

    def available(self, m: ServiceModel) -> tuple[bool, str | None]:
        if m.id in self.errors:
            return False, self.errors[m.id]
        if m.id in self.downloading:
            return False, f"wird heruntergeladen … {round(self.downloading[m.id] * 100)} %"
        if m.gated and not (self._models.hf_cached(m) or self._models.hf_token_present()):
            return False, "Hugging-Face-Zugang nötig (Lizenz akzeptieren, HF_TOKEN setzen)"
        return True, None

    def segmenter(self, m: ServiceModel) -> Callable:
        with self.lock:
            if m.id not in self.loaded:
                self.loaded[m.id] = self.factory(m, self.device)
            return self.loaded[m.id]


def create_app(state: State | None = None) -> FastAPI:
    st = state or State()
    app = FastAPI(title="Blur & Layer Studio ML-Dienst", version=__version__)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=ALLOWED_ORIGINS,
        allow_methods=["GET", "POST"],
        allow_headers=["*"],
    )
    app.state.st = st

    @app.get("/health")
    def health(license_mode: str = "commercial") -> dict:
        models = []
        for m in st.models.values():
            ok, note = st.available(m)
            allowed = is_allowed(m, license_mode)
            models.append(
                {
                    "id": m.id,
                    "license": m.license,
                    "commercialUse": m.commercial_use,
                    "loaded": m.id in st.loaded,
                    "available": ok and allowed,
                    "note": note if allowed else "im Lizenzmodus „Kommerziell“ gesperrt",
                }
            )
        return {"device": st.device, "version": __version__, "models": models}

    @app.post("/segment/foreground")
    async def segment_foreground(
        image: UploadFile = File(...),
        model: str = Form(...),
        license_mode: str = Form("commercial"),
    ) -> dict:
        m = st.models.get(model)
        if m is None or m.task != "foreground":
            raise HTTPException(404, f"Unbekanntes Modell {model}")
        if not is_allowed(m, license_mode):
            # NC-Modelle werden im Modus „Kommerziell“ nicht geladen
            raise HTTPException(403, f"{m.name} ist nur nicht-kommerziell nutzbar (Lizenzmodus „Kommerziell“).")
        ok, note = st.available(m)
        if not ok:
            raise HTTPException(503, note or "Modell nicht verfügbar")
        data = await image.read()

        def run(progress: Callable[[float], None]) -> bytes:
            img = decode_image(data)
            progress(0.05)
            mask = st.segmenter(m)(img, progress)
            return encode_mask_png16(np.asarray(mask, dtype=np.float32))

        job = st.jobs.submit(run)
        return {"id": job.id, "status": job.status, "progress": job.progress}

    @app.get("/jobs/{job_id}")
    def job_status(job_id: str) -> dict:
        job = st.jobs.jobs.get(job_id)
        if job is None:
            raise HTTPException(404, "Unbekannter Job")
        return {"id": job.id, "status": job.status, "progress": job.progress, "message": job.message}

    @app.get("/jobs/{job_id}/result")
    def job_result(job_id: str, request: Request) -> Response:
        job = st.jobs.jobs.get(job_id)
        if job is None or job.status != "done" or job.result is None:
            raise HTTPException(404, "Kein Ergebnis")
        return Response(job.result, media_type="image/png")

    return app


def run() -> None:
    import uvicorn

    print(f"Blur & Layer Studio ML-Dienst auf http://{HOST}:{PORT} (nur lokal)")
    uvicorn.run(create_app(), host=HOST, port=PORT, log_level="info")


if __name__ == "__main__":
    run()
