"""Analysekarten im Dienst – gleiches Verfahren wie im Browser (src/render/shaders/analysis.wgsl, maskops.wgsl luma).

Bilder: float32, Form (H, W, 4), linear, vormultipliziert (wie das Arbeitsformat der App).
"""

from __future__ import annotations

import numpy as np


def _srgb_encode(lin: np.ndarray) -> np.ndarray:
    lin = np.clip(lin, 0.0, None)
    return np.where(lin <= 0.0031308, 12.92 * lin, 1.055 * np.power(lin, 1 / 2.4) - 0.055)


def luminance(img: np.ndarray) -> np.ndarray:
    """Wahrgenommene Helligkeit 0..1 (sRGB-kodierte Luminanz der entvormultiplizierten Farbe; transparent = 0)."""
    a = img[..., 3]
    safe = np.where(a > 0, a, 1.0)
    rgb = img[..., :3] / safe[..., None]
    y = np.clip(rgb @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32), 0.0, 1.0)
    return np.where(a > 0, _srgb_encode(y), 0.0).astype(np.float32)


def _shift(a: np.ndarray, dy: int, dx: int) -> np.ndarray:
    """a an Position (y + dy, x + dx), am Rand geklemmt."""
    h, w = a.shape
    ys = np.clip(np.arange(h) + dy, 0, h - 1)
    xs = np.clip(np.arange(w) + dx, 0, w - 1)
    return a[ys][:, xs]


def sobel(lum: np.ndarray, px_scale: float = 1.0) -> tuple[np.ndarray, np.ndarray]:
    """Sobel-Gradient je Original-px (wie sobel() in analysis.wgsl)."""
    s = _shift
    gx = (s(lum, -1, 1) + 2 * s(lum, 0, 1) + s(lum, 1, 1) - s(lum, -1, -1) - 2 * s(lum, 0, -1) - s(lum, 1, -1)) / 8
    gy = (s(lum, 1, -1) + 2 * s(lum, 1, 0) + s(lum, 1, 1) - s(lum, -1, -1) - 2 * s(lum, -1, 0) - s(lum, -1, 1)) / 8
    return gx * px_scale, gy * px_scale


def gaussian(a: np.ndarray, sigma: float) -> np.ndarray:
    """Separabler Gauß (Rand geklemmt), Radius 3σ."""
    if sigma < 0.25:
        return a.copy()
    r = int(np.ceil(3 * sigma))
    k = np.exp(-0.5 * (np.arange(-r, r + 1) / sigma) ** 2)
    k /= k.sum()
    out = sum(w * _shift(a, 0, i - r) for i, w in enumerate(k))
    return sum(w * _shift(out, i - r, 0) for i, w in enumerate(k))


def edges(img: np.ndarray, px_scale: float = 1.0) -> np.ndarray:
    """Kantenkarte (H, W, 4): r Stärke, gb Tangente (0.5 + 0.5·t), a Kohärenz – wie die Browser-Karte."""
    lum = luminance(img)
    gx, gy = sobel(lum, px_scale)
    sigma = max(1.5, 6 * px_scale) / 3  # wie GpuCore.edgeMap: Radius max(1.5, 6·pxScale), σ = Radius / 3
    e = gaussian(gx * gx, sigma)
    f = gaussian(gx * gy, sigma)
    g = gaussian(gy * gy, sigma)
    d = np.sqrt(np.maximum((e - g) ** 2 + 4 * f * f, 0))
    l1 = 0.5 * (e + g + d)
    l2 = 0.5 * (e + g - d)
    tx, ty = l1 - e, -f
    tl = np.hypot(tx, ty)
    ok = tl > 1e-12
    tx = np.where(ok, tx / np.where(ok, tl, 1), 0.0)
    ty = np.where(ok, ty / np.where(ok, tl, 1), 1.0)
    coh = np.where(l1 + l2 > 1e-12, (l1 - l2) / np.where(l1 + l2 > 1e-12, l1 + l2, 1), 0.0)
    strength = np.clip(np.hypot(gx, gy) * 8, 0, 1)
    return np.stack([strength, 0.5 + 0.5 * tx, 0.5 + 0.5 * ty, coh], axis=-1).astype(np.float32)
