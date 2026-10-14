"""Laden und Ausführen der Segmentierungsmodelle (PyTorch, MPS auf Apple-GPU, sonst CPU)."""

from __future__ import annotations

import os
import threading
from pathlib import Path
from typing import Callable, Protocol

import numpy as np
from PIL import Image

from .registry import ServiceModel

CACHE_DIR = Path(os.environ.get("BLS_CACHE", Path.home() / ".cache" / "blur-layer-studio"))


def pick_device() -> str:
    import torch

    if torch.backends.mps.is_available():
        return "mps"
    return "cpu"


class Segmenter(Protocol):
    def __call__(self, image: Image.Image, progress: Callable[[float], None]) -> np.ndarray: ...


class HfSegmenter:
    """BiRefNet / RMBG-2.0 über transformers (Remote-Code des Modell-Repos, Revision festgelegt)."""

    def __init__(self, model: ServiceModel, device: str):
        import torch
        from transformers import AutoModelForImageSegmentation

        self.model = model
        self.device = device
        net = AutoModelForImageSegmentation.from_pretrained(
            model.hf_repo,
            revision=model.revision,
            trust_remote_code=True,
            cache_dir=str(CACHE_DIR / "hf"),
        )
        net.eval()
        # MPS: halbe Genauigkeit spart Speicher und ist deutlich schneller
        self.dtype = torch.float16 if device == "mps" else torch.float32
        self.net = net.to(device=device, dtype=self.dtype)
        self.lock = threading.Lock()

    def __call__(self, image: Image.Image, progress: Callable[[float], None]) -> np.ndarray:
        import torch
        import torch.nn.functional as F

        s = self.model.size
        w, h = image.size
        x = np.asarray(image.resize((s, s), Image.BICUBIC), dtype=np.float32) / 255.0
        x = (x - np.array(self.model.mean, dtype=np.float32)) / np.array(self.model.std, dtype=np.float32)
        t = torch.from_numpy(x.transpose(2, 0, 1)).unsqueeze(0).to(self.device, self.dtype)
        progress(0.2)
        with self.lock, torch.inference_mode():
            out = self.net(t)
            # BiRefNet/RMBG-2.0 liefern eine Liste von Stufen; die letzte ist die feinste
            logits = out[-1] if isinstance(out, (list, tuple)) else out
            prob = torch.sigmoid(logits.float())
            prob = F.interpolate(prob, size=(h, w), mode="bilinear", align_corners=False)
        progress(0.9)
        return prob[0, 0].clamp(0, 1).cpu().numpy().astype(np.float32)


def hf_cached(model: ServiceModel) -> bool:
    """Liegen die Gewichte schon im Cache (dann geht auch ein zugangsbeschränktes Modell)?"""
    try:
        from huggingface_hub import snapshot_download

        snapshot_download(model.hf_repo, revision=model.revision, cache_dir=str(CACHE_DIR / "hf"), local_files_only=True)
        return True
    except Exception:
        return False


def hf_token_present() -> bool:
    try:
        from huggingface_hub import get_token

        return bool(get_token())
    except Exception:
        return bool(os.environ.get("HF_TOKEN"))


def download(model: ServiceModel, on_progress: Callable[[float], None] | None = None) -> None:
    """Lädt die Gewichte (einmalig) in den Cache; meldet den Fortschritt anhand der Dateigrößen."""
    from huggingface_hub import HfApi, snapshot_download

    stop = threading.Event()
    if on_progress is not None:
        try:
            info = HfApi().model_info(model.hf_repo, revision=model.revision, files_metadata=True)
            total = sum((s.size or 0) for s in info.siblings or [])
        except Exception:
            total = 0
        blobs = CACHE_DIR / "hf" / f"models--{model.hf_repo.replace('/', '--')}" / "blobs"

        def watch() -> None:
            while not stop.wait(0.5):
                if total > 0 and blobs.exists():
                    done = sum(f.stat().st_size for f in blobs.iterdir() if f.is_file())
                    on_progress(min(0.99, done / total))

        threading.Thread(target=watch, daemon=True).start()
    try:
        snapshot_download(model.hf_repo, revision=model.revision, cache_dir=str(CACHE_DIR / "hf"))
    finally:
        stop.set()
        if on_progress is not None:
            on_progress(1.0)
