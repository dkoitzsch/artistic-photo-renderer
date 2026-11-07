"""Inpainting mit LaMa (big-lama, ONNX-Export von Carve/LaMa-ONNX, Apache-2.0) über onnxruntime.

Das Modell hat eine feste Eingangsgröße von 512 × 512 px. Für beliebige Bilder wird je zusammenhängendem Lochbereich ein
quadratischer Ausschnitt um das Loch (mit Umgebung als Kontext) auf 512 px skaliert, gefüllt, zurückskaliert und nur im
Lochbereich (weich eingeblendet) ins Original übernommen. Außerhalb des Lochs bleibt das Bild pixelgleich.
"""

from __future__ import annotations

import threading
from pathlib import Path
from typing import Callable

import numpy as np
from PIL import Image
from scipy import ndimage

from .registry import ServiceModel

SIZE = 512
MODEL_FILE = "lama_fp32.onnx"
MAX_REGIONS = 6


def _feather(mask: np.ndarray, grow: int, sigma: float) -> np.ndarray:
    """Lochmaske leicht erweitern und weich ausblenden (verhindert harte Nähte und Randreste der Maske)."""
    m = mask
    if grow > 0:
        m = ndimage.binary_dilation(m, iterations=grow)
    return np.clip(ndimage.gaussian_filter(m.astype(np.float32), sigma) * 1.6, 0.0, 1.0)


def inpaint_array(
    run: Callable[[np.ndarray, np.ndarray], np.ndarray],
    image: np.ndarray,
    mask: np.ndarray,
    progress: Callable[[float], None] = lambda p: None,
) -> np.ndarray:
    """
    image: (H, W, 3) uint8, mask: (H, W) bool (True = auffüllen). run(bild (1,3,512,512) 0…1, maske (1,1,512,512))
    → (1,3,512,512) 0…255. Liefert (H, W, 3) uint8.
    """
    h, w = mask.shape
    out = image.copy()
    if not mask.any():
        return out
    # Kleine, getrennte Löcher gehören zusammen, wenn sie dicht beieinander liegen
    grow = max(3, round(0.004 * max(h, w)))
    joined = ndimage.binary_dilation(mask, iterations=max(6, grow * 4))
    labels, n = ndimage.label(joined)
    sizes = [int((mask & (labels == i + 1)).sum()) for i in range(n)]
    order = [i for i in np.argsort(sizes)[::-1] if sizes[i] > 0][:MAX_REGIONS]
    for step, i in enumerate(order):
        part = mask & (labels == i + 1)
        ys, xs = np.nonzero(part)
        y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
        side = int(max(y1 - y0, x1 - x0) * 2.0)
        side = max(side, min(96, max(h, w)))
        side = min(side, max(h, w))
        cy, cx = (y0 + y1) // 2, (x0 + x1) // 2
        top = int(np.clip(cy - side // 2, min(0, h - side), max(0, h - side)))
        left = int(np.clip(cx - side // 2, min(0, w - side), max(0, w - side)))
        # Ausschnitt mit Randfortsetzung, falls er über das Bild hinausreicht (kleine Bilder)
        pad_t, pad_l = max(0, -top), max(0, -left)
        pad_b, pad_r = max(0, top + side - h), max(0, left + side - w)
        src = np.pad(out, ((pad_t, pad_b), (pad_l, pad_r), (0, 0)), mode="edge")
        msk = np.pad(part, ((pad_t, pad_b), (pad_l, pad_r)), mode="constant")
        t, l = top + pad_t, left + pad_l
        crop = src[t : t + side, l : l + side]
        cm = msk[t : t + side, l : l + side]
        cm_d = ndimage.binary_dilation(cm, iterations=max(1, round(side / SIZE * 3)))
        img512 = np.asarray(Image.fromarray(crop).resize((SIZE, SIZE), Image.LANCZOS), dtype=np.float32) / 255.0
        m512 = np.asarray(Image.fromarray((cm_d * 255).astype(np.uint8)).resize((SIZE, SIZE), Image.BILINEAR)) > 127
        res = run(img512.transpose(2, 0, 1)[None], m512[None, None].astype(np.float32))
        filled = np.clip(res[0].transpose(1, 2, 0), 0, 255).astype(np.uint8)
        filled = np.asarray(Image.fromarray(filled).resize((side, side), Image.BICUBIC))
        a = _feather(cm, max(1, round(side / SIZE * 2)), max(1.0, side / SIZE * 1.5))[..., None]
        blended = (crop.astype(np.float32) * (1 - a) + filled.astype(np.float32) * a).round().astype(np.uint8)
        # zurück ins Bild (ohne den Randfortsetzungs-Teil)
        back = blended[pad_t : side - pad_b, pad_l : side - pad_r]
        out[top + pad_t : top + pad_t + back.shape[0], left + pad_l : left + pad_l + back.shape[1]] = back
        progress(0.1 + 0.85 * (step + 1) / len(order))
    return out


class OnnxInpainter:
    """LaMa über onnxruntime (CPU: deterministisch und ohne CoreML-Zwischenübersetzung)."""

    def __init__(self, model: ServiceModel, device: str, path: Path):
        import onnxruntime as ort

        self.model = model
        opts = ort.SessionOptions()
        opts.log_severity_level = 3
        self.session = ort.InferenceSession(str(path / MODEL_FILE), opts, providers=["CPUExecutionProvider"])
        self.lock = threading.Lock()

    def _run(self, image: np.ndarray, mask: np.ndarray) -> np.ndarray:
        with self.lock:
            return self.session.run(None, {"image": image, "mask": mask})[0]

    def inpaint(self, image: Image.Image, mask: np.ndarray, progress: Callable[[float], None]) -> Image.Image:
        arr = np.asarray(image.convert("RGB"), dtype=np.uint8)
        out = inpaint_array(self._run, arr, mask, progress)
        return Image.fromarray(out)
