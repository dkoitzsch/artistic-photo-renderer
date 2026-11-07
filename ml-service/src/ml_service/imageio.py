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


def decode_mask(data: bytes, size: tuple[int, int]) -> np.ndarray:
    """Maske (8- oder 16-Bit-Graustufen-PNG, Alpha ignoriert) → float32 0…1 in der Bildgröße size = (Breite, Höhe)."""
    img = Image.open(io.BytesIO(data))
    if img.mode.startswith("I;16") or img.mode == "I":
        arr = np.asarray(img, dtype=np.float32) / 65535.0
    else:
        arr = np.asarray(img.convert("L"), dtype=np.float32) / 255.0
    if (arr.shape[1], arr.shape[0]) != size:
        arr = np.asarray(Image.fromarray(arr).resize(size, Image.BILINEAR), dtype=np.float32)
    return arr


def encode_image_png(image: Image.Image) -> bytes:
    buf = io.BytesIO()
    image.convert("RGB").save(buf, format="PNG")
    return buf.getvalue()
