"""FastAPI-Dienst: /health, Segmentierung, Tiefe, Effekte (+ Jobs mit Abbruch). Bindet nur an 127.0.0.1."""

from __future__ import annotations

import json
import os
import threading
from pathlib import Path
from typing import Callable

import numpy as np
from fastapi import Body, FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response

from . import __version__
from .downloads import Downloader
from .effects import EffectDef, is_effect_allowed, load_effects, run_effect
from .imageio import decode_image, encode_mask_png16
from .jobs import JobRunner
from .store import BlobStore, decode_f16, encode_f16, sha256
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
        cache_dir: Path | None = None,
        effects: dict[str, EffectDef] | None = None,
    ):
        from . import models

        self.models = load_registry()
        # Effekt-Registry (gleiche Manifeste wie die Web-App) und Speicher für Bilder/Ergebnisse
        self.effects = effects if effects is not None else load_effects()
        cache = cache_dir or models.CACHE_DIR
        budget = int(float(os.environ.get("BLS_EFFECT_CACHE_GB", "4")) * 1024**3)
        self.images = BlobStore(cache / "images", budget)
        self.results = BlobStore(cache / "results", budget)
        self.loaded: dict[str, Callable] = {}
        self.lock = threading.Lock()
        self.jobs = JobRunner()
        self._models = models
        self.factory = factory or models.make_model
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
        allow_methods=["GET", "POST", "PUT", "HEAD", "DELETE"],
        allow_headers=["*"],
        expose_headers=["X-Width", "X-Height", "X-Cached"],
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
        effects = [
            {
                "id": e.id,
                "version": e.version,
                "commercialUse": e.commercial_use,
                "available": e.render is not None and is_effect_allowed(e, license_mode),
                "note": e.error
                or (None if is_effect_allowed(e, license_mode) else "im Lizenzmodus „Kommerziell“ gesperrt"),
            }
            for e in st.effects.values()
            if e.uses_python
        ]
        return {"device": st.device, "version": __version__, "models": models, "effects": effects}

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

    @app.post("/depth")
    async def depth(
        image: UploadFile = File(...),
        model: str = Form("depth-anything-v2-small-hr"),
        license_mode: str = Form("commercial"),
    ) -> dict:
        m = st.models.get(model)
        if m is None or m.task != "depth":
            raise HTTPException(404, f"Unbekanntes Tiefenmodell {model}")
        if not is_allowed(m, license_mode):
            raise HTTPException(403, f"{m.name} ist nur nicht-kommerziell nutzbar (Lizenzmodus „Kommerziell“).")
        ok, note = st.available(m)
        if not ok:
            raise HTTPException(503, note or "Modell nicht verfügbar")
        data = await image.read()

        def run(progress: Callable[[float], None]) -> bytes:
            img = decode_image(data)
            progress(0.05)
            depth_map = st.segmenter(m)(img, progress)
            return encode_mask_png16(np.asarray(depth_map, dtype=np.float32))

        job = st.jobs.submit(run)
        return {"id": job.id, "status": job.status, "progress": job.progress}

    # ---------- Effekte (Spec „Effekte“ 3.2) ----------

    @app.put("/images/{digest}")
    async def put_image(digest: str, request: Request, width: int, height: int) -> dict:
        data = await request.body()
        if sha256(data) != digest:
            raise HTTPException(400, "Prüfsumme der Bilddaten stimmt nicht.")
        try:
            decode_f16(data, width, height)
        except ValueError as e:
            raise HTTPException(400, str(e)) from e
        st.images.put(digest, data, width, height)
        return {"image": digest, "width": width, "height": height}

    @app.head("/images/{digest}")
    def has_image(digest: str) -> Response:
        try:
            ok = st.images.has(digest)
        except ValueError as e:
            raise HTTPException(400, str(e)) from e
        return Response(status_code=200 if ok else 404)

    @app.post("/effects/{effect_id}/render")
    def render_effect(effect_id: str, body: dict = Body(...)) -> dict:
        eff = st.effects.get(effect_id)
        if eff is None or not eff.uses_python:
            raise HTTPException(404, f"Effekt {effect_id} hat keine Python-Implementierung.")
        if not is_effect_allowed(eff, str(body.get("licenseMode", "commercial"))):
            raise HTTPException(403, f"{eff.name} ist nur nicht-kommerziell nutzbar (Lizenzmodus „Kommerziell“).")
        if eff.render is None:
            raise HTTPException(503, eff.error or "Effekt nicht verfügbar")
        digest = str(body.get("image", ""))
        params = dict(body.get("params") or {})
        scale = float(body.get("scale", 1.0))
        origin = tuple(float(v) for v in body.get("origin", (0, 0)))
        canvas = tuple(float(v) for v in body.get("canvasSize", (0, 0)))
        try:
            if not st.images.has(digest):
                raise HTTPException(409, "Bild fehlt im Dienst – bitte zuerst hochladen (PUT /images/{sha256}).")
        except ValueError as e:
            raise HTTPException(400, str(e)) from e
        # Ergebnis-Cache: Hash aus Bild, Effekt, Version, Parametern (inkl. Seed) und Lage
        key = sha256(
            json.dumps([digest, eff.id, eff.version, params, scale, origin, canvas], sort_keys=True).encode()
        )
        hit = st.results.get(key)
        if hit is not None:
            data, w, h = hit
            job = st.jobs.done(data, "application/octet-stream", {"width": w, "height": h})
            return {"id": job.id, "status": job.status, "progress": 1.0, "cached": True}

        def run(progress: Callable[[float], None]) -> bytes:
            got = st.images.get(digest)
            if got is None:
                raise RuntimeError("Bild ist nicht mehr im Speicher – bitte erneut hochladen.")
            data, w, h = got
            img = decode_f16(data, w, h)
            progress(0.01)
            out = run_effect(eff, img, params, scale, origin, canvas, progress)
            result = encode_f16(out)
            st.results.put(key, result, w, h)
            return result

        meta = {}
        got = st.images.get(digest)
        if got is not None:
            meta = {"width": got[1], "height": got[2]}
        job = st.jobs.submit(run, "application/octet-stream", meta)
        return {"id": job.id, "status": job.status, "progress": job.progress, "cached": False}

    # ---------- Jobs ----------

    def job_json(job) -> dict:
        out = {
            "id": job.id,
            "status": job.status,
            "progress": job.progress,
            "message": job.message,
            "cached": job.cached,
        }
        if job.status == "done":
            out["resultUrl"] = f"/jobs/{job.id}/result"
        return out

    @app.get("/jobs/{job_id}")
    def job_status(job_id: str) -> dict:
        job = st.jobs.jobs.get(job_id)
        if job is None:
            raise HTTPException(404, "Unbekannter Job")
        return job_json(job)

    @app.delete("/jobs/{job_id}")
    def job_cancel(job_id: str) -> dict:
        job = st.jobs.cancel(job_id)
        if job is None:
            raise HTTPException(404, "Unbekannter Job")
        return job_json(job)

    @app.get("/jobs/{job_id}/result")
    def job_result(job_id: str, request: Request) -> Response:
        job = st.jobs.jobs.get(job_id)
        if job is None or job.status != "done" or job.result is None:
            raise HTTPException(404, "Kein Ergebnis")
        headers = {}
        if "width" in job.meta:
            headers = {"X-Width": str(job.meta["width"]), "X-Height": str(job.meta["height"])}
        headers["X-Cached"] = "1" if job.cached else "0"
        return Response(job.result, media_type=job.media_type, headers=headers)

    return app


def run() -> None:
    import uvicorn

    print(f"Blur & Layer Studio ML-Dienst auf http://{HOST}:{PORT} (nur lokal)")
    uvicorn.run(create_app(), host=HOST, port=PORT, log_level="info")


if __name__ == "__main__":
    run()
