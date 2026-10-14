"""Einfache Job-Verwaltung: lange Aufgaben laufen nacheinander in einem Hintergrund-Thread."""

from __future__ import annotations

import queue
import threading
import time
import uuid
from dataclasses import dataclass, field
from typing import Callable


@dataclass
class Job:
    id: str
    status: str = "queued"  # queued | running | done | error
    progress: float = 0.0
    message: str | None = None
    result: bytes | None = None
    created: float = field(default_factory=time.time)


class JobRunner:
    def __init__(self, keep_seconds: float = 600.0):
        self.jobs: dict[str, Job] = {}
        self.queue: "queue.Queue[tuple[Job, Callable[[Callable[[float], None]], bytes]]]" = queue.Queue()
        self.keep_seconds = keep_seconds
        threading.Thread(target=self._worker, daemon=True, name="ml-jobs").start()

    def submit(self, fn: Callable[[Callable[[float], None]], bytes]) -> Job:
        self._cleanup()
        job = Job(id=uuid.uuid4().hex)
        self.jobs[job.id] = job
        self.queue.put((job, fn))
        return job

    def _worker(self) -> None:
        while True:
            job, fn = self.queue.get()
            job.status = "running"

            def progress(p: float, job: Job = job) -> None:
                job.progress = max(job.progress, min(1.0, p))

            try:
                job.result = fn(progress)
                job.progress = 1.0
                job.status = "done"
            except Exception as e:  # Fehler an die App melden statt den Dienst zu beenden
                job.status = "error"
                job.message = str(e)

    def _cleanup(self) -> None:
        now = time.time()
        for jid, job in list(self.jobs.items()):
            if now - job.created > self.keep_seconds:
                del self.jobs[jid]
