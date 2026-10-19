"""E3 Schritt 6: Stilübertragung (AdaIN) im Dienst – Zweitbild über die API, Lizenzsperre, Netz mit Zufallsgewichten."""

import time

import numpy as np
import torch

from ml_service.effects import EFFECTS_DIR, load_effects, run_effect
from ml_service.store import decode_f16, encode_f16

from test_effects import image, make_client, upload


def random_weights(folder, eff, monkeypatch):
    """Speichert Gewichte mit den Formen des Originals (Kodierer bis relu4_1 + Rest, Dekodierer) – ohne Download –
    und lässt die geladene Effekt-Instanz sie verwenden."""
    mod = eff.render.__globals__
    vgg, decoder = mod["_build"]()
    torch.manual_seed(0)
    state = {k: torch.randn_like(v) * 0.05 for k, v in vgg.state_dict().items()}
    # das Original enthält weitere Schichten (relu4_2 … relu5_4); sie werden beim Laden ignoriert
    state["31.weight"] = torch.zeros(512, 512, 3, 3)
    folder.mkdir(parents=True, exist_ok=True)
    torch.save(state, folder / "vgg_normalised.pth")
    torch.save({k: torch.randn_like(v) * 0.05 for k, v in decoder.state_dict().items()}, folder / "decoder.pth")
    mod["_NET"].clear()
    monkeypatch.setitem(mod, "weights_dir", lambda: folder)


def test_stylize_with_second_image(tmp_path, monkeypatch):
    eff = load_effects([EFFECTS_DIR])["style-transfer"]
    random_weights(tmp_path / "adain", eff, monkeypatch)
    img = image(48, 40)
    style = image(32, 32)[..., [2, 1, 0, 3]]
    out = run_effect(eff, img, {"size": "512"}, 1.0, (0, 0), (48, 40), lambda p: None, style)
    assert out.shape == img.shape and np.all(np.isfinite(out))
    assert np.allclose(out[..., 3], 1)
    assert np.abs(out[..., :3] - img[..., :3]).mean() > 0.01
    # ohne Stilbild unverändert
    same = run_effect(eff, img, {}, 1.0, (0, 0), (48, 40), lambda p: None, None)
    assert np.array_equal(same, img)


def test_missing_weights_message(tmp_path, monkeypatch):
    eff = load_effects([EFFECTS_DIR])["style-transfer"]
    mod = eff.render.__globals__
    mod["_NET"].clear()
    monkeypatch.setitem(mod, "weights_dir", lambda: tmp_path / "leer")
    try:
        run_effect(eff, image(), {}, 1.0, (0, 0), (32, 24), lambda p: None, image(16, 16))
    except RuntimeError as e:
        assert "Modelle" in str(e)
    else:
        raise AssertionError("fehlende Gewichte müssen gemeldet werden")


def test_api_second_image_and_license(tmp_path, monkeypatch):
    client, st = make_client(tmp_path)
    random_weights(tmp_path / "adain", st.effects["style-transfer"], monkeypatch)
    digest = upload(client, image())
    style = image(16, 16)
    style_digest = upload(client, style)
    body = {"image": digest, "imageB": style_digest, "params": {"size": "512"}, "scale": 1, "origin": [0, 0],
            "canvasSize": [32, 24]}
    # NC-Effekt: im Modus „Kommerziell“ gesperrt
    assert client.post("/effects/style-transfer/render", json={**body, "licenseMode": "commercial"}).status_code == 403
    # fehlendes Zweitbild → 409
    r = client.post("/effects/style-transfer/render", json={**body, "imageB": "0" * 64, "licenseMode": "all"})
    assert r.status_code == 409
    job = client.post("/effects/style-transfer/render", json={**body, "licenseMode": "all"}).json()
    for _ in range(200):
        s = client.get(f"/jobs/{job['id']}").json()
        if s["status"] in ("done", "error"):
            break
        time.sleep(0.02)
    assert s["status"] == "done", s
    data = client.get(f"/jobs/{job['id']}/result").content
    out = decode_f16(data, 32, 24)
    assert np.all(np.isfinite(out))
    # anderes Stilbild → anderer Cache-Schlüssel, anderes Ergebnis
    other = upload(client, image(16, 16)[..., [1, 2, 0, 3]])
    job2 = client.post("/effects/style-transfer/render", json={**body, "imageB": other, "licenseMode": "all"}).json()
    assert job2["cached"] is False
    assert encode_f16(out) == data
