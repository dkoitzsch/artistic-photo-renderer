"""Liest models/registry.json – die einzige Quelle für Modelle (auch für den Dienst)."""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

REGISTRY_PATH = Path(__file__).resolve().parents[3] / "models" / "registry.json"


@dataclass(frozen=True)
class ServiceModel:
    id: str
    family: str
    name: str
    task: str
    license: str
    commercial_use: bool
    hf_repo: str
    revision: str
    gated: bool
    size: int
    mean: tuple[float, float, float]
    std: tuple[float, float, float]
    # Dateien mit fester URL und SHA-256 (statt eines Hugging-Face-Repos): (Name, URL, SHA-256, Größe)
    files: tuple[tuple[str, str, str, int], ...] = ()


def load_registry(path: Path = REGISTRY_PATH) -> dict[str, ServiceModel]:
    data = json.loads(path.read_text(encoding="utf-8"))
    out: dict[str, ServiceModel] = {}
    for m in data["models"]:
        if m.get("runtime") != "service":
            continue
        inp = m.get("input", {})
        out[m["id"]] = ServiceModel(
            id=m["id"],
            family=m["family"],
            name=m["name"],
            task=m["task"],
            license=m["license"],
            commercial_use=bool(m["commercialUse"]),
            hf_repo=m.get("hfRepo", ""),
            revision=m["revision"],
            gated=bool(m.get("gated", False)),
            size=int(inp.get("size", 1024)),
            mean=tuple(inp.get("mean", (0.485, 0.456, 0.406))),
            std=tuple(inp.get("std", (0.229, 0.224, 0.225))),
            files=tuple((f["name"], f["url"], f["sha256"], int(f["size"])) for f in m.get("files", [])),
        )
    return out


def is_allowed(model: ServiceModel, license_mode: str) -> bool:
    """NC-Modelle nur im Lizenzmodus „all“ (Spec: Lizenzmodus)."""
    return model.commercial_use or license_mode == "all"
