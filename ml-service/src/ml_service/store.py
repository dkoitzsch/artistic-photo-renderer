"""Speicher für hochgeladene Bilder und Effekt-Ergebnisse (Festplatte, Größenbudget, LRU nach Zugriffszeit).

Format: rohes RGBA float16 (little endian), linear, vormultipliziert – genau das Arbeitsformat der App.
Datei = 16-Byte-Kopf (b"BLSF16\\0\\0", Breite, Höhe als uint32) + Pixeldaten.
"""

from __future__ import annotations

import hashlib
import os
import struct
import threading
import time
from pathlib import Path

import numpy as np

MAGIC = b"BLSF16\0\0"


def decode_f16(data: bytes, width: int, height: int) -> np.ndarray:
    expected = width * height * 4 * 2
    if len(data) != expected:
        raise ValueError(f"Bilddaten haben {len(data)} Byte, erwartet {expected} ({width} × {height} RGBA float16).")
    return np.frombuffer(data, dtype="<f2").reshape(height, width, 4).astype(np.float32)


def encode_f16(img: np.ndarray) -> bytes:
    return np.ascontiguousarray(img, dtype="<f2").tobytes()


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


class BlobStore:
    def __init__(self, root: Path, max_bytes: int):
        self.root = root
        self.max_bytes = max_bytes
        self.lock = threading.Lock()
        root.mkdir(parents=True, exist_ok=True)

    def _path(self, key: str) -> Path:
        if not key or not all(c in "0123456789abcdef" for c in key):
            raise ValueError("ungültiger Schlüssel")
        return self.root / f"{key}.f16"

    def has(self, key: str) -> bool:
        return self._path(key).is_file()

    def put(self, key: str, pixels: bytes, width: int, height: int) -> None:
        path = self._path(key)
        tmp = path.with_suffix(".part")
        with self.lock:
            tmp.write_bytes(MAGIC + struct.pack("<II", width, height) + pixels)
            os.replace(tmp, path)
            self._evict(keep=path)

    def get(self, key: str) -> tuple[bytes, int, int] | None:
        path = self._path(key)
        try:
            raw = path.read_bytes()
        except FileNotFoundError:
            return None
        if raw[:8] != MAGIC:
            return None
        width, height = struct.unpack("<II", raw[8:16])
        now = time.time()
        os.utime(path, (now, now))
        return raw[16:], width, height

    def _evict(self, keep: Path) -> None:
        files = [p for p in self.root.glob("*.f16") if p.is_file()]
        total = sum(p.stat().st_size for p in files)
        for p in sorted(files, key=lambda p: p.stat().st_mtime):
            if total <= self.max_bytes:
                break
            if p == keep:
                continue
            total -= p.stat().st_size
            p.unlink(missing_ok=True)
