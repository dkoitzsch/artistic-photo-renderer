"""Stilübertragung mit AdaIN (Huang & Belongie 2017) im Dienst.

Netz wie in naoto0804/pytorch-AdaIN (MIT): normalisiertes VGG-19 bis relu4_1 als Kodierer, AdaIN (Mittelwert und
Streuung der Merkmale je Kanal an das Stilbild angleichen), Dekodierer zurück zum Bild. Gewichte aus dem Modell „adain“
des Registers (nur nicht-kommerziell, Download im Dialog „Modelle“). Gerechnet wird auf der Rechengröße (lange Kante
512/768/1024 px), danach hochskaliert; feine Details des Originals lassen sich wieder einmischen.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np

_NET: dict = {}


def weights_dir() -> Path:
    from ml_service import models

    return models.CACHE_DIR / "models" / "adain"


def _build():
    import torch.nn as nn

    def conv(cin: int, cout: int) -> list:
        return [nn.ReflectionPad2d((1, 1, 1, 1)), nn.Conv2d(cin, cout, (3, 3)), nn.ReLU()]

    pool = lambda: nn.MaxPool2d((2, 2), (2, 2), (0, 0), ceil_mode=True)  # noqa: E731
    # VGG-19 (normalisiert) bis relu4_1 = die ersten 31 Module des Originals
    vgg = nn.Sequential(
        nn.Conv2d(3, 3, (1, 1)),
        *conv(3, 64), *conv(64, 64), pool(),
        *conv(64, 128), *conv(128, 128), pool(),
        *conv(128, 256), *conv(256, 256), *conv(256, 256), *conv(256, 256), pool(),
        *conv(256, 512),
    )
    up = lambda: nn.Upsample(scale_factor=2, mode="nearest")  # noqa: E731
    decoder = nn.Sequential(
        *conv(512, 256), up(),
        *conv(256, 256), *conv(256, 256), *conv(256, 256), *conv(256, 128), up(),
        *conv(128, 128), *conv(128, 64), up(),
        *conv(64, 64),
        nn.ReflectionPad2d((1, 1, 1, 1)), nn.Conv2d(64, 3, (3, 3)),
    )
    return vgg, decoder


def load_net(folder: Path | None = None):
    """Lädt Kodierer und Dekodierer (einmal je Ordner)."""
    import torch

    folder = folder or weights_dir()
    key = str(folder)
    if key in _NET:
        return _NET[key]
    dec_path = folder / "decoder.pth"
    vgg_path = folder / "vgg_normalised.pth"
    if not dec_path.is_file() or not vgg_path.is_file():
        raise RuntimeError("AdaIN-Gewichte fehlen – bitte im Dialog „Modelle“ das Modell „AdaIN“ herunterladen.")
    vgg, decoder = _build()
    state = torch.load(vgg_path, map_location="cpu", weights_only=True)
    # nur die Module bis relu4_1 (Index < 31) übernehmen
    vgg.load_state_dict({k: v for k, v in state.items() if int(k.split(".")[0]) < 31})
    decoder.load_state_dict(torch.load(dec_path, map_location="cpu", weights_only=True))
    from ml_service.models import pick_device

    device = pick_device()
    vgg.eval().to(device)
    decoder.eval().to(device)
    _NET[key] = (vgg, decoder, device)
    return _NET[key]


def _srgb(lin: np.ndarray) -> np.ndarray:
    lin = np.clip(lin, 0.0, None)
    return np.where(lin <= 0.0031308, 12.92 * lin, 1.055 * np.power(lin, 1 / 2.4) - 0.055)


def _lin(s: np.ndarray) -> np.ndarray:
    s = np.clip(s, 0.0, 1.0)
    return np.where(s <= 0.04045, s / 12.92, np.power((s + 0.055) / 1.055, 2.4))


def _unpremul(img: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    a = img[..., 3:4]
    rgb = np.where(a > 0, img[..., :3] / np.maximum(a, 1e-6), 0.0)
    return rgb, a


def _resize(arr: np.ndarray, w: int, h: int) -> np.ndarray:
    import torch
    import torch.nn.functional as F

    t = torch.from_numpy(np.ascontiguousarray(arr.transpose(2, 0, 1)))[None].float()
    return F.interpolate(t, size=(h, w), mode="bilinear", align_corners=False)[0].numpy().transpose(1, 2, 0)


def _adain(content, style, eps: float = 1e-5):
    n, c = content.shape[:2]
    cm = content.view(n, c, -1).mean(2).view(n, c, 1, 1)
    cs = content.view(n, c, -1).var(2).add(eps).sqrt().view(n, c, 1, 1)
    sm = style.view(n, c, -1).mean(2).view(n, c, 1, 1)
    ss = style.view(n, c, -1).var(2).add(eps).sqrt().view(n, c, 1, 1)
    return (content - cm) / cs * ss + sm


def _ycc(rgb: np.ndarray) -> np.ndarray:
    y = rgb @ np.array([0.299, 0.587, 0.114], dtype=np.float32)
    cb = (rgb[..., 2] - y) * 0.564
    cr = (rgb[..., 0] - y) * 0.713
    return np.stack([y, cb, cr], -1)


def _rgb(ycc: np.ndarray) -> np.ndarray:
    y, cb, cr = ycc[..., 0], ycc[..., 1], ycc[..., 2]
    r = y + 1.403 * cr
    b = y + 1.773 * cb
    g = (y - 0.299 * r - 0.114 * b) / 0.587
    return np.stack([r, g, b], -1)


def stylize(content_srgb: np.ndarray, style_srgb: np.ndarray, alpha: float, folder: Path | None = None) -> np.ndarray:
    """content/style: float32 (H, W, 3) sRGB 0..1 → stilisiertes Bild in Größe des Inhalts."""
    import torch

    vgg, decoder, device = load_net(folder)
    with torch.no_grad():
        c = torch.from_numpy(np.ascontiguousarray(content_srgb.transpose(2, 0, 1)))[None].float().to(device)
        s = torch.from_numpy(np.ascontiguousarray(style_srgb.transpose(2, 0, 1)))[None].float().to(device)
        cf = vgg(c)
        sf = vgg(s)
        t = _adain(cf, sf)
        t = alpha * t + (1 - alpha) * cf
        out = decoder(t).clamp(0, 1)[0].cpu().numpy().transpose(1, 2, 0)
    h, w = content_srgb.shape[:2]
    if out.shape[0] != h or out.shape[1] != w:
        out = _resize(out, w, h)
    return out.astype(np.float32)


def render(image: np.ndarray, ctx) -> np.ndarray:
    if ctx.image_b is None:
        return image.copy()
    p = ctx.params
    alpha = float(p.get("alpha", 85)) / 100
    size = int(str(p.get("size", "768")))
    detail = float(p.get("photoDetail", 20)) / 100
    keep = bool(p.get("keepColors", False))
    h, w = image.shape[:2]
    rgb, a = _unpremul(image)
    srgb = _srgb(rgb).astype(np.float32)
    style_rgb, _ = _unpremul(ctx.image_b)
    style = _srgb(style_rgb).astype(np.float32)
    # Rechengröße (durch 8 teilbar wegen der drei Pooling-Stufen)
    f = min(1.0, size / max(w, h))
    cw, ch = max(8, int(round(w * f / 8)) * 8), max(8, int(round(h * f / 8)) * 8)
    sf = min(1.0, size / max(style.shape[:2]))
    sw, sh = max(8, int(round(style.shape[1] * sf / 8)) * 8), max(8, int(round(style.shape[0] * sf / 8)) * 8)
    ctx.progress(0.1)
    small = _resize(srgb, cw, ch)
    out_small = stylize(small, _resize(style, sw, sh), alpha)
    ctx.progress(0.8)
    out = _resize(out_small, w, h)
    if detail > 0:
        # Hochpass des Originals (Differenz zur verkleinerten Fassung) wieder einmischen
        out = out + (srgb - _resize(small, w, h)) * detail
    if keep:
        ycc = _ycc(out)
        ycc[..., 1:] = _ycc(srgb)[..., 1:]
        out = _rgb(ycc)
    lin = _lin(np.clip(out, 0, 1)).astype(np.float32)
    res = np.concatenate([lin * a, a], -1).astype(np.float32)
    ctx.progress(1.0)
    return res
