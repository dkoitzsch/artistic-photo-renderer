"""Download-Manager des Dienstes: lädt die Dateien eines Modell-Repos (feste Revision) in einen lokalen Ordner.

Pausieren hält an und behält Teil-Dateien (.part); Fortsetzen lädt per HTTP-Range weiter; Stoppen verwirft sie;
Löschen entfernt das fertige Modell. Fertig ist ein Modell, wenn die Markierungsdatei .complete die Revision enthält.
"""

from __future__ import annotations

import shutil
import threading
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable

from .registry import ServiceModel

CHUNK = 1 << 20


@dataclass
class DownloadState:
    status: str = "missing"  # missing | downloading | paused | done | error
    loaded: int = 0
    total: int = 0
    error: str | None = None


@dataclass
class _Control:
    pause: threading.Event = field(default_factory=threading.Event)
    stop: threading.Event = field(default_factory=threading.Event)
    thread: threading.Thread | None = None


class Stopped(Exception):
    pass


class Paused(Exception):
    pass


FileList = list[tuple[str, int]]  # (Dateiname im Repo, Größe)


def hf_file_list(model: ServiceModel, token: str | None) -> FileList:
    if model.files:
        return [(name, size) for name, _url, _sha, size in model.files]
    from huggingface_hub import HfApi

    info = HfApi().model_info(model.hf_repo, revision=model.revision, files_metadata=True, token=token)
    return [(s.rfilename, int(s.size or 0)) for s in info.siblings or [] if not s.rfilename.startswith(".")]


def hf_open(model: ServiceModel, name: str, offset: int, token: str | None):
    """Öffnet eine Datei des Repos als Stream ab offset (Range)."""
    import urllib.request

    direct = next((url for n, url, _sha, _size in model.files if n == name), None)
    if direct:
        req = urllib.request.Request(direct)
        if offset:
            req.add_header("Range", f"bytes={offset}-")
        return urllib.request.urlopen(req, timeout=60)  # noqa: S310 (feste URL aus dem Register)

    from huggingface_hub import hf_hub_url

    req = urllib.request.Request(hf_hub_url(model.hf_repo, name, revision=model.revision))
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    if offset:
        req.add_header("Range", f"bytes={offset}-")
    return urllib.request.urlopen(req, timeout=60)  # noqa: S310 (feste HF-URL)


def _sha256(path: Path) -> str:
    import hashlib

    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(CHUNK), b""):
            h.update(chunk)
    return h.hexdigest()


class Downloader:
    def __init__(
        self,
        root: Path,
        list_files: Callable[[ServiceModel, str | None], FileList] = hf_file_list,
        open_file: Callable = hf_open,
        token: Callable[[], str | None] = lambda: None,
    ):
        self.root = root
        self.list_files = list_files
        self.open_file = open_file
        self.token = token
        self.states: dict[str, DownloadState] = {}
        self.controls: dict[str, _Control] = {}
        self.lock = threading.Lock()

    def dir(self, model: ServiceModel) -> Path:
        return self.root / model.id

    def is_complete(self, model: ServiceModel) -> bool:
        marker = self.dir(model) / ".complete"
        return marker.exists() and marker.read_text().strip() == model.revision

    def state(self, model: ServiceModel) -> DownloadState:
        with self.lock:
            st = self.states.get(model.id)
            if st is None:
                st = DownloadState()
                if self.is_complete(model):
                    st.status = "done"
                else:
                    partial = sum(f.stat().st_size for f in self.dir(model).rglob("*") if f.is_file()) if self.dir(model).exists() else 0
                    if partial:
                        st.status, st.loaded = "paused", partial
                self.states[model.id] = st
            return st

    def start(self, model: ServiceModel) -> None:
        st = self.state(model)
        with self.lock:
            ctrl = self.controls.get(model.id)
            if st.status == "done" or (ctrl and ctrl.thread and ctrl.thread.is_alive()):
                return
            ctrl = _Control()
            self.controls[model.id] = ctrl
            st.status, st.error = "downloading", None
            ctrl.thread = threading.Thread(target=self._run, args=(model, ctrl), daemon=True, name=f"dl-{model.id}")
            ctrl.thread.start()

    def pause(self, model: ServiceModel) -> None:
        ctrl = self.controls.get(model.id)
        if ctrl:
            ctrl.pause.set()

    def stop(self, model: ServiceModel) -> None:
        ctrl = self.controls.get(model.id)
        if ctrl and ctrl.thread and ctrl.thread.is_alive():
            ctrl.stop.set()
            ctrl.thread.join(timeout=30)
        if not self.is_complete(model):
            shutil.rmtree(self.dir(model), ignore_errors=True)
            self.states[model.id] = DownloadState()

    def delete(self, model: ServiceModel) -> None:
        self.stop(model)
        shutil.rmtree(self.dir(model), ignore_errors=True)
        self.states[model.id] = DownloadState()

    def wait(self, model: ServiceModel) -> None:
        ctrl = self.controls.get(model.id)
        if ctrl and ctrl.thread:
            ctrl.thread.join()

    def _run(self, model: ServiceModel, ctrl: _Control) -> None:
        st = self.states[model.id]
        d = self.dir(model)
        try:
            token = self.token()
            files = self.list_files(model, token)
            st.total = sum(size for _, size in files)
            d.mkdir(parents=True, exist_ok=True)
            done_bytes = 0
            for name, size in files:
                target = d / name
                target.parent.mkdir(parents=True, exist_ok=True)
                if target.exists() and target.stat().st_size == size:
                    done_bytes += size
                    st.loaded = done_bytes
                    continue
                part = target.with_name(target.name + ".part")
                offset = part.stat().st_size if part.exists() else 0
                with self.open_file(model, name, offset, token) as resp:
                    if offset and getattr(resp, "status", 206) != 206:
                        offset = 0  # Server setzt nicht fort → von vorn
                    with open(part, "ab" if offset else "wb") as out:
                        while True:
                            if ctrl.stop.is_set():
                                raise Stopped()
                            if ctrl.pause.is_set():
                                raise Paused()
                            chunk = resp.read(CHUNK)
                            if not chunk:
                                break
                            out.write(chunk)
                            offset += len(chunk)
                            st.loaded = done_bytes + offset
                if size and offset != size:
                    raise RuntimeError(f"{name}: unvollständig ({offset} von {size} Byte)")
                expected = next((sha for n, _url, sha, _size in model.files if n == name), None)
                if expected and _sha256(part) != expected:
                    part.unlink(missing_ok=True)
                    raise RuntimeError(f"{name}: Prüfsumme stimmt nicht")
                part.rename(target)
                done_bytes += size
                st.loaded = done_bytes
            (d / ".complete").write_text(model.revision)
            st.status = "done"
        except Paused:
            st.status = "paused"
        except Stopped:
            shutil.rmtree(d, ignore_errors=True)
            self.states[model.id] = DownloadState()
        except Exception as e:  # Fehler anzeigen, Dienst läuft weiter
            st.status, st.error = "error", str(e)
