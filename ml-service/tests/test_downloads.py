import io
import threading
import time

from fastapi.testclient import TestClient

from ml_service.downloads import Downloader
from ml_service.main import State, create_app
from ml_service.registry import load_registry

MODEL = load_registry()["birefnet"]
FILES = {"config.json": b"{}" * 10, "model.safetensors": bytes(range(256)) * 4000}


class SlowStream(io.BytesIO):
    """Liefert in kleinen Stücken; gate erlaubt das Anhalten mitten im Download."""

    status = 200

    def __init__(self, data, gate: threading.Event | None):
        super().__init__(data)
        self.gate = gate

    def read(self, n=-1):
        if self.gate is not None:
            self.gate.wait(2)
            time.sleep(0.001)  # langsam genug, um mitten im Download anzuhalten
        return super().read(min(n if n > 0 else 1 << 30, 4096))


def make(tmp_path, gate=None, range_ok=True):
    def open_file(model, name, offset, token):
        s = SlowStream(FILES[name][offset:] if range_ok else FILES[name], gate)
        s.status = 206 if offset and range_ok else 200
        return s

    return Downloader(tmp_path, list_files=lambda m, t: [(k, len(v)) for k, v in FILES.items()], open_file=open_file)


def wait_status(d, status, timeout=5):
    t0 = time.time()
    while time.time() - t0 < timeout:
        if d.state(MODEL).status == status:
            return
        time.sleep(0.01)
    raise AssertionError(f"Status {d.state(MODEL).status} statt {status}")


def test_complete_download(tmp_path):
    d = make(tmp_path)
    d.start(MODEL)
    d.wait(MODEL)
    assert d.state(MODEL).status == "done"
    assert d.is_complete(MODEL)
    assert (tmp_path / "birefnet" / "model.safetensors").read_bytes() == FILES["model.safetensors"]
    assert d.state(MODEL).loaded == d.state(MODEL).total == sum(len(v) for v in FILES.values())


def test_pause_and_resume_continues_from_partial(tmp_path):
    gate = threading.Event()
    d = make(tmp_path, gate)
    d.start(MODEL)
    gate.set()
    time.sleep(0.02)
    d.pause(MODEL)
    d.wait(MODEL)
    st = d.state(MODEL)
    assert st.status == "paused"
    assert 0 < st.loaded < st.total
    partial = st.loaded
    # Fortsetzen (neuer Manager wie nach Neustart des Dienstes)
    d2 = make(tmp_path)
    assert d2.state(MODEL).status == "paused"
    d2.start(MODEL)
    d2.wait(MODEL)
    assert d2.state(MODEL).status == "done"
    assert d2.state(MODEL).loaded >= partial
    assert (tmp_path / "birefnet" / "model.safetensors").read_bytes() == FILES["model.safetensors"]


def test_resume_without_range_support_restarts_file(tmp_path):
    gate = threading.Event()
    d = make(tmp_path, gate)
    d.start(MODEL)
    gate.set()
    time.sleep(0.02)
    d.pause(MODEL)
    d.wait(MODEL)
    d2 = make(tmp_path, range_ok=False)
    d2.start(MODEL)
    d2.wait(MODEL)
    assert (tmp_path / "birefnet" / "model.safetensors").read_bytes() == FILES["model.safetensors"]


def test_stop_discards_partial_and_delete_removes_model(tmp_path):
    gate = threading.Event()
    d = make(tmp_path, gate)
    d.start(MODEL)
    gate.set()
    time.sleep(0.02)
    d.stop(MODEL)
    assert d.state(MODEL).status == "missing"
    assert not (tmp_path / "birefnet").exists()
    d.start(MODEL)
    d.wait(MODEL)
    assert d.is_complete(MODEL)
    d.delete(MODEL)
    assert not (tmp_path / "birefnet").exists()
    assert d.state(MODEL).status == "missing"


def test_endpoints_control_downloads_and_respect_license(tmp_path):
    gate = threading.Event()
    st = State(factory=lambda m, dev, p: None, prefetch=False, downloader=make(tmp_path, gate))
    st._models.legacy_snapshot = lambda m: None  # type: ignore[attr-defined]
    client = TestClient(create_app(st))
    health = {m["id"]: m for m in client.get("/health").json()["models"]}
    assert health["birefnet"]["download"]["status"] == "missing"
    assert client.post("/models/birefnet/download").json()["status"] == "downloading"
    gate.set()
    time.sleep(0.02)
    assert client.post("/models/birefnet/pause").status_code == 200
    st.downloads.wait(MODEL)
    assert client.get("/health").json()["models"][0]["note"] == "Download pausiert"
    client.post("/models/birefnet/download")
    st.downloads.wait(MODEL)
    health = {m["id"]: m for m in client.get("/health").json()["models"]}
    assert health["birefnet"]["download"]["status"] == "done"
    assert health["birefnet"]["available"] is True
    # NC-Modell im Modus „Kommerziell“: auch kein Download
    assert client.post("/models/rmbg-2.0/download?license_mode=commercial").status_code == 403
    assert client.delete("/models/birefnet").json()["status"] == "missing"
