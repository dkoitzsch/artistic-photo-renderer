"""Phase 6: Inpainting (LaMa) – Ausschnittslogik mit Ersatzmodell, API mit Lizenz- und Fehlerfällen, echtes Modell (falls im
Test-Cache vorhanden: npm run models:fetch)."""

import io
import time
from pathlib import Path

import numpy as np
import pytest
from PIL import Image

from ml_service.imageio import decode_mask
from ml_service.inpaint import OnnxInpainter, SIZE, inpaint_array

from test_service import make_client

CACHE = Path(__file__).resolve().parents[2] / "tests" / ".cache" / "models"


def gradient(h, w):
    y, x = np.mgrid[0:h, 0:w]
    img = np.stack([x * 255 // max(w - 1, 1), y * 255 // max(h - 1, 1), np.full_like(x, 90)], axis=-1)
    return img.astype(np.uint8)


def fake_run(image, mask):
    """Ersatz für LaMa: füllt das Loch mit Mittelgrau (0…255)."""
    out = image * 255.0
    out = np.where(mask > 0.5, 128.0, out)
    return out.astype(np.float32)


def test_only_hole_changes_and_outside_is_identical():
    img = gradient(300, 400)
    mask = np.zeros((300, 400), bool)
    mask[100:160, 150:230] = True
    out = inpaint_array(fake_run, img, mask)
    assert out.shape == img.shape and out.dtype == np.uint8
    assert np.abs(out[100:160, 150:230].astype(int) - img[100:160, 150:230].astype(int)).mean() > 8
    far = np.ones_like(mask)
    far[60:200, 100:280] = False  # weit außerhalb von Loch und Rand
    assert np.array_equal(out[far], img[far])
    # Mitte des Lochs ist komplett grau
    assert np.abs(out[115:145, 170:210].astype(int) - 128).max() <= 2


def test_empty_mask_returns_copy():
    img = gradient(64, 64)
    out = inpaint_array(fake_run, img, np.zeros((64, 64), bool))
    assert np.array_equal(out, img)


def test_small_image_and_hole_at_border():
    img = gradient(40, 50)
    mask = np.zeros((40, 50), bool)
    mask[0:12, 0:15] = True
    out = inpaint_array(fake_run, img, mask)
    assert out.shape == img.shape
    assert np.abs(out[2:8, 2:10].astype(int) - 128).max() <= 2


def test_several_separate_holes():
    img = gradient(600, 800)
    mask = np.zeros((600, 800), bool)
    mask[50:90, 60:120] = True
    mask[480:540, 650:740] = True
    out = inpaint_array(fake_run, img, mask)
    assert np.abs(out[60:80, 75:105].astype(int) - 128).max() <= 2
    assert np.abs(out[495:525, 665:725].astype(int) - 128).max() <= 2
    assert np.array_equal(out[250:300, 300:400], img[250:300, 300:400])


def test_decode_mask_16bit_and_resize():
    m = np.zeros((10, 20), np.uint16)
    m[:, 10:] = 65535
    buf = io.BytesIO()
    Image.fromarray(m).save(buf, format="PNG")
    out = decode_mask(buf.getvalue(), (20, 10))
    assert out.shape == (10, 20) and out[0, 0] == 0 and out[0, 19] == 1
    small = decode_mask(buf.getvalue(), (10, 5))
    assert small.shape == (5, 10)


class FakeInpainter:
    def __init__(self, model, device, path):
        self.model = model

    def inpaint(self, image, mask, progress):
        progress(0.5)
        arr = np.asarray(image).copy()
        arr[mask] = (10, 200, 10)
        return Image.fromarray(arr)


def png(arr, mode=None):
    buf = io.BytesIO()
    Image.fromarray(arr, mode).save(buf, format="PNG")
    return buf.getvalue()


def wait(client, job_id):
    for _ in range(200):
        s = client.get(f"/jobs/{job_id}").json()
        if s["status"] in ("done", "error"):
            return s
        time.sleep(0.02)
    raise AssertionError("Job hängt")


def test_api_inpaint_and_license(tmp_path):
    client, st = make_client(tmp_path)
    st.factory = FakeInpainter
    img = gradient(40, 60)
    mask = np.zeros((40, 60), np.uint8)
    mask[10:20, 10:30] = 255
    files = {"image": ("a.png", png(img), "image/png"), "mask": ("m.png", png(mask), "image/png")}
    r = client.post("/inpaint", files=files, data={"model": "lama"})
    assert r.status_code == 200
    s = wait(client, r.json()["id"])
    assert s["status"] == "done"
    out = np.asarray(Image.open(io.BytesIO(client.get(f"/jobs/{r.json()['id']}/result").content)).convert("RGB"))
    assert out.shape == img.shape
    assert tuple(out[15, 20]) == (10, 200, 10) and np.array_equal(out[0, 0], img[0, 0])
    assert client.post("/inpaint", files=files, data={"model": "unbekannt"}).status_code == 404
    health = client.get("/health").json()
    assert any(m["id"] == "lama" for m in health["models"])


@pytest.mark.skipif(not (CACHE / "lama_fp32.onnx").exists(), reason="LaMa nicht im Test-Cache (npm run models:fetch)")
def test_real_lama_fills_plausibly(tmp_path):
    """Echtes Modell: ein Loch in einem Verlauf wird mit passenden Farben gefüllt, der Rest bleibt unverändert."""
    from ml_service.registry import load_registry

    inp = OnnxInpainter(load_registry()["lama"], "cpu", CACHE)
    img = gradient(512, 768)
    # kleine Struktur, damit das Modell etwas fortsetzen kann
    img[200:204, :] = (255, 255, 255)
    mask = np.zeros((512, 768), bool)
    mask[220:300, 330:430] = True
    out = np.asarray(inp.inpaint(Image.fromarray(img), mask, lambda p: None))
    assert out.shape == img.shape
    inside = out[225:295, 335:425].astype(float)
    ref = img[225:295, 335:425].astype(float)
    assert np.abs(inside - ref).mean() < 45  # Verlauf wird fortgesetzt, nicht Schwarz/Weiß
    assert np.array_equal(out[:150], img[:150]) and np.array_equal(out[:, :250], img[:, :250])
    assert SIZE == 512
