"""Objekt-Aufteilung (Modus 3): automatische Instanzmasken mit SAM 2.1 (transformers, Apache-2.0).

Ablauf wie bei der „automatischen Maskenerzeugung“ von SAM: ein Raster von Punktaufforderungen über das Bild, je Punkt drei
Maskenkandidaten mit geschätztem IoU; Kandidaten mit schlechter Güte oder instabilen Rändern fallen weg, ähnliche
Masken werden unterdrückt (NMS). Ergebnis ist eine Etikettenkarte (0 = kein Objekt, 1…n = Objekt, große Objekte zuerst,
kleinere überschreiben sie) – ohne Überlappung, ideal für Ebenen.
"""

from __future__ import annotations

import threading
from pathlib import Path
from typing import Callable

import numpy as np
from PIL import Image

from .registry import ServiceModel

MIN_SCORE = 0.8
MIN_STABILITY = 0.85
MIN_AREA = 0.01
MAX_AREA = 0.75
NMS_IOU = 0.6
MIN_VISIBLE = 0.25


def select_objects(
    logits: np.ndarray,
    scores: np.ndarray,
    max_objects: int = 8,
    min_area: float = MIN_AREA,
    max_area: float = MAX_AREA,
) -> tuple[np.ndarray, list[dict]]:
    """
    logits: (N, K, h, w) Masken-Logits je Punkt und Kandidat, scores: (N, K) geschätzte IoU.
    Liefert (labels (h, w) uint16, Objekte [{label, score, area}] in Etikettenreihenfolge, große zuerst).
    """
    n, k, h, w = logits.shape
    flat = logits.reshape(n * k, h * w)
    sc = scores.reshape(n * k)
    binary = flat > 0
    area = binary.sum(axis=1) / float(h * w)
    # Stabilität: wie stark ändert sich die Maske, wenn die Schwelle um ±1 verschoben wird
    hi = (flat > 1.0).sum(axis=1)
    lo = (flat > -1.0).sum(axis=1)
    stability = np.where(lo > 0, hi / np.maximum(lo, 1), 0.0)
    ok = (sc >= MIN_SCORE) & (stability >= MIN_STABILITY) & (area >= min_area) & (area <= max_area)
    idx = np.nonzero(ok)[0]
    # Güte vor Fläche: bessere und größere Masken zuerst (zählen für die Unterdrückung ähnlicher Masken)
    idx = idx[np.argsort(-(sc[idx] * np.sqrt(area[idx])))]
    kept: list[int] = []
    for i in idx:
        mi = binary[i]
        dup = False
        for j in kept:
            inter = np.count_nonzero(mi & binary[j])
            if inter / max(np.count_nonzero(mi | binary[j]), 1) >= NMS_IOU:
                dup = True
                break
        if not dup:
            kept.append(int(i))
        if len(kept) >= max_objects * 2:
            break
    kept = kept[:max_objects]
    # große zuerst malen, kleinere überschreiben
    kept.sort(key=lambda i: -area[i])
    labels = np.zeros((h, w), dtype=np.uint16)
    for rank, i in enumerate(kept, start=1):
        labels[binary[i].reshape(h, w)] = rank
    objects: list[dict] = []
    final_labels = np.zeros_like(labels)
    new = 0
    for rank, i in enumerate(kept, start=1):
        visible = np.count_nonzero(labels == rank)
        own = np.count_nonzero(binary[i])
        if own == 0 or visible / own < MIN_VISIBLE:
            continue  # fast ganz von kleineren Objekten verdeckt
        new += 1
        final_labels[labels == rank] = new
        objects.append({"label": new, "score": round(float(sc[i]), 4), "area": round(visible / float(h * w), 5)})
    return final_labels, objects


class HfSam2Objects:
    """SAM 2.1 (transformers, PyTorch): Raster von Punktaufforderungen → Instanzmasken."""

    def __init__(self, model: ServiceModel, device: str, path: Path):
        import torch
        from transformers import Sam2Model, Sam2Processor

        self.model = model
        # SAM 2 auf MPS ist noch nicht für alle Operatoren verfügbar: Rechnung auf der CPU, solange nicht erlaubt
        import os

        self.device = "mps" if device == "mps" and os.environ.get("BLS_SAM_DEVICE") == "mps" else "cpu"
        self.processor = Sam2Processor.from_pretrained(str(path))
        self.net = Sam2Model.from_pretrained(str(path)).eval().to(self.device)
        self.torch = torch
        self.lock = threading.Lock()

    def objects(
        self,
        image: Image.Image,
        max_objects: int,
        grid: int,
        progress: Callable[[float], None],
    ) -> tuple[np.ndarray, list[dict]]:
        torch = self.torch
        w, h = image.size
        with self.lock, torch.inference_mode():
            inputs = self.processor(images=image, return_tensors="pt")
            emb = self.net.get_image_embeddings(inputs["pixel_values"].to(self.device))
            progress(0.2)
            pts = [[(i + 0.5) / grid * w, (j + 0.5) / grid * h] for j in range(grid) for i in range(grid)]
            logit_parts: list[np.ndarray] = []
            score_parts: list[np.ndarray] = []
            batch = 64
            for start in range(0, len(pts), batch):
                chunk = pts[start : start + batch]
                inp = self.processor(
                    images=image,
                    input_points=[[[p] for p in chunk]],
                    input_labels=[[[1] for _ in chunk]],
                    return_tensors="pt",
                )
                out = self.net(
                    input_points=inp["input_points"].to(self.device),
                    input_labels=inp["input_labels"].to(self.device),
                    image_embeddings=emb,
                    multimask_output=True,
                )
                logit_parts.append(out.pred_masks[0].float().cpu().numpy())
                score_parts.append(out.iou_scores[0].float().cpu().numpy())
                progress(0.2 + 0.7 * min(1.0, (start + batch) / len(pts)))
        logits = np.concatenate(logit_parts, axis=0)
        scores = np.concatenate(score_parts, axis=0)
        labels, objs = select_objects(logits, scores, max_objects)
        # Etikettenkarte auf Bildgröße (nächster Nachbar; Masken sind 256 × 256 über das gestreckte Bild)
        lab = Image.fromarray(labels).resize((w, h), Image.NEAREST)
        # lange Kante höchstens 1024 px (die App schärft die Kanten mit dem Guided Filter nach)
        s = min(1.0, 1024 / max(w, h))
        if s < 1.0:
            lab = lab.resize((max(1, round(w * s)), max(1, round(h * s))), Image.NEAREST)
        return np.asarray(lab, dtype=np.uint16), objs
