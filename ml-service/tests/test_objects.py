"""Phase 6: Objekt-Aufteilung (SAM 2.1) – Auswahl der Instanzmasken (rein), API mit Ersatzmodell, echtes Modell
(SAM 2.1 Tiny aus dem Test-Cache, npm run models:fetch)."""

import io
import json
import time
from pathlib import Path

import numpy as np
import pytest
from PIL import Image

from ml_service.objects import HfSam2Objects, select_objects

from test_service import make_client

ROOT = Path(__file__).resolve().parents[2]
TINY = ROOT / "tests" / ".cache" / "models" / "sam2.1-hiera-tiny"


def logits_for(masks, h=64, w=64):
    """Maskenliste (bool) → Logits (N, 1, h, w): innen +4, außen −4."""
    arr = np.stack([np.where(m, 4.0, -4.0) for m in masks])[:, None]
    return arr.astype(np.float32)


def rect(h, w, y0, y1, x0, x1):
    m = np.zeros((h, w), bool)
    m[y0:y1, x0:x1] = True
    return m


def test_select_objects_orders_big_first_and_drops_duplicates():
    big = rect(64, 64, 8, 56, 8, 56)
    small = rect(64, 64, 20, 36, 20, 36)  # liegt im großen Objekt
    dup = rect(64, 64, 9, 56, 8, 55)  # fast gleich wie das große
    tiny = rect(64, 64, 0, 3, 0, 3)  # zu klein
    logits = logits_for([big, small, dup, tiny])
    scores = np.array([[0.95], [0.9], [0.93], [0.99]], np.float32)
    labels, objs = select_objects(logits, scores, max_objects=8)
    assert labels.shape == (64, 64) and labels.dtype == np.uint16
    assert [o["label"] for o in objs] == [1, 2]
    # das große Objekt behält nur, was das kleine nicht verdeckt; das kleine liegt darüber
    assert labels[30, 30] == 2 and labels[10, 10] == 1 and labels[0, 0] == 0
    assert objs[0]["area"] > objs[1]["area"]


def test_low_score_and_unstable_masks_are_dropped():
    m = rect(64, 64, 10, 50, 10, 50)
    good = np.where(m, 4.0, -4.0)
    # instabil: Logits nahe 0 → Rand ändert sich stark mit der Schwelle
    unstable = np.where(m, 0.5, -0.5)
    logits = np.stack([good, unstable])[:, None].astype(np.float32)
    labels, objs = select_objects(logits, np.array([[0.2], [0.95]], np.float32))
    assert objs == [] and not labels.any()
    labels, objs = select_objects(logits, np.array([[0.95], [0.95]], np.float32))
    assert len(objs) == 1


def test_max_objects_limits():
    masks = [rect(64, 64, 4 + 14 * i, 14 + 14 * i, 4, 60) for i in range(4)]
    logits = logits_for(masks)
    scores = np.full((4, 1), 0.95, np.float32)
    _, objs = select_objects(logits, scores, max_objects=2)
    assert len(objs) == 2


class FakeObjects:
    def __init__(self, model, device, path):
        self.model = model

    def objects(self, image, max_objects, grid, progress):
        w, h = image.size
        lab = np.zeros((h, w), np.uint16)
        lab[: h // 2, : w // 2] = 1
        lab[h // 2 :, w // 2 :] = 2
        progress(0.5)
        return lab, [{"label": 1, "score": 0.9, "area": 0.25}, {"label": 2, "score": 0.8, "area": 0.25}]


def wait(client, job_id):
    for _ in range(300):
        s = client.get(f"/jobs/{job_id}").json()
        if s["status"] in ("done", "error"):
            return s
        time.sleep(0.02)
    raise AssertionError("Job hängt")


def test_api_segment_objects_and_license(tmp_path):
    client, st = make_client(tmp_path)
    st.factory = FakeObjects
    buf = io.BytesIO()
    Image.new("RGB", (40, 30), (10, 20, 30)).save(buf, format="PNG")
    files = {"image": ("a.png", buf.getvalue(), "image/png")}
    r = client.post("/segment/objects", files=files, data={"model": "sam2.1-large", "max_objects": "5"})
    assert r.status_code == 200
    assert wait(client, r.json()["id"])["status"] == "done"
    res = client.get(f"/jobs/{r.json()['id']}/result")
    objs = json.loads(res.headers["x-objects"])
    assert [o["label"] for o in objs] == [1, 2]
    assert res.headers["x-width"] == "40" and res.headers["x-height"] == "30"
    lab = np.asarray(Image.open(io.BytesIO(res.content)))
    assert lab.dtype == np.uint16 and lab.shape == (30, 40)
    # PNG16 speichert Etikett/65535 skaliert zurück: ganze Zahlen
    assert set(np.unique(lab).tolist()) == {0, 1, 2}
    assert client.post("/segment/objects", files=files, data={"model": "nein"}).status_code == 404


@pytest.mark.skipif(not (TINY / "model.safetensors").exists(), reason="SAM 2.1 Tiny fehlt (npm run models:fetch)")
def test_real_sam_finds_objects_in_a_scene():
    """Echtes Modell: zwei klar getrennte, farbige Flächen auf ruhigem Grund werden als eigene Objekte gefunden."""
    from ml_service.registry import load_registry

    h, w = 256, 384
    img = np.full((h, w, 3), (150, 170, 190), np.uint8)
    y, x = np.mgrid[0:h, 0:w]
    img[((x - 110) ** 2 + (y - 120) ** 2) < 60**2] = (200, 40, 40)
    img[(abs(x - 280) < 55) & (abs(y - 130) < 70)] = (30, 120, 60)
    sam = HfSam2Objects(load_registry()["sam2.1-large"], "cpu", TINY)
    labels, objs = sam.objects(Image.fromarray(img), 6, 8, lambda p: None)
    assert labels.shape == (h, w) and len(objs) >= 2
    # in der Mitte der Kreise/des Rechtecks liegt jeweils ein Objekt, und es sind verschiedene
    a, b = labels[120, 110], labels[130, 280]
    assert a > 0 and b > 0 and a != b
    assert labels[5, 5] != a and labels[5, 5] != b
