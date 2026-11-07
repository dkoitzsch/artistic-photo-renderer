"""Phase M0 (Spec „ML-Fotobearbeitung“): Machbarkeits-Prototyp außerhalb des Hauptcodes.

Lädt ein Diffusers-Modell (z. B. FLUX.2 [klein] 9B) von seinem Ordner (nur lesend, offline) und misst auf diesem Rechner:
Ladezeit, Speicher, Zeit je Variante für Stil-Übertragung (Quellbild + Stilbild), deutschen und englischen Prompt,
Text-zu-Bild und Outpainting (Foto um 25 % erweitern). Ergebnisbilder und `m0_messwerte.json` landen im Ausgabeordner.

Aufruf (aus dem Repo-Stamm):
  uv run --project ml-service python ml-service/prototypes/m0_flux_prototype.py \\
      --model /pfad/zum/flux-2-klein-9b --source tests/fixtures/photo-portrait-street.jpg --style STILBILD.jpg \\
      --out /tmp/m0 [--max-edge 1024] [--steps 4] [--precision bf16] [--offload auto]
"""

from __future__ import annotations

import argparse
import json
import resource
import time
from pathlib import Path

from PIL import Image

from ml_service.mlconfig import MlModel, from_dict, status_of
from ml_service.mlengine import DiffusersEngine, hardware_info, total_ram_bytes


def mem_info() -> dict:
    """Prozess-Spitzenspeicher (RSS) und, falls vorhanden, Metal-Speicher in GB."""
    out = {"rssPeakGB": round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024**3, 2)}
    try:
        import torch

        if torch.backends.mps.is_available():
            out["mpsAllocatedGB"] = round(torch.mps.current_allocated_memory() / 1024**3, 2)
            out["mpsDriverGB"] = round(torch.mps.driver_allocated_memory() / 1024**3, 2)
    except Exception:  # noqa: BLE001
        pass
    return out


def timed(label: str, fn, results: dict):
    t = time.time()
    out = fn()
    results[label] = {"seconds": round(time.time() - t, 2), **mem_info()}
    print(f"{label:34s} {results[label]['seconds']:7.2f} s  {mem_info()}")
    return out


def outpaint_input(img: Image.Image, grow: float = 0.25) -> Image.Image:
    """Leinwand rechts um `grow` verbreitern; neue Fläche mit dem gespiegelten Rand vorgefüllt (klassische Vorfüllung)."""
    w, h = img.size
    nw = round(w * (1 + grow))
    canvas = Image.new("RGB", (nw, h))
    canvas.paste(img, (0, 0))
    strip = img.crop((w - (nw - w), 0, w, h)).transpose(Image.FLIP_LEFT_RIGHT)
    canvas.paste(strip, (w, 0))
    return canvas


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--model", required=True, help="Ordner des Diffusers-Modells (model_index.json)")
    ap.add_argument("--source", required=True, help="Quellfoto")
    ap.add_argument("--style", help="Stilbild für den Stil-Übertragungs-Test")
    ap.add_argument("--out", required=True)
    ap.add_argument("--max-edge", type=int, default=1024)
    ap.add_argument("--steps", type=int, default=4)
    ap.add_argument("--guidance", type=float, default=1.0)
    ap.add_argument("--precision", default="bf16", choices=["bf16", "fp16", "fp32"])
    ap.add_argument("--offload", default="auto", choices=["auto", "none", "model", "sequential"])
    ap.add_argument("--device", default="auto")
    ap.add_argument("--seed", type=int, default=1)
    a = ap.parse_args()

    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    model: MlModel = from_dict(
        {
            "id": "m0", "name": "M0-Prototyp", "roles": ["image-edit", "image-generate"], "root": str(Path(a.model).resolve()),
            "precision": a.precision, "device": a.device, "memory": {"offload": a.offload},
            "defaults": {"steps": a.steps, "guidance": a.guidance}, "outputCommercialUse": True,
        }
    )
    results: dict = {"hardware": hardware_info(), "ramGB": round(total_ram_bytes() / 1024**3), "status": status_of(model),
                     "settings": {"maxEdge": a.max_edge, "steps": a.steps, "precision": a.precision, "offload": a.offload}}
    print(json.dumps(results["status"], ensure_ascii=False))
    if not results["status"]["available"]:
        raise SystemExit(f"Modell nicht verfügbar: {results['status']['note']}")

    eng = DiffusersEngine(model)
    timed("laden", lambda: eng.load(), results)
    results["offloadGewählt"] = getattr(eng, "offload", "?")
    src = Image.open(a.source).convert("RGB")
    noop = lambda p: None  # noqa: E731

    def edit(images, prompt, seed=a.seed):
        return eng.edit(images, prompt, seed, a.steps, a.guidance, a.max_edge, noop)

    if a.style:
        style = Image.open(a.style).convert("RGB")
        p_en = ("Redraw image 1 in the artistic style of image 2. Match its brush work, colour palette, texture and mood. "
                "Keep the exact composition, subjects and proportions of image 1 unchanged.")
        p_de = ("Zeichne Bild 1 im künstlerischen Stil von Bild 2 neu. Übernimm Pinselführung, Farbpalette, Textur und Stimmung. "
                "Behalte Komposition, Motive und Proportionen von Bild 1 unverändert.")
        timed("stil_englisch", lambda: edit([src, style], p_en).save(out / "stil_englisch.png"), results)
        timed("stil_deutsch", lambda: edit([src, style], p_de).save(out / "stil_deutsch.png"), results)
        timed("stil_zweiter_seed", lambda: edit([src, style], p_en, a.seed + 1).save(out / "stil_seed2.png"), results)
    ex = outpaint_input(src)
    timed(
        "outpaint_25prozent",
        lambda: edit([ex], "Extend the scene naturally to the right. Keep everything on the left unchanged.").save(out / "outpaint.png"),
        results,
    )
    timed("text_zu_bild", lambda: edit([Image.new("RGB", (64, 64), (128, 128, 128))], "a misty forest at dawn, soft light, photograph").save(out / "text_zu_bild.png"), results)
    (out / "m0_messwerte.json").write_text(json.dumps(results, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"fertig: {out}")


if __name__ == "__main__":
    main()
