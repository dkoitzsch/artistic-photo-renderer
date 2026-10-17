"""Einfache Job-Verwaltung: lange Aufgaben laufen nacheinander in einem Hintergrund-Thread.

Abbruch (DELETE /jobs/{id}): wartende Jobs werden übersprungen, laufende brechen beim nächsten Fortschritts-Aufruf ab
(der Fortschritts-Callback wirft dann ``Cancelled``).
"""

from __future__ import annotations

import queue
import threading
import time
import uuid
from dataclasses import dataclass, field
from typing import Callable

ProgressFn = Callable[[float], None]


class Cancelled(Exception):
    """Wird im Fortschritts-Callback eines abgebrochenen Jobs ausgelöst."""


@dataclass
class Job:
    id: str
    status: str = "queued"  # queued | running | done | error | cancelled
    progress: float = 0.0
    message: str | None = None
    result: bytes | None = None
    media_type: str = "image/png"
    # Zusatzangaben zum Ergebnis (z. B. Breite/Höhe roher Bilddaten)
    meta: dict = field(default_factory=dict)
    cached: bool = False
    cancel_requested: bool = False
    created: float = field(default_factory=time.time)


class JobRunner:
    def __init__(self, keep_seconds: float = 600.0):
        self.jobs: dict[str, Job] = {}
        self.queue: "queue.Queue[tuple[Job, Callable[[ProgressFn], bytes]]]" = queue.Queue()
        self.keep_seconds = keep_seconds
        threading.Thread(target=self._worker, daemon=True, name="ml-jobs").start()

    def submit(
        self, fn: Callable[[ProgressFn], bytes], media_type: str = "image/png", meta: dict | None = None
    ) -> Job:
        self._cleanup()
        job = Job(id=uuid.uuid4().hex, media_type=media_type, meta=dict(meta or {}))
        self.jobs[job.id] = job
        self.queue.put((job, fn))
        return job

    def done(self, result: bytes, media_type: str, meta: dict | None = None, cached: bool = True) -> Job:
        """Fertiger Job ohne Rechnung (z. B. Treffer im Ergebnis-Cache)."""
        self._cleanup()
        job = Job(
            id=uuid.uuid4().hex,
            status="done",
            progress=1.0,
            result=result,
            media_type=media_type,
            meta=dict(meta or {}),
            cached=cached,
        )
        self.jobs[job.id] = job
        return job

    def cancel(self, job_id: str) -> Job | None:
        job = self.jobs.get(job_id)
        if job is None:
            return None
        if job.status == "queued":
            job.status = "cancelled"
            job.message = "abgebrochen"
        elif job.status == "running":
            job.cancel_requested = True
        return job

    def _worker(self) -> None:
        while True:
            job, fn = self.queue.get()
            if job.status == "cancelled":
                continue
            job.status = "running"

            def progress(p: float, job: Job = job) -> None:
                if job.cancel_requested:
                    raise Cancelled()
                job.progress = max(job.progress, min(1.0, p))

            try:
                job.result = fn(progress)
                if job.cancel_requested:
                    raise Cancelled()
                job.progress = 1.0
                job.status = "done"
            except Cancelled:
                job.status = "cancelled"
                job.message = "abgebrochen"
                job.result = None
            except Exception as e:  # Fehler an die App melden statt den Dienst zu beenden
                job.status = "error"
                job.message = str(e)

    def _cleanup(self) -> None:
        now = time.time()
        for jid, job in list(self.jobs.items()):
            if now - job.created > self.keep_seconds and job.status not in ("queued", "running"):
                del self.jobs[jid]
