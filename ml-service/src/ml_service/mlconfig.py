"""ML-Modellverwaltung (Spec „ML-Fotobearbeitung“, Abschnitt 3): frei wählbare Modelle für Rollen wie `image-edit`.

Grundsätze: Modelle werden dort verwendet, wo sie liegen (nur lesend, nie kopiert); der Dienst lädt nichts aus dem Internet;
die Konfiguration liegt außerhalb des Repos (``~/.config/artistic-photo-renderer/models.yaml``, per ``BLS_ML_CONFIG``
änderbar). Die Einstufung `outputCommercialUse` (Nutzungsrechte an den erzeugten Bildern) trifft der Nutzer.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
from dataclasses import dataclass, field
from pathlib import Path

import yaml

ROLES = ("image-edit", "image-generate", "inpaint", "upscale", "translate")
BACKENDS = ("diffusers",)
PRECISIONS = ("bf16", "fp16", "fp32")
OFFLOADS = ("auto", "none", "model", "sequential")
DEVICES = ("auto", "mps", "cuda", "cpu")
ID_RE = re.compile(r"^[a-z0-9][a-z0-9._-]{0,63}$")


def config_path() -> Path:
    env = os.environ.get("BLS_ML_CONFIG")
    if env:
        return Path(env)
    return Path.home() / ".config" / "artistic-photo-renderer" / "models.yaml"


@dataclass
class MlModel:
    id: str
    name: str
    roles: list[str]
    root: str
    backend: str = "diffusers"
    precision: str = "bf16"
    device: str = "auto"
    offload: str = "auto"
    steps: int = 4
    guidance: float = 1.0
    license_name: str = ""
    license_url: str = ""
    license_notes: str = ""
    # Nutzungsrechte an den erzeugten Bildern: Einstufung des Nutzers (Spec 2.2), nicht des Tools
    output_commercial_use: bool = False
    default_for_roles: list[str] = field(default_factory=list)


class ConfigError(ValueError):
    pass


def from_dict(data: dict) -> MlModel:
    """Prüft einen Eintrag (Format wie in der Spec 3.3, flach oder verschachtelt) und liefert das Modell."""
    paths = data.get("paths") or {}
    root = data.get("root") or paths.get("root") or ""
    memory = data.get("memory") or {}
    defaults = data.get("defaults") or {}
    lic = data.get("license") or {}
    m = MlModel(
        id=str(data.get("id", "")).strip(),
        name=str(data.get("name") or data.get("id") or "").strip(),
        roles=[str(r) for r in data.get("roles", [])],
        root=str(root).strip(),
        backend=str(data.get("backend", "diffusers")),
        precision=str(data.get("precision", "bf16")),
        device=str(data.get("device", "auto")),
        offload=str(memory.get("offload", data.get("offload", "auto"))),
        steps=int(defaults.get("steps", data.get("steps", 4))),
        guidance=float(defaults.get("guidance", data.get("guidance", 1.0))),
        license_name=str(lic.get("name", data.get("license_name", ""))),
        license_url=str(lic.get("url", data.get("license_url", ""))),
        license_notes=str(lic.get("notes", data.get("license_notes", ""))),
        output_commercial_use=bool(data.get("outputCommercialUse", data.get("output_commercial_use", False))),
        default_for_roles=[str(r) for r in data.get("defaultForRoles", data.get("default_for_roles", []))],
    )
    if not ID_RE.match(m.id):
        raise ConfigError("Die Kennung darf nur Kleinbuchstaben, Ziffern, Punkt, Bindestrich und Unterstrich enthalten.")
    if not m.roles or any(r not in ROLES for r in m.roles):
        raise ConfigError(f"Rollen müssen aus {', '.join(ROLES)} stammen.")
    if m.backend not in BACKENDS:
        raise ConfigError(f"Backend {m.backend} wird nicht unterstützt ({', '.join(BACKENDS)}).")
    if m.precision not in PRECISIONS or m.offload not in OFFLOADS or m.device not in DEVICES:
        raise ConfigError("Präzision, Auslagerung oder Gerät ungültig.")
    if not m.root:
        raise ConfigError("Der Speicherort des Modells fehlt.")
    if not Path(m.root).is_absolute():
        raise ConfigError("Der Speicherort muss ein absoluter Pfad sein.")
    if not (1 <= m.steps <= 200):
        raise ConfigError("Schritte: 1 bis 200.")
    m.default_for_roles = [r for r in m.default_for_roles if r in m.roles]
    return m


def to_dict(m: MlModel) -> dict:
    return {
        "id": m.id,
        "name": m.name,
        "roles": m.roles,
        "backend": m.backend,
        "paths": {"root": m.root},
        "precision": m.precision,
        "device": m.device,
        "memory": {"offload": m.offload},
        "defaults": {"steps": m.steps, "guidance": m.guidance},
        "license": {"name": m.license_name, "url": m.license_url, "notes": m.license_notes},
        "outputCommercialUse": m.output_commercial_use,
        "defaultForRoles": m.default_for_roles,
    }


def load_models(path: Path | None = None) -> list[MlModel]:
    p = path or config_path()
    if not p.is_file():
        return []
    raw = yaml.safe_load(p.read_text(encoding="utf-8")) or {}
    out: list[MlModel] = []
    for entry in raw.get("models", []):
        try:
            out.append(from_dict(entry))
        except (ConfigError, ValueError, TypeError):
            continue  # beschädigte Einträge ignorieren, den Rest weiter nutzen
    return out


def save_models(models: list[MlModel], path: Path | None = None) -> None:
    p = path or config_path()
    p.parent.mkdir(parents=True, exist_ok=True)
    text = "# Von Blur & Layer Studio verwaltet (Einstellungen > ML-Modelle). Modelle werden nur gelesen, nie kopiert.\n"
    text += yaml.safe_dump({"models": [to_dict(m) for m in models]}, allow_unicode=True, sort_keys=False)
    tmp = p.with_suffix(".tmp")
    tmp.write_text(text, encoding="utf-8")
    os.replace(tmp, p)


def upsert(models: list[MlModel], new: MlModel) -> list[MlModel]:
    """Ersetzt den Eintrag gleicher Kennung; ein Modell ist je Rolle höchstens einmal Standard."""
    out = [m for m in models if m.id != new.id] + [new]
    for role in new.default_for_roles:
        for m in out:
            if m is not new and role in m.default_for_roles:
                m.default_for_roles = [r for r in m.default_for_roles if r != role]
    # Gibt es für eine Rolle noch keinen Standard, wird das erste Modell mit dieser Rolle einer
    for role in new.roles:
        if not any(role in m.default_for_roles for m in out if role in m.roles):
            new.default_for_roles = sorted(set(new.default_for_roles) | {role})
    return out


def default_for(models: list[MlModel], role: str) -> MlModel | None:
    cands = [m for m in models if role in m.roles]
    for m in cands:
        if role in m.default_for_roles:
            return m
    return cands[0] if cands else None


def fingerprint(root: Path) -> str:
    """Fingerabdruck aus Dateinamen, Größen und Änderungszeiten (kein vollständiges Hashing großer Dateien)."""
    h = hashlib.sha256()
    for p in sorted(root.rglob("*")):
        if p.is_file() and len(p.relative_to(root).parts) <= 3 and not p.name.startswith("."):
            st = p.stat()
            h.update(f"{p.relative_to(root)}|{st.st_size}|{int(st.st_mtime)}\n".encode())
    return h.hexdigest()[:16]


def size_bytes(root: Path) -> int:
    total = 0
    for p in root.rglob("*.safetensors"):
        try:
            total += p.stat().st_size
        except OSError:
            pass
    return total


def status_of(m: MlModel) -> dict:
    """Verfügbarkeit des Modells: Ordner, Pipeline-Klasse (model_index.json), Größe, Fingerabdruck."""
    root = Path(m.root)
    if not root.is_dir():
        return {"available": False, "note": "Ordner nicht gefunden (Platte angeschlossen?)"}
    index = root / "model_index.json"
    if not index.is_file():
        return {"available": False, "note": "Kein Diffusers-Ordner (model_index.json fehlt)"}
    try:
        cls = json.loads(index.read_text(encoding="utf-8")).get("_class_name", "")
    except (OSError, ValueError):
        return {"available": False, "note": "model_index.json nicht lesbar"}
    try:
        import diffusers

        pipe_cls = getattr(diffusers, cls, None)
    except Exception:  # noqa: BLE001
        pipe_cls = None
    if pipe_cls is None:
        return {"available": False, "note": f"Pipeline {cls or '?'} wird von der installierten diffusers-Version nicht unterstützt"}
    return {
        "available": True,
        "note": None,
        "pipeline": cls,
        "sizeBytes": size_bytes(root),
        "fingerprint": fingerprint(root),
    }
