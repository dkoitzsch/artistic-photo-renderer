"""Test-Effekt für den Dienst: Farben invertieren (sRGB), optional Seed-Rauschen und künstliche Verzögerung."""

import time

import numpy as np


def _enc(lin):
    lin = np.clip(lin, 0.0, 1.0)
    return np.where(lin <= 0.0031308, 12.92 * lin, 1.055 * np.power(lin, 1 / 2.4) - 0.055)


def _dec(c):
    c = np.clip(c, 0.0, 1.0)
    return np.where(c <= 0.04045, c / 12.92, np.power((c + 0.055) / 1.055, 2.4))


def render(image, ctx):
    steps = 20
    for i in range(steps):
        ctx.progress(i / steps)
        if ctx.params["delay"] > 0:
            time.sleep(ctx.params["delay"] / steps)
    a = image[..., 3:4]
    safe = np.where(a > 0, a, 1.0)
    srgb = _enc(image[..., :3] / safe)
    inv = 1.0 - srgb
    if ctx.params["noise"] > 0:
        inv = inv + ctx.params["noise"] * (ctx.rand_cell(0)[..., None] - 0.5)
    k = ctx.params["amount"] / 100.0
    rgb = _dec(srgb + (inv - srgb) * k) * a
    return np.concatenate([rgb, a], axis=-1).astype(np.float32)
