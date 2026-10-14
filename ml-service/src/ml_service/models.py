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

    def __init__(self, model: ServiceModel, device: str, path: Path):
        import torch
        from transformers import AutoModelForImageSegmentation

        self.model = model
        self.device = device
        # Lokaler Ordner aus dem Download-Manager (Code + Gewichte, Revision festgelegt)
        net = AutoModelForImageSegmentation.from_pretrained(str(path), trust_remote_code=True)
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


def hf_token() -> str | None:
    try:
        from huggingface_hub import get_token

        return get_token()
    except Exception:
        return os.environ.get("HF_TOKEN")


def remove_legacy(model: ServiceModel) -> None:
    """Entfernt eine ältere Kopie aus dem Hugging-Face-Cache."""
    import shutil

    shutil.rmtree(CACHE_DIR / "hf" / f"models--{model.hf_repo.replace('/', '--')}", ignore_errors=True)


def legacy_snapshot(model: ServiceModel) -> str | None:
    """Ordner eines früher per Hugging-Face-Cache geladenen Modells (falls vorhanden)."""
    try:
        from huggingface_hub import snapshot_download

        return snapshot_download(
            model.hf_repo, revision=model.revision, cache_dir=str(CACHE_DIR / "hf"), local_files_only=True
        )
    except Exception:
        return None
