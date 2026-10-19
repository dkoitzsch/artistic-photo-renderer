"""Effekt-Registry des Dienstes (Spiegel der Browser-Registry, Spec „Effekte“ 3.2).

Liest dieselben ``effects/<id>/manifest.json`` wie die Web-App und lädt ``effects/<id>/effect.py`` für Effekte mit der
Ausführung "python". Ein Effekt wird also an genau einer Stelle (seinem Ordner) registriert.

Vertrag für ``effect.py``::

    def render(image: np.ndarray, ctx: RenderContext) -> np.ndarray

``image`` und Rückgabe: float32 (H, W, 4), linear, vormultipliziert (wie das Arbeitsformat der App).
``ctx.params`` enthält die Projektwerte (mit Standardwerten ergänzt), ``ctx.seed`` den Seed, ``ctx.scale`` Render-px pro
Leinwand-px, ``ctx.origin``/``ctx.canvas_size`` die Lage auf der Leinwand. ``ctx.progress(p)`` meldet Fortschritt (0..1)
und bricht bei einem Abbruch mit ``Cancelled`` ab. ``ctx.luminance()`` / ``ctx.edges()`` / ``ctx.flow()`` liefern die Analysekarten,
``ctx.rand_cell(x, y, k)`` denselben Zufall wie ``rand_cell`` im Shader. ``ctx.image_b`` ist das Zweitbild (Parameter vom
Typ "image", z. B. ein Stilbild) im selben Format oder ``None``.
"""

from __future__ import annotations

import importlib.util
import json
import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable

import numpy as np

from . import analysis

REPO = Path(__file__).resolve().parents[3]
EFFECTS_DIR = REPO / "effects"
TEST_EFFECTS_DIR = REPO / "tests" / "effects"


@dataclass
class EffectDef:
    id: str
    name: str
    version: str
    folder: Path
    commercial_use: bool
    license_notes: str
    implementations: dict[str, str]
    params: list[dict[str, Any]]
    randomized: bool
    requires: list[str]
    render: Callable[..., np.ndarray] | None = None
    error: str | None = None

    @property
    def uses_python(self) -> bool:
        return "python" in self.implementations.values()

    def defaults(self) -> dict[str, Any]:
        return {p["key"]: p.get("default") for p in self.params}


def _load_manifest(folder: Path) -> EffectDef | None:
    path = folder / "manifest.json"
    if not path.is_file():
        return None
    m = json.loads(path.read_text(encoding="utf-8"))
    impl = m.get("implementations") or {}
    final = impl.get("final", "webgpu")
    implementations = {"preview": impl.get("preview", final), "final": final}
    params = list(m.get("params", []))
    randomized = bool(m.get("randomized", False))
    # wie AUTO_SEED in src/effects/validate.ts
    if randomized and not any(p.get("type") == "seed" for p in params):
        params.append({"key": "seed", "label": "Seed", "type": "seed", "default": 1, "group": "Erweitert"})
    lic = m.get("license") or {}
    return EffectDef(
        id=m["id"],
        name=m.get("name", m["id"]),
        version=m.get("version", "0.0.0"),
        folder=folder,
        commercial_use=bool(lic.get("commercialUse", True)),
        license_notes=str(lic.get("notes", "")),
        implementations=implementations,
        params=params,
        randomized=randomized,
        requires=list(m.get("requires", [])),
    )


def _load_module(eff: EffectDef) -> None:
    path = eff.folder / "effect.py"
    if not path.is_file():
        eff.error = "effect.py fehlt"
        return
    try:
        spec = importlib.util.spec_from_file_location(f"bls_effect_{eff.id.replace('-', '_')}", path)
        if spec is None or spec.loader is None:
            raise ImportError("Modul nicht ladbar")
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        render = getattr(mod, "render", None)
        if not callable(render):
            raise AttributeError("effect.py muss render(image, ctx) definieren")
        eff.render = render
    except Exception as e:  # Fehler je Effekt melden, Dienst läuft weiter
        eff.error = f"effect.py: {e}"


def effect_dirs() -> list[Path]:
    dirs = [EFFECTS_DIR]
    if os.environ.get("BLS_TEST_EFFECTS") == "1":
        dirs.append(TEST_EFFECTS_DIR)
    return dirs


def load_effects(dirs: list[Path] | None = None) -> dict[str, EffectDef]:
    out: dict[str, EffectDef] = {}
    for d in dirs or effect_dirs():
        if not d.is_dir():
            continue
        for folder in sorted(d.iterdir()):
            if not folder.is_dir() or folder.name.startswith(("_", ".")):
                continue
            try:
                eff = _load_manifest(folder)
            except Exception:
                continue
            if eff is None:
                continue
            if eff.uses_python:
                _load_module(eff)
            out[eff.id] = eff
    return out


def is_effect_allowed(eff: EffectDef, license_mode: str) -> bool:
    return eff.commercial_use or license_mode == "all"


# ---------- Zufall (identisch zu src/effects/random.ts und rand_cell im Shader) ----------

_M = np.uint64(0xFFFFFFFF)


def _u32(x: np.ndarray) -> np.ndarray:
    return (x.astype(np.uint64) & _M).astype(np.uint64)


def pcg3(x: np.ndarray, y: np.ndarray, z: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    x = _u32(_u32(x) * np.uint64(1664525) + np.uint64(1013904223))
    y = _u32(_u32(y) * np.uint64(1664525) + np.uint64(1013904223))
    z = _u32(_u32(z) * np.uint64(1664525) + np.uint64(1013904223))
    x = _u32(x + y * z)
    y = _u32(y + z * x)
    z = _u32(z + x * y)
    x ^= x >> np.uint64(16)
    y ^= y >> np.uint64(16)
    z ^= z >> np.uint64(16)
    x = _u32(x + y * z)
    y = _u32(y + z * x)
    z = _u32(z + x * y)
    return x, y, z


def rand_cell(cx: np.ndarray, cy: np.ndarray, seed: int, k: int = 0) -> np.ndarray:
    """Zufall 0..1 je Leinwandzelle (ganzzahlige Leinwand-px), Seed und Kanal k."""
    cx = np.asarray(cx, dtype=np.int64) & 0xFFFFFFFF
    cy = np.asarray(cy, dtype=np.int64) & 0xFFFFFFFF
    z = np.full(np.broadcast(cx, cy).shape, ((seed & 0xFFFFFFFF) * 747796405 + k) & 0xFFFFFFFF, dtype=np.int64)
    x, _, _ = pcg3(cx, cy, z)
    return ((x >> np.uint64(8)).astype(np.float64) / 16777216.0).astype(np.float32)


# ---------- Ausführung ----------


@dataclass
class RenderContext:
    image: np.ndarray
    params: dict[str, Any]
    seed: int
    scale: float
    origin: tuple[float, float]
    canvas_size: tuple[float, float]
    progress: Callable[[float], None]
    # Zweitbild (Parameter vom Typ "image", z. B. Stilbild): float32 (H, W, 4), linear, vormultipliziert, oder None
    image_b: np.ndarray | None = None
    _cache: dict[str, np.ndarray] = field(default_factory=dict)

    def luminance(self) -> np.ndarray:
        if "lum" not in self._cache:
            self._cache["lum"] = analysis.luminance(self.image)
        return self._cache["lum"]

    def edges(self) -> np.ndarray:
        if "edges" not in self._cache:
            self._cache["edges"] = analysis.edges(self.image, self.scale)
        return self._cache["edges"]

    def flow(self) -> np.ndarray:
        if "flow" not in self._cache:
            self._cache["flow"] = analysis.flow(self.image, self.scale)
        return self._cache["flow"]

    def canvas_cells(self) -> tuple[np.ndarray, np.ndarray]:
        """Ganzzahlige Leinwand-px (volle Auflösung) je Pixel – Grundlage für ortsfesten Zufall."""
        h, w = self.image.shape[:2]
        xs = np.floor((np.arange(w) + 0.5 + self.origin[0]) / self.scale).astype(np.int64)
        ys = np.floor((np.arange(h) + 0.5 + self.origin[1]) / self.scale).astype(np.int64)
        return np.meshgrid(xs, ys)

    def rand_cell(self, k: int = 0) -> np.ndarray:
        cx, cy = self.canvas_cells()
        return rand_cell(cx, cy, self.seed, k)


def run_effect(
    eff: EffectDef,
    image: np.ndarray,
    params: dict[str, Any],
    scale: float,
    origin: tuple[float, float],
    canvas_size: tuple[float, float],
    progress: Callable[[float], None],
    image_b: np.ndarray | None = None,
) -> np.ndarray:
    if eff.render is None:
        raise RuntimeError(eff.error or f"Effekt {eff.id} hat keine Python-Implementierung.")
    full = {**eff.defaults(), **params}
    seed = int(full.get("seed", 1) or 0) if eff.randomized or "seed" in full else 0
    ctx = RenderContext(image=image, params=full, seed=seed, scale=scale, origin=origin, canvas_size=canvas_size,
                        progress=progress, image_b=image_b)
    out = eff.render(image, ctx)
    out = np.asarray(out, dtype=np.float32)
    if out.shape != image.shape:
        raise RuntimeError(f"Effekt {eff.id}: Ergebnis hat Form {out.shape}, erwartet {image.shape}.")
    if not np.all(np.isfinite(out)):
        raise RuntimeError(f"Effekt {eff.id}: Ergebnis enthält NaN/Inf.")
    return out
