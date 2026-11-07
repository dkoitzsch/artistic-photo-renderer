"""ML-Modellverwaltung (Konfiguration, Status, Lizenz) und /ml/edit – mit einem winzigen FLUX.2-Pipeline-Ordner."""

import io
import time
from pathlib import Path

import numpy as np
import pytest
from fastapi.testclient import TestClient
from PIL import Image

from ml_service import mlconfig
from ml_service.main import State, create_app
from ml_service.mlengine import choose_offload, fit_size

from mini_flux import build


@pytest.fixture(scope="module")
def mini_root(tmp_path_factory) -> Path:
    return build(tmp_path_factory.mktemp("mini-flux"))


def entry(root, **kw):
    d = {"name": "Mini", "roles": ["image-edit"], "root": str(root), "precision": "fp32", "device": "cpu", "offload": "none",
         "steps": 2, "outputCommercialUse": True}
    d.update(kw)
    return d


def make_client(tmp_path) -> tuple[TestClient, State]:
    from ml_service.downloads import Downloader

    st = State(prefetch=False, downloader=Downloader(tmp_path / "dl", list_files=lambda m, t: [], open_file=None))
    st.ml_config_path = tmp_path / "models.yaml"
    return TestClient(create_app(st)), st


def png(w=64, h=48, color=(200, 100, 50)):
    buf = io.BytesIO()
    Image.new("RGB", (w, h), color).save(buf, format="PNG")
    return buf.getvalue()


def wait(client, jid):
    for _ in range(600):
        s = client.get(f"/jobs/{jid}").json()
        if s["status"] in ("done", "error", "cancelled"):
            return s
        time.sleep(0.05)
    raise AssertionError("Job hängt")


def test_fit_size_keeps_aspect_and_multiples():
    assert fit_size(4000, 3000, 1024) == (1024, 768)
    assert fit_size(100, 50, 1024) == (96, 64)  # nie vergrößern, Vielfache von 16, mindestens 64
    w, h = fit_size(3000, 4000, 1000)
    assert w % 16 == 0 and h % 16 == 0 and max(w, h) <= 1008


def test_offload_choice():
    gb = 1024**3
    assert choose_offload("auto", 18 * gb, "mps", 48 * gb) == "none"
    assert choose_offload("auto", 35 * gb, "mps", 48 * gb) == "model"
    assert choose_offload("auto", 35 * gb, "cpu", 48 * gb) == "none"
    assert choose_offload("sequential", 1, "mps", 48 * gb) == "sequential"


def test_config_roundtrip_validation_and_defaults(tmp_path, mini_root):
    p = tmp_path / "cfg" / "models.yaml"
    a = mlconfig.from_dict({**entry(mini_root), "id": "a"})
    b = mlconfig.from_dict({**entry(mini_root, roles=["image-edit", "image-generate"]), "id": "b", "defaultForRoles": ["image-edit"]})
    models = mlconfig.upsert(mlconfig.upsert([], a), b)
    mlconfig.save_models(models, p)
    back = mlconfig.load_models(p)
    assert [m.id for m in back] == ["a", "b"]
    assert mlconfig.default_for(back, "image-edit").id == "b"  # jüngster ausdrücklicher Standard
    assert mlconfig.default_for(back, "image-generate").id == "b"
    for bad in (
        {**entry(mini_root), "id": "Groß!"},
        {**entry(mini_root), "id": "x", "roles": []},
        {**entry(mini_root), "id": "x", "roles": ["unbekannt"]},
        {**entry("relativ/pfad"), "id": "x"},
        {**entry(mini_root), "id": "x", "precision": "int3"},
    ):
        with pytest.raises(mlconfig.ConfigError):
            mlconfig.from_dict(bad)


def test_status_missing_and_not_diffusers(tmp_path, mini_root):
    m = mlconfig.from_dict({**entry(tmp_path / "gibt-es-nicht"), "id": "x"})
    assert mlconfig.status_of(m)["available"] is False
    (tmp_path / "leer").mkdir()
    m2 = mlconfig.from_dict({**entry(tmp_path / "leer"), "id": "y"})
    assert "model_index.json" in mlconfig.status_of(m2)["note"]
    ok = mlconfig.status_of(mlconfig.from_dict({**entry(mini_root), "id": "z"}))
    assert ok["available"] and ok["pipeline"] == "Flux2KleinPipeline" and len(ok["fingerprint"]) == 16


def test_api_register_list_check_delete_never_touches_files(tmp_path, mini_root):
    client, st = make_client(tmp_path)
    assert client.get("/ml/models").json()["models"] == []
    r = client.put("/ml/models/mini", json=entry(mini_root))
    assert r.status_code == 200 and r.json()["status"]["available"] and r.json()["roleDefaults"] == ["image-edit"]
    assert client.put("/ml/models/BAD", json=entry(mini_root)).status_code == 400
    lst = client.get("/ml/models").json()
    assert lst["models"][0]["id"] == "mini" and lst["hardware"]["device"] in ("mps", "cuda", "cpu")
    assert (tmp_path / "models.yaml").exists()
    before = sorted(p.name for p in mini_root.iterdir())
    assert client.delete("/ml/models/mini").json() == {"removed": "mini"}
    assert client.get("/ml/models").json()["models"] == []
    assert sorted(p.name for p in mini_root.iterdir()) == before  # Dateien bleiben


def test_edit_with_reference_license_and_errors(tmp_path, mini_root):
    client, st = make_client(tmp_path)
    files = lambda: [("image", ("a.png", png(96, 64), "image/png")), ("refs", ("s.png", png(64, 64, (10, 20, 200)), "image/png"))]  # noqa: E731
    # kein Modell eingerichtet
    assert client.post("/ml/edit", files=files(), data={"prompt": "x"}).status_code == 404
    client.put("/ml/models/mini", json=entry(mini_root, outputCommercialUse=False))
    # Lizenzmodus „Kommerziell“: gesperrt, „Alle“: erlaubt
    assert client.post("/ml/edit", files=files(), data={"prompt": "x", "license_mode": "commercial"}).status_code == 403
    r = client.post("/ml/edit", files=files(), data={"prompt": "Stil übertragen", "seed": "7", "max_edge": "256", "license_mode": "all"})
    assert r.status_code == 200
    done = wait(client, r.json()["id"])
    assert done["status"] == "done", done.get("message")
    res = client.get(f"/jobs/{r.json()['id']}/result")
    img = Image.open(io.BytesIO(res.content))
    assert img.size == (96, 64) and res.headers["x-seed"] == "7"
    # gleicher Seed → gleiches Ergebnis, anderer Seed → anderes
    def run(seed):
        j = client.post("/ml/edit", files=files(), data={"prompt": "p", "seed": str(seed), "license_mode": "all"}).json()["id"]
        done = wait(client, j)
        assert done["status"] == "done", done.get("message")
        return np.asarray(Image.open(io.BytesIO(client.get(f"/jobs/{j}/result").content)))
    a, b, c = run(1), run(1), run(2)
    assert np.array_equal(a, b) and not np.array_equal(a, c)
    # Entladen
    assert client.post("/ml/unload").json()["unloaded"] == 1
    # fehlender Ordner → 503
    client.put("/ml/models/mini", json=entry(tmp_path / "weg", outputCommercialUse=True))
    assert client.post("/ml/edit", files=files(), data={"prompt": "x"}).status_code == 503
