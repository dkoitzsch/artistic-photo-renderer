"""Ausführung der ML-Modelle (Rolle `image-edit`): Diffusers-Pipelines (FLUX.2 klein, später z. B. FLUX 3) von ihrem Ordner.

Der Ordner wird nur gelesen (``local_files_only=True``), es wird nichts heruntergeladen oder kopiert. Die Pipeline-Klasse
steht in ``model_index.json`` und wird von diffusers selbst gewählt – neue Modellfamilien laufen ohne Codeänderung, sofern
die installierte diffusers-Version sie kennt und die Pipeline Referenzbilder (`image`) annimmt.
"""

from __future__ import annotations

import gc
import inspect
import threading
from pathlib import Path
from typing import Callable

from PIL import Image

from .mlconfig import MlModel, size_bytes

DTYPES = {"bf16": "bfloat16", "fp16": "float16", "fp32": "float32"}
MULTIPLE = 16
MIN_EDGE = 64  # kleinere Bilder lehnt die Pipeline ab


def pick_device(pref: str) -> str:
    import os

    import torch

    if pref == "auto":
        pref = os.environ.get("BLS_ML_DEVICE", "auto")  # z. B. „cpu“ für Tests
    if pref != "auto":
        return pref
    if torch.cuda.is_available():
        return "cuda"
    if torch.backends.mps.is_available():
        return "mps"
    return "cpu"


def total_ram_bytes() -> int:
    import psutil

    return int(psutil.virtual_memory().total)


def choose_offload(pref: str, weights_bytes: int, device: str, ram: int) -> str:
    """„auto“: alles im Speicher, wenn es bequem passt (≤ 60 % des Arbeitsspeichers), sonst Modell für Modell auslagern."""
    if pref != "auto":
        return pref
    if device == "cpu":
        return "none"
    return "none" if weights_bytes <= 0.6 * ram else "model"


def fit_size(width: int, height: int, max_edge: int, multiple: int = MULTIPLE) -> tuple[int, int]:
    """Größe mit erhaltenem Seitenverhältnis, lange Kante höchstens max_edge, beide Kanten Vielfache von `multiple` und ≥ 64."""
    s = min(1.0, max_edge / max(width, height))
    w = max(MIN_EDGE, round(width * s / multiple) * multiple)
    h = max(MIN_EDGE, round(height * s / multiple) * multiple)
    return int(w), int(h)


class DiffusersEngine:
    """Lädt die Pipeline beim ersten Aufruf und hält sie, bis `unload()` oder ein Modellwechsel."""

    def __init__(self, model: MlModel):
        self.model = model
        self.pipe = None
        self.device = "cpu"
        self.lock = threading.Lock()

    def load(self, progress: Callable[[float], None] = lambda p: None) -> None:
        if self.pipe is not None:
            return
        import torch
        from diffusers import DiffusionPipeline

        root = Path(self.model.root)
        self.device = pick_device(self.model.device)
        dtype = getattr(torch, DTYPES[self.model.precision])
        progress(0.02)
        pipe = DiffusionPipeline.from_pretrained(str(root), torch_dtype=dtype, local_files_only=True)
        if "image" not in inspect.signature(pipe.__call__).parameters:
            raise RuntimeError(f"{pipe.__class__.__name__} nimmt keine Referenzbilder an und kann nicht für Bildbearbeitung genutzt werden.")
        offload = choose_offload(self.model.offload, size_bytes(root), self.device, total_ram_bytes())
        if offload == "none":
            pipe.to(self.device)
        elif offload == "model":
            pipe.enable_model_cpu_offload(device=self.device)
        else:
            pipe.enable_sequential_cpu_offload(device=self.device)
        try:
            pipe.set_progress_bar_config(disable=True)
        except Exception:  # noqa: BLE001
            pass
        self.pipe = pipe
        self.offload = offload
        progress(0.1)

    def unload(self) -> None:
        self.pipe = None
        gc.collect()
        try:
            import torch

            if torch.backends.mps.is_available():
                torch.mps.empty_cache()
            if torch.cuda.is_available():
                torch.cuda.empty_cache()
        except Exception:  # noqa: BLE001
            pass

    def edit(
        self,
        images: list[Image.Image],
        prompt: str,
        seed: int,
        steps: int | None,
        guidance: float | None,
        max_edge: int,
        progress: Callable[[float], None],
    ) -> Image.Image:
        """images[0] ist das zu bearbeitende Bild, weitere sind Referenzbilder. Ausgabe in der Größe von images[0]
        (auf Vielfache von 16 gerundet, lange Kante höchstens max_edge)."""
        import torch

        with self.lock:
            self.load(progress)
            assert self.pipe is not None
            w, h = fit_size(images[0].width, images[0].height, max_edge)
            # Referenzbilder in derselben Größenordnung (Seitenverhältnis bleibt erhalten)
            ins = [im.convert("RGB").resize((w, h), Image.LANCZOS) if i == 0 else _fit(im.convert("RGB"), max_edge)
                   for i, im in enumerate(images)]
            n = steps or self.model.steps
            gen_device = "cpu"  # reproduzierbar über alle Geräte
            generator = torch.Generator(gen_device).manual_seed(int(seed) & 0x7FFFFFFF)

            def on_step(pipe, i, t, kwargs):  # noqa: ANN001
                progress(0.1 + 0.88 * (i + 1) / max(n, 1))  # wirft Cancelled bei Abbruch
                return kwargs

            kw = dict(
                image=ins,
                prompt=prompt,
                height=h,
                width=w,
                num_inference_steps=n,
                guidance_scale=guidance if guidance is not None else self.model.guidance,
                generator=generator,
                callback_on_step_end=on_step,
            )
            with torch.inference_mode():
                out = self.pipe(**kw)
            result = out.images[0]
            progress(1.0)
            return result


def _fit(im: Image.Image, max_edge: int) -> Image.Image:
    w, h = fit_size(im.width, im.height, max_edge)
    return im.resize((w, h), Image.LANCZOS)


def hardware_info() -> dict:
    try:
        import torch

        device = pick_device("auto")
        return {
            "device": device,
            "ramGB": round(total_ram_bytes() / 1024**3),
            "mps": bool(torch.backends.mps.is_available()),
            "cuda": bool(torch.cuda.is_available()),
        }
    except Exception:  # noqa: BLE001
        return {"device": "cpu", "ramGB": 0, "mps": False, "cuda": False}

