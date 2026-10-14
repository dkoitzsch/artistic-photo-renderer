"""Bild- und Masken-Ein-/Ausgabe (Masken als 16-Bit-Graustufen-PNG)."""

from __future__ import annotations

import io

import numpy as np
from PIL import Image, ImageOps


def decode_image(data: bytes) -> Image.Image:
    img = Image.open(io.BytesIO(data))
    img = ImageOps.exif_transpose(img)
    return img.convert("RGB")


def encode_mask_png16(mask: np.ndarray) -> bytes:
    """mask: float32 0…1, Form (H, W) → 16-Bit-PNG."""
    u16 = np.clip(np.rint(mask * 65535.0), 0, 65535).astype(np.uint16)
    img = Image.fromarray(u16)  # Modus I;16
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()
