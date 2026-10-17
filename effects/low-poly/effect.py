"""Low-Poly (Endrender im Dienst): gleiche Punktauswahl wie points.ts, Delaunay mit SciPy, Farbe je Dreieck."""

import numpy as np
from scipy.spatial import Delaunay


def _mulberry32(seed):
    a = seed & 0xFFFFFFFF

    def imul(x, y):
        return (x * y) & 0xFFFFFFFF

    def nxt():
        nonlocal a
        a = (a + 0x6D2B79F5) & 0xFFFFFFFF
        t = a
        t = imul(t ^ (t >> 15), t | 1)
        t ^= (t + imul(t ^ (t >> 7), t | 61)) & 0xFFFFFFFF
        return ((t ^ (t >> 14)) & 0xFFFFFFFF) / 4294967296

    return nxt


def low_poly_points(wc, hc, count, edge_weight, seed, strength_at):
    pts = [0.0, 0.0, wc, 0.0, wc, hc, 0.0, hc]
    border = max(2, round(np.sqrt(count) / 2))
    for i in range(1, border):
        t = i / border
        pts += [t * wc, 0.0, t * wc, hc, 0.0, t * hc, wc, t * hc]
    rand = _mulberry32(seed)
    accepted = 0
    tries = 0
    while tries < count * 30 and accepted < count:
        tries += 1
        x = rand() * wc
        y = rand() * hc
        u = rand()
        s = strength_at(x, y)
        if u < 1 - edge_weight + edge_weight * min(1.0, s * 1.5):
            pts += [x, y]
            accepted += 1
    return np.array(pts, dtype=np.float64).reshape(-1, 2)


def render(image, ctx):
    h, w = image.shape[:2]
    scale = ctx.scale
    ox, oy = ctx.origin
    wc = ctx.canvas_size[0] / scale
    hc = ctx.canvas_size[1] / scale
    edges = ctx.edges()

    def strength_at(x, y):
        px = min(w - 1, max(0, int(np.floor(x * scale - ox))))
        py = min(h - 1, max(0, int(np.floor(y * scale - oy))))
        return float(edges[py, px, 0])

    pts = low_poly_points(wc, hc, int(round(ctx.params["points"])), ctx.params["edgeWeight"] / 100, ctx.seed,
                          strength_at)
    ctx.progress(0.2)
    tri = Delaunay(pts)
    # Dreieck je Pixelmitte (Leinwand-Original-px), zeilenweise
    owner = np.empty((h, w), dtype=np.int64)
    xs = (np.arange(w) + 0.5 + ox) / scale
    for y0 in range(0, h, 256):
        y1 = min(h, y0 + 256)
        ys = (np.arange(y0, y1) + 0.5 + oy) / scale
        gx, gy = np.meshgrid(xs, ys)
        owner[y0:y1] = tri.find_simplex(np.stack([gx.ravel(), gy.ravel()], axis=1)).reshape(y1 - y0, w)
        ctx.progress(0.2 + 0.6 * y1 / h)
    n = len(tri.simplices)
    flat = image.reshape(-1, 4)
    own = owner.ravel()
    valid = own >= 0
    if ctx.params["color"] == "center":
        cent = pts[tri.simplices].mean(axis=1)
        cx = np.clip(np.floor(cent[:, 0] * scale - ox).astype(int), 0, w - 1)
        cy = np.clip(np.floor(cent[:, 1] * scale - oy).astype(int), 0, h - 1)
        colors = image[cy, cx]
    else:
        counts = np.bincount(own[valid], minlength=n).astype(np.float64)
        colors = np.stack(
            [np.bincount(own[valid], weights=flat[valid, k], minlength=n) for k in range(4)], axis=1
        ) / np.maximum(counts, 1)[:, None]
    out = flat.copy()
    out[valid] = colors[own[valid]]
    ctx.progress(1.0)
    return out.reshape(h, w, 4).astype(np.float32)
