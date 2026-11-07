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
from .imageio import decode_image, decode_mask, encode_image_png, encode_mask_png16
from .jobs import JobRunner
from . import mlconfig
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
        prefetch: bool | None = None,
        downloader: Downloader | None = None,
        cache_dir: Path | None = None,
        effects: dict[str, EffectDef] | None = None,
        ml_factory: Callable | None = None,
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
        # ML-Modellverwaltung (Spec „ML-Fotobearbeitung“): Konfiguration beliebig, Engines je Modell gecacht
        self.ml_config_path = mlconfig.config_path()
        self.ml_factory: Callable = ml_factory or _default_ml_factory
        self.ml_engines: dict[str, tuple[str, object]] = {}
        self.factory = factory or models.make_model
        self.device = "test" if factory else models.pick_device()
        self.downloads = downloader or Downloader(models.CACHE_DIR / "models", token=models.hf_token)
        if prefetch is None:
            prefetch = os.environ.get("BLS_PREFETCH", "1") != "0"
        if prefetch:
            # Kommerziell nutzbare Modelle beim Start herunterladen (Fortschritt in /health, pausier-/stoppbar)
            for m in self.models.values():
                if m.commercial_use and not m.gated and not m.on_demand and not self.path(m):
                    self.downloads.start(m)

    def ml_models(self) -> list[mlconfig.MlModel]:
        return mlconfig.load_models(self.ml_config_path)

    def ml_engine(self, m: mlconfig.MlModel):
        """Engine zum Modell (gecacht; ändert sich der Eintrag, wird die alte entladen)."""
        sig = json.dumps(mlconfig.to_dict(m), sort_keys=True)
        with self.lock:
            cur = self.ml_engines.get(m.id)
            if cur is None or cur[0] != sig:
                if cur is not None:
                    unload = getattr(cur[1], "unload", None)
                    if unload:
                        unload()
                # nur ein großes Modell gleichzeitig im Speicher
                for other_id, (_s, eng) in list(self.ml_engines.items()):
                    if other_id != m.id:
                        unload = getattr(eng, "unload", None)
                        if unload:
                            unload()
                        del self.ml_engines[other_id]
                self.ml_engines[m.id] = (sig, self.ml_factory(m))
            return self.ml_engines[m.id][1]

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


def _default_ml_factory(model: mlconfig.MlModel):
    from .mlengine import DiffusersEngine

    return DiffusersEngine(model)


def create_app(state: State | None = None) -> FastAPI:
    st = state or State()
    app = FastAPI(title="Blur & Layer Studio ML-Dienst", version=__version__)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=ALLOWED_ORIGINS,
        allow_methods=["GET", "POST", "PUT", "HEAD", "DELETE"],
        allow_headers=["*"],
        expose_headers=["X-Width", "X-Height", "X-Cached", "X-Objects", "X-Seed"],
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

    # ---------- ML-Modellverwaltung und Bildbearbeitung (Spec „ML-Fotobearbeitung“) ----------

    def ml_json(m: mlconfig.MlModel, models: list[mlconfig.MlModel]) -> dict:
        d = mlconfig.to_dict(m)
        d["status"] = mlconfig.status_of(m)
        d["loaded"] = m.id in st.ml_engines and getattr(st.ml_engines[m.id][1], "pipe", None) is not None
        d["roleDefaults"] = [r for r in m.roles if mlconfig.default_for(models, r) is m]
        return d

    @app.get("/ml/models")
    def ml_list() -> dict:
        from .mlengine import hardware_info

        models = st.ml_models()
        return {
            "configPath": str(st.ml_config_path),
            "hardware": hardware_info(),
            "roles": list(mlconfig.ROLES),
            "models": [ml_json(m, models) for m in models],
        }

    @app.put("/ml/models/{model_id}")
    def ml_put(model_id: str, body: dict = Body(...)) -> dict:
        try:
            m = mlconfig.from_dict({**body, "id": model_id})
        except (mlconfig.ConfigError, ValueError, TypeError) as e:
            raise HTTPException(400, str(e)) from e
        models = mlconfig.upsert(st.ml_models(), m)
        mlconfig.save_models(models, st.ml_config_path)
        return ml_json(m, models)

    @app.delete("/ml/models/{model_id}")
    def ml_delete(model_id: str) -> dict:
        """Entfernt nur den Eintrag – die Modelldateien bleiben unberührt."""
        models = [m for m in st.ml_models() if m.id != model_id]
        mlconfig.save_models(models, st.ml_config_path)
        with st.lock:
            cur = st.ml_engines.pop(model_id, None)
        if cur is not None and getattr(cur[1], "unload", None):
            cur[1].unload()
        return {"removed": model_id}

    @app.post("/ml/models/{model_id}/check")
    def ml_check(model_id: str) -> dict:
        models = st.ml_models()
        m = next((x for x in models if x.id == model_id), None)
        if m is None:
            raise HTTPException(404, f"Unbekanntes Modell {model_id}")
        return ml_json(m, models)

    @app.post("/ml/unload")
    def ml_unload() -> dict:
        with st.lock:
            engines = list(st.ml_engines.values())
            st.ml_engines.clear()
        for _sig, eng in engines:
            if getattr(eng, "unload", None):
                eng.unload()
        return {"unloaded": len(engines)}

    @app.post("/ml/edit")
    async def ml_edit(
        image: UploadFile = File(...),
        refs: list[UploadFile] = File(default=[]),
        prompt: str = Form(...),
        seed: int = Form(0),
        steps: int = Form(0),
        guidance: float = Form(-1.0),
        max_edge: int = Form(1024),
        model: str = Form(""),
        license_mode: str = Form("commercial"),
    ) -> dict:
        """Bildbearbeitung per Prompt mit Referenzbildern (Rolle `image-edit`): Ergebnis als PNG, Seed im Kopf `X-Seed`."""
        models = st.ml_models()
        m = next((x for x in models if x.id == model), None) if model else mlconfig.default_for(models, "image-edit")
        if m is None or "image-edit" not in m.roles:
            raise HTTPException(404, "Kein Modell für die Rolle image-edit eingerichtet (Einstellungen > ML-Modelle).")
        if not (m.output_commercial_use or license_mode == "all"):
            raise HTTPException(
                403, f"{m.name} ist im Lizenzmodus „Kommerziell“ gesperrt (Einstufung der erzeugten Bilder: nicht kommerziell)."
            )
        status = mlconfig.status_of(m)
        if not status["available"]:
            raise HTTPException(503, f"{m.name}: {status['note']}")
        max_edge = max(256, min(2048, max_edge))
        data = await image.read()
        ref_data = [await r.read() for r in refs]

        def run(progress: Callable[[float], None]) -> bytes:
            src = decode_image(data)
            engine = st.ml_engine(m)
            out = engine.edit(
                [src] + [decode_image(d) for d in ref_data],
                prompt,
                seed,
                steps or None,
                guidance if guidance >= 0 else None,
                max_edge,
                progress,
            )
            job_ref["job"].meta.update({"width": out.width, "height": out.height, "seed": seed})
            return encode_image_png(out)

        job_ref: dict = {}
        job = st.jobs.submit(run)
        job_ref["job"] = job
        return {"id": job.id, "status": job.status, "progress": job.progress}

    @app.post("/segment/objects")
    async def segment_objects(
        image: UploadFile = File(...),
        model: str = Form("sam2.1-large"),
        license_mode: str = Form("commercial"),
        max_objects: int = Form(8),
        grid: int = Form(16),
    ) -> dict:
        m = st.models.get(model)
        if m is None or m.task != "objects":
            raise HTTPException(404, f"Unbekanntes Objektmodell {model}")
        if not is_allowed(m, license_mode):
            raise HTTPException(403, f"{m.name} ist nur nicht-kommerziell nutzbar (Lizenzmodus „Kommerziell“).")
        ok, note = st.available(m)
        if not ok:
            raise HTTPException(503, note or "Modell nicht verfügbar")
        max_objects = max(1, min(24, max_objects))
        grid = max(4, min(32, grid))
        data = await image.read()
        job_ref: dict = {}

        def run(progress: Callable[[float], None]) -> bytes:
            img = decode_image(data)
            progress(0.05)
            labels, objs = st.segmenter(m).objects(img, max_objects, grid, progress)
            job_ref["job"].meta.update({"objects": objs, "width": labels.shape[1], "height": labels.shape[0]})
            return encode_mask_png16(labels.astype(np.float32) / 65535.0)

        job = st.jobs.submit(run)
        job_ref["job"] = job
        return {"id": job.id, "status": job.status, "progress": job.progress}

    @app.post("/inpaint")
    async def inpaint(
        image: UploadFile = File(...),
        mask: UploadFile = File(...),
        model: str = Form("lama"),
        license_mode: str = Form("commercial"),
    ) -> dict:
        m = st.models.get(model)
        if m is None or m.task != "inpaint":
            raise HTTPException(404, f"Unbekanntes Inpainting-Modell {model}")
        if not is_allowed(m, license_mode):
            raise HTTPException(403, f"{m.name} ist nur nicht-kommerziell nutzbar (Lizenzmodus „Kommerziell“).")
        ok, note = st.available(m)
        if not ok:
            raise HTTPException(503, note or "Modell nicht verfügbar")
        image_data = await image.read()
        mask_data = await mask.read()

        def run(progress: Callable[[float], None]) -> bytes:
            img = decode_image(image_data)
            hole = decode_mask(mask_data, img.size) > 0.5
            progress(0.05)
            out = st.segmenter(m).inpaint(img, hole, progress)
            return encode_image_png(out)

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
        digest_b = str(body.get("imageB") or "")
        params = dict(body.get("params") or {})
        scale = float(body.get("scale", 1.0))
        origin = tuple(float(v) for v in body.get("origin", (0, 0)))
        canvas = tuple(float(v) for v in body.get("canvasSize", (0, 0)))
        try:
            if not st.images.has(digest) or (digest_b and not st.images.has(digest_b)):
                raise HTTPException(409, "Bild fehlt im Dienst – bitte zuerst hochladen (PUT /images/{sha256}).")
        except ValueError as e:
            raise HTTPException(400, str(e)) from e
        # Ergebnis-Cache: Hash aus Bild, Effekt, Version, Parametern (inkl. Seed) und Lage
        key = sha256(
            json.dumps([digest, digest_b, eff.id, eff.version, params, scale, origin, canvas], sort_keys=True).encode()
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
            img_b = None
            if digest_b:
                got_b = st.images.get(digest_b)
                if got_b is None:
                    raise RuntimeError("Zweitbild ist nicht mehr im Speicher – bitte erneut hochladen.")
                img_b = decode_f16(*got_b)
            progress(0.01)
            out = run_effect(eff, img, params, scale, origin, canvas, progress, img_b)
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
        if "seed" in job.meta:
            headers["X-Seed"] = str(job.meta["seed"])
        if "objects" in job.meta:
            headers["X-Objects"] = json.dumps(job.meta["objects"], separators=(",", ":"))
        headers["X-Cached"] = "1" if job.cached else "0"
        return Response(job.result, media_type=job.media_type, headers=headers)

    return app


def run() -> None:
    import uvicorn

    print(f"Blur & Layer Studio ML-Dienst auf http://{HOST}:{PORT} (nur lokal)")
    uvicorn.run(create_app(), host=HOST, port=PORT, log_level="info")


if __name__ == "__main__":
    run()
