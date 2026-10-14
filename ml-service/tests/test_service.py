import io
import time

import numpy as np
from fastapi.testclient import TestClient
from PIL import Image

from ml_service.main import State, create_app
from ml_service.registry import load_registry


class FakeSegmenter:
    """Ersatz für das echte Modell: linke Bildhälfte = Vordergrund."""

    def __init__(self, model, device):
        self.model = model

    def __call__(self, image, progress):
        w, h = image.size
        m = np.zeros((h, w), dtype=np.float32)
        m[:, : w // 2] = 1.0
        progress(0.5)
        return m


def make_client():
    st = State(factory=FakeSegmenter, prefetch=False)
    # Zugangsbeschränkte Modelle im Test als verfügbar behandeln
    st._models.hf_cached = lambda m: True  # type: ignore[attr-defined]
    return TestClient(create_app(st)), st


def jpeg(w=64, h=48):
    buf = io.BytesIO()
    Image.new("RGB", (w, h), (200, 100, 50)).save(buf, format="JPEG")
    return buf.getvalue()


def wait(client, job_id):
    for _ in range(100):
        s = client.get(f"/jobs/{job_id}").json()
        if s["status"] in ("done", "error"):
            return s
        time.sleep(0.02)
    raise AssertionError("Job hängt")


def test_registry_lists_service_models_with_licenses():
    reg = load_registry()
    assert reg["birefnet"].commercial_use is True
    assert reg["rmbg-2.0"].commercial_use is False
    assert reg["rmbg-2.0"].gated is True


def test_health_lists_license_per_model():
    client, _ = make_client()
    h = client.get("/health").json()
    by_id = {m["id"]: m for m in h["models"]}
    assert by_id["birefnet"]["license"] == "MIT"
    assert by_id["birefnet"]["available"] is True
    assert by_id["rmbg-2.0"]["commercialUse"] is False
    # Im Modus „Kommerziell“ ist das NC-Modell nicht verfügbar
    assert by_id["rmbg-2.0"]["available"] is False
    h_all = client.get("/health?license_mode=all").json()
    assert {m["id"]: m for m in h_all["models"]}["rmbg-2.0"]["available"] is True


def test_nc_model_refused_in_commercial_mode_and_not_loaded():
    client, st = make_client()
    r = client.post(
        "/segment/foreground",
        files={"image": ("a.jpg", jpeg(), "image/jpeg")},
        data={"model": "rmbg-2.0", "license_mode": "commercial"},
    )
    assert r.status_code == 403
    assert "rmbg-2.0" not in st.loaded


def test_segment_job_returns_16bit_png_at_original_size():
    client, st = make_client()
    r = client.post(
        "/segment/foreground",
        files={"image": ("a.jpg", jpeg(64, 48), "image/jpeg")},
        data={"model": "birefnet", "license_mode": "commercial"},
    )
    assert r.status_code == 200
    s = wait(client, r.json()["id"])
    assert s["status"] == "done", s
    png = client.get(f"/jobs/{s['id']}/result")
    assert png.headers["content-type"] == "image/png"
    img = Image.open(io.BytesIO(png.content))
    assert img.size == (64, 48)
    assert img.mode in ("I;16", "I")
    a = np.array(img)
    assert a[0, 0] == 65535 and a[0, -1] == 0
    assert "birefnet" in st.loaded


def test_unknown_model_and_job():
    client, _ = make_client()
    r = client.post("/segment/foreground", files={"image": ("a.jpg", jpeg(), "image/jpeg")}, data={"model": "nope"})
    assert r.status_code == 404
    assert client.get("/jobs/xyz").status_code == 404


def test_cors_only_for_web_app_origin():
    client, _ = make_client()
    ok = client.get("/health", headers={"Origin": "http://localhost:5317"})
    assert ok.headers.get("access-control-allow-origin") == "http://localhost:5317"
    bad = client.get("/health", headers={"Origin": "https://example.com"})
    assert "access-control-allow-origin" not in bad.headers
