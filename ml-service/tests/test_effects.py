"""E1 Schritt 7: Effekt-Registry, Bild-Upload, Rendern, Ergebnis-Cache, Abbruch, Lizenz, Zufall, Analysekarten."""

import hashlib
import time

import numpy as np
from fastapi.testclient import TestClient

from ml_service import analysis
from ml_service.effects import EFFECTS_DIR, TEST_EFFECTS_DIR, load_effects, rand_cell
from ml_service.main import State, create_app
from ml_service.store import decode_f16, encode_f16


def make_client(tmp_path):
    from ml_service.downloads import Downloader

    effects = load_effects([EFFECTS_DIR, TEST_EFFECTS_DIR])
    st = State(
        factory=lambda m, d, p: None,
        prefetch=False,
        downloader=Downloader(tmp_path / "models", list_files=lambda m, t: [], open_file=None),
        cache_dir=tmp_path,
        effects=effects,
    )
    return TestClient(create_app(st)), st


def image(w=32, h=24):
    """Testbild: linearer Verlauf (deckend), RGBA float32 vormultipliziert."""
    x = np.linspace(0, 1, w, dtype=np.float32)
    img = np.zeros((h, w, 4), dtype=np.float32)
    img[..., 0] = x[None, :]
    img[..., 1] = 0.5
    img[..., 2] = x[::-1][None, :]
    img[..., 3] = 1
    return img


def upload(client, img):
    data = encode_f16(img)
    digest = hashlib.sha256(data).hexdigest()
    h, w = img.shape[:2]
    r = client.put(f"/images/{digest}?width={w}&height={h}", content=data)
    assert r.status_code == 200, r.text
    return digest


def wait(client, job_id, timeout=10.0):
    end = time.time() + timeout
    while time.time() < end:
        s = client.get(f"/jobs/{job_id}").json()
        if s["status"] in ("done", "error", "cancelled"):
            return s
        time.sleep(0.02)
    raise AssertionError("Job hängt")


def render(client, effect, digest, params=None, mode="commercial", w=32, h=24):
    return client.post(
        f"/effects/{effect}/render",
        json={"image": digest, "params": params or {}, "scale": 1, "origin": [0, 0], "canvasSize": [w, h],
              "licenseMode": mode},
    )


def result(client, job_id):
    r = client.get(f"/jobs/{job_id}/result")
    assert r.status_code == 200
    return decode_f16(r.content, int(r.headers["x-width"]), int(r.headers["x-height"])), r.headers


def test_registry_reads_shared_manifests():
    effects = load_effects([EFFECTS_DIR, TEST_EFFECTS_DIR])
    assert effects["gaussian-blur"].uses_python is False  # reiner GPU-Effekt
    inv = effects["zz-e2e-py-invert"]
    assert inv.uses_python and inv.render is not None and inv.error is None
    # randomized → Seed-Parameter wie im Browser ergänzt
    assert any(p["key"] == "seed" and p["type"] == "seed" for p in inv.params)
    assert effects["zz-e2e-py-nc"].commercial_use is False


def test_image_upload_checks_hash_and_size(tmp_path):
    client, _ = make_client(tmp_path)
    data = encode_f16(image())
    bad = client.put(f"/images/{'0' * 64}?width=32&height=24", content=data)
    assert bad.status_code == 400
    digest = hashlib.sha256(data).hexdigest()
    assert client.head(f"/images/{digest}").status_code == 404
    wrong = client.put(f"/images/{digest}?width=31&height=24", content=data)
    assert wrong.status_code == 400
    upload(client, image())
    assert client.head(f"/images/{digest}").status_code == 200


def test_render_result_and_cache(tmp_path):
    client, _ = make_client(tmp_path)
    img = image()
    digest = upload(client, img)
    r = render(client, "zz-e2e-py-invert", digest)
    assert r.status_code == 200 and r.json()["cached"] is False
    s = wait(client, r.json()["id"])
    assert s["status"] == "done" and s["resultUrl"].endswith("/result")
    out, headers = result(client, r.json()["id"])
    assert headers["x-cached"] == "0"
    # Invertieren in sRGB: Rot (linear 0 → sRGB 0) wird 1
    assert out.shape == img.shape
    assert abs(out[0, 0, 0] - 1.0) < 2e-3
    assert np.allclose(out[..., 3], 1.0)
    # gleiche Anfrage → sofort aus dem Cache
    r2 = render(client, "zz-e2e-py-invert", digest)
    assert r2.json()["cached"] is True and r2.json()["status"] == "done"
    out2, headers2 = result(client, r2.json()["id"])
    assert headers2["x-cached"] == "1"
    assert np.array_equal(out, out2)
    # andere Parameter → neue Rechnung
    r3 = render(client, "zz-e2e-py-invert", digest, {"amount": 50})
    assert r3.json()["cached"] is False


def test_render_requires_uploaded_image_and_python_effect(tmp_path):
    client, _ = make_client(tmp_path)
    assert render(client, "zz-e2e-py-invert", "ab" * 32).status_code == 409
    digest = upload(client, image())
    assert render(client, "gaussian-blur", digest).status_code == 404
    assert render(client, "gibt-es-nicht", digest).status_code == 404


def test_cancel_running_job(tmp_path):
    client, _ = make_client(tmp_path)
    digest = upload(client, image())
    r = render(client, "zz-e2e-py-invert", digest, {"delay": 5})
    job = r.json()["id"]
    time.sleep(0.2)
    c = client.delete(f"/jobs/{job}")
    assert c.status_code == 200
    s = wait(client, job)
    assert s["status"] == "cancelled"
    assert client.get(f"/jobs/{job}/result").status_code == 404
    assert client.delete("/jobs/unbekannt").status_code == 404


def test_license_gate_for_effects(tmp_path):
    client, _ = make_client(tmp_path)
    digest = upload(client, image())
    assert render(client, "zz-e2e-py-nc", digest, mode="commercial").status_code == 403
    r = render(client, "zz-e2e-py-nc", digest, mode="all")
    assert wait(client, r.json()["id"])["status"] == "done"
    h = client.get("/health").json()
    by_id = {e["id"]: e for e in h["effects"]}
    assert by_id["zz-e2e-py-invert"]["available"] is True
    assert by_id["zz-e2e-py-nc"]["available"] is False
    assert "gaussian-blur" not in by_id


def test_seed_noise_matches_browser_random(tmp_path):
    client, _ = make_client(tmp_path)
    img = image()
    digest = upload(client, img)
    r = render(client, "zz-e2e-py-invert", digest, {"noise": 1.0, "seed": 5})
    wait(client, r.json()["id"])
    out, _ = result(client, r.json()["id"])
    r2 = render(client, "zz-e2e-py-invert", digest, {"noise": 1.0, "seed": 6})
    wait(client, r2.json()["id"])
    other, _ = result(client, r2.json()["id"])
    assert not np.allclose(out, other)
    # Referenzwerte wie in tests/unit/random.test.ts (randCell im Browser = rand_cell im Shader)
    ref = [((10, -3, 42, 0), 0.547438383102417), ((0, 0, 7, 0), 0.9950028657913208),
           ((123, 456, 1, 2), 0.21902084350585938), ((-5, 9, 4000000000, 1), 0.2546077370643616)]
    for (x, y, seed, k), want in ref:
        assert float(rand_cell(np.array(x), np.array(y), seed, k)) == want
    xs = np.arange(4)
    vals = rand_cell(xs, np.zeros_like(xs), 7)
    assert vals.shape == (4,) and np.all((vals >= 0) & (vals < 1))


def test_analysis_maps():
    # senkrechte Kante: links schwarz, rechts weiß
    img = np.zeros((20, 20, 4), dtype=np.float32)
    img[:, 10:, :3] = 1
    img[..., 3] = 1
    lum = analysis.luminance(img)
    assert lum[0, 0] == 0 and abs(lum[0, 19] - 1) < 1e-6
    e = analysis.edges(img)
    s, tx, ty, coh = e[10, 10]
    assert s == 1.0  # Sprung 1 → |∇| = 0,5 je px · 8 → begrenzt auf 1
    assert abs(abs(ty * 2 - 1) - 1) < 1e-3  # Tangente senkrecht
    assert coh > 0.95
    assert e[10, 2, 0] == 0  # keine Kante in der Fläche


def test_flow_map():
    """Richtungsfeld: an einer senkrechten Kante senkrecht; in der Fläche daneben setzt sich die Richtung fort."""
    img = np.zeros((96, 96, 4), dtype=np.float32)
    img[:, 48:, :3] = 1
    img[..., 3] = 1
    f = analysis.flow(img)
    assert f.shape == (96, 96, 4) and np.isfinite(f).all()
    for x in (47, 30, 70):  # an der Kante und 18–22 px daneben (nur das ferne Feld reicht so weit)
        ty = f[48, x, 2] * 2 - 1
        assert abs(abs(ty) - 1) < 1e-3, (x, ty)
        assert f[48, x, 3] > 0.95
    # Kreis: Tangente steht senkrecht auf dem Radius
    yy, xx = np.mgrid[0:96, 0:96]
    disk = ((xx - 48) ** 2 + (yy - 48) ** 2 < 30**2).astype(np.float32)
    img2 = np.repeat(disk[..., None], 4, axis=-1)
    img2[..., 3] = 1
    g = analysis.flow(img2)
    for y, x in ((48, 18), (18, 48), (27, 27)):
        t = g[y, x, 1:3] * 2 - 1
        r = np.array([x - 48, y - 48], dtype=np.float32)
        assert abs(float(t @ r)) / np.linalg.norm(r) < 0.1, (y, x, t)


def test_low_poly_random_matches_browser():
    """Zufall der Punktauswahl bitgleich zu mulberry32 in src/effects/random.ts (Referenzwerte wie random.test.ts)."""
    import importlib.util

    spec = importlib.util.spec_from_file_location("lowpoly", EFFECTS_DIR / "low-poly" / "effect.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    a = mod._mulberry32(5)
    assert [a(), a(), a()] == [0.6897749109193683, 0.7727432732935995, 0.21976301027461886]
    b = mod._mulberry32(4000000000)
    assert [b(), b()] == [0.6919068221468478, 0.5511944761965424]


def test_low_poly_renders_in_service(tmp_path):
    client, _ = make_client(tmp_path)
    img = image(48, 32)
    digest = upload(client, img)
    r = client.post(
        "/effects/low-poly/render",
        json={"image": digest, "params": {"points": 60}, "scale": 1, "origin": [0, 0], "canvasSize": [48, 32]},
    )
    assert wait(client, r.json()["id"])["status"] == "done"
    out, _ = result(client, r.json()["id"])
    assert out.shape == img.shape and np.isfinite(out).all()
    # einfarbige Dreiecksflächen: die meisten Nachbarpixel sind gleich, im Verlaufsbild keiner
    same = np.all(out[:, 1:] == out[:, :-1], axis=-1).mean()
    assert same > 0.5
    assert np.all(img[:, 1:] == img[:, :-1], axis=-1).mean() == 0
