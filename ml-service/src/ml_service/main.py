"""FastAPI-Dienst: /health, /segment/foreground (+ Jobs). Bindet nur an 127.0.0.1."""

from __future__ import annotations

import os
import threading
from pathlib import Path
from typing import Callable

import numpy as np
from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response

from . import __version__
from .downloads import Downloader
from .imageio import decode_image, encode_mask_png16
from .jobs import JobRunner
from .registry import ServiceModel, is_allowed, load_registry

HOST = "127.0.0.1"
PORT = int(os.environ.get("BLS_PORT", "8765"))
# Nur die Origins der Web-App (Dev-Server und Preview)
ALLOWED_ORIGINS = ["http://localhost:5317", "http://127.0.0.1:5317", "http://localhost:4317", "http://127.0.0.1:4317"]

SegmenterFactory = Callable[[ServiceModel, str, Path], Callable]


class State:
    def __init__(
        self,
        factory: SegmenterFactory | None = None,
        prefetch: bool = True,
        downloader: Downloader | None = None,
    ):
        from . import models

        self.models = load_registry()
        self.loaded: dict[str, Callable] = {}
        self.lock = threading.Lock()
        self.jobs = JobRunner()
        self._models = models
        self.factory = factory or (lambda m, d, p: models.HfSegmenter(m, d, p))
        self.device = "test" if factory else models.pick_device()
        self.downloads = downloader or Downloader(models.CACHE_DIR / "models", token=models.hf_token)
        if prefetch:
            # Kommerziell nutzbare Modelle beim Start herunterladen (Fortschritt in /health, pausier-/stoppbar)
            for m in self.models.values():
                if m.commercial_use and not m.gated and not self.path(m):
                    self.downloads.start(m)

    def path(self, m: ServiceModel) -> Path | None:
        """Ordner mit dem fertigen Modell (eigener Download oder älterer Hugging-Face-Cache)."""
        if self.downloads.is_complete(m):
            return self.downloads.dir(m)
        legacy = self._models.legacy_snapshot(m)
        return Path(legacy) if legacy else None

    def available(self, m: ServiceModel) -> tuple[bool, str | None]:
        if self.path(m):
            return True, None
        st = self.downloads.state(m)
        if st.status == "downloading":
            pct = round(100 * st.loaded / st.total) if st.total else 0
            return False, f"wird heruntergeladen … {pct} %"
        if st.status == "paused":
            return False, "Download pausiert"
        if st.status == "error":
            return False, f"Download fehlgeschlagen: {st.error}"
        if m.gated and not self._models.hf_token():
            return False, "Hugging-Face-Zugang nötig (Lizenz akzeptieren, HF_TOKEN setzen)"
        return False, "nicht heruntergeladen"

    def download_info(self, m: ServiceModel) -> dict:
        if self.path(m):
            st = self.downloads.state(m)
            return {"status": "done", "loaded": st.total or st.loaded, "total": st.total or st.loaded}
        st = self.downloads.state(m)
        return {"status": st.status, "loaded": st.loaded, "total": st.total, "error": st.error}

    def segmenter(self, m: ServiceModel) -> Callable:
        with self.lock:
            if m.id not in self.loaded:
                path = self.path(m)
                if path is None:
                    raise RuntimeError(f"{m.name} ist nicht heruntergeladen.")
                self.loaded[m.id] = self.factory(m, self.device, path)
            return self.loaded[m.id]


def create_app(state: State | None = None) -> FastAPI:
    st = state or State()
    app = FastAPI(title="Blur & Layer Studio ML-Dienst", version=__version__)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=ALLOWED_ORIGINS,
        allow_methods=["GET", "POST", "DELETE"],
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
                    "download": st.download_info(m),
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

    def model_or_404(model_id: str) -> ServiceModel:
        m = st.models.get(model_id)
        if m is None:
            raise HTTPException(404, f"Unbekanntes Modell {model_id}")
        return m

    @app.post("/models/{model_id}/download")
    def model_download(model_id: str, license_mode: str = "commercial") -> dict:
        m = model_or_404(model_id)
        if not is_allowed(m, license_mode):
            raise HTTPException(403, f"{m.name} ist nur nicht-kommerziell nutzbar (Lizenzmodus „Kommerziell“).")
        if m.gated and not st._models.hf_token():
            raise HTTPException(403, "Hugging-Face-Zugang nötig (Lizenz akzeptieren, HF_TOKEN setzen).")
        st.downloads.start(m)
        return st.download_info(m)

    @app.post("/models/{model_id}/pause")
    def model_pause(model_id: str) -> dict:
        m = model_or_404(model_id)
        st.downloads.pause(m)
        return st.download_info(m)

    @app.post("/models/{model_id}/stop")
    def model_stop(model_id: str) -> dict:
        m = model_or_404(model_id)
        st.downloads.stop(m)
        return st.download_info(m)

    @app.delete("/models/{model_id}")
    def model_delete(model_id: str) -> dict:
        m = model_or_404(model_id)
        with st.lock:
            st.loaded.pop(m.id, None)
        st.downloads.delete(m)
        st._models.remove_legacy(m)
        return st.download_info(m)

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
