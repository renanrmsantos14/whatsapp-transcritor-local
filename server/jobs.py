from __future__ import annotations

import multiprocessing as mp
import queue
import threading
import time
import uuid
from collections import deque
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from .transcriber import LocalTranscriber

TERMINAL_STATES = {"completed", "failed", "canceled"}

@dataclass
class Job:
    job_id: str
    path: Path
    hotwords: list[str]
    state: str = "queued"
    stage: str = "queued"
    created_at: float = field(default_factory=time.monotonic)
    started_at: float | None = None
    finished_at: float | None = None
    result: dict[str, Any] | None = None
    error: dict[str, Any] | None = None

def _worker_main(commands: mp.Queue, results: mp.Queue, model_dir: str, idle_seconds: int) -> None:
    transcriber: LocalTranscriber | None = None
    while True:
        try:
            command = commands.get(timeout=idle_seconds)
        except queue.Empty:
            return
        if command is None:
            return
        job_id, path, hotwords = command
        try:
            results.put({"job_id": job_id, "event": "stage", "stage": "preparing"})
            transcriber = transcriber or LocalTranscriber(Path(model_dir))
            transcriber.warmup()
            results.put({"job_id": job_id, "event": "stage", "stage": "transcribing"})
            started = time.perf_counter()
            value = transcriber.transcribe(Path(path), hotwords)
            results.put({"job_id": job_id, "event": "completed", "result": {
                "text": value.text, "language": value.language,
                "language_probability": value.language_probability,
                "duration_seconds": value.duration_seconds,
                "processing_seconds": round(time.perf_counter() - started, 3),
            }})
        except Exception:
            results.put({"job_id": job_id, "event": "failed", "error": {
                "code": "transcription_failed", "message": "Não foi possível transcrever", "retryable": True,
            }})

class JobManager:
    def __init__(self, model_dir: Path, max_jobs: int = 3, timeout_seconds: int = 720, retention_seconds: int = 600, idle_seconds: int = 900) -> None:
        self.model_dir = model_dir
        self.max_jobs = max_jobs
        self.timeout_seconds = timeout_seconds
        self.retention_seconds = retention_seconds
        self.idle_seconds = idle_seconds
        self._jobs: dict[str, Job] = {}
        self._pending: deque[str] = deque()
        self._active: str | None = None
        self._process: mp.Process | None = None
        self._commands: mp.Queue | None = None
        self._results: mp.Queue | None = None
        self._lock = threading.RLock()
        self._stopped = threading.Event()
        self._thread = threading.Thread(target=self._run, name="whisper-job-manager", daemon=True)
        self._thread.start()

    @property
    def queue_depth(self) -> int:
        with self._lock:
            return len(self._pending) + (1 if self._active else 0)

    def create(self, path: Path, hotwords: list[str]) -> Job:
        with self._lock:
            self._cleanup_locked()
            if self.queue_depth >= self.max_jobs:
                raise OverflowError("queue_full")
            job = Job(uuid.uuid4().hex, path, hotwords)
            self._jobs[job.job_id] = job
            self._pending.append(job.job_id)
            return job

    def get(self, job_id: str) -> Job | None:
        with self._lock:
            self._cleanup_locked()
            return self._jobs.get(job_id)

    def cancel(self, job_id: str) -> Job | None:
        with self._lock:
            job = self._jobs.get(job_id)
            if not job or job.state in TERMINAL_STATES:
                return job
            if self._active == job_id:
                self._terminate_worker_locked()
                self._active = None
            else:
                try: self._pending.remove(job_id)
                except ValueError: pass
            self._finish_locked(job, "canceled", error={"code": "canceled", "message": "Transcrição cancelada", "retryable": False})
            return job

    def stop(self) -> None:
        self._stopped.set()
        with self._lock:
            self._terminate_worker_locked()
            for job in self._jobs.values():
                if job.state not in TERMINAL_STATES:
                    self._finish_locked(job, "failed", error={"code": "job_lost", "message": "Job interrompido", "retryable": True})
        self._thread.join(timeout=2)

    def snapshot(self) -> dict[str, Any]:
        return {"depth": self.queue_depth, "capacity": self.max_jobs, "active": bool(self._active)}

    def _spawn_worker_locked(self) -> None:
        if self._process and self._process.is_alive(): return
        context = mp.get_context("spawn")
        self._commands, self._results = context.Queue(), context.Queue()
        self._process = context.Process(target=_worker_main, args=(self._commands, self._results, str(self.model_dir), self.idle_seconds), name="whisper-worker", daemon=True)
        self._process.start()

    def _terminate_worker_locked(self) -> None:
        if self._process and self._process.is_alive():
            self._process.terminate(); self._process.join(timeout=3)
            if self._process.is_alive(): self._process.kill(); self._process.join(timeout=1)
        self._process = self._commands = self._results = None

    def _finish_locked(self, job: Job, state: str, result=None, error=None) -> None:
        job.state = job.stage = state
        job.result, job.error, job.finished_at = result, error, time.monotonic()
        job.path.unlink(missing_ok=True)

    def _cleanup_locked(self) -> None:
        now = time.monotonic()
        for job_id in [key for key, job in self._jobs.items() if job.finished_at and now - job.finished_at > self.retention_seconds]:
            del self._jobs[job_id]

    def _run(self) -> None:
        while not self._stopped.wait(0.1):
            with self._lock:
                self._cleanup_locked()
                job = self._jobs.get(self._active) if self._active else None
                if job and self._process and not self._process.is_alive() and self._results and self._results.empty():
                    self._terminate_worker_locked(); self._active = None
                    self._finish_locked(job, "failed", error={"code": "job_lost", "message": "Worker interrompido", "retryable": True})
                    job = None
                if job and job.started_at and time.monotonic() - job.started_at > self.timeout_seconds:
                    self._terminate_worker_locked(); self._active = None
                    self._finish_locked(job, "failed", error={"code": "job_timeout", "message": "Tempo limite excedido", "retryable": True})
                if self._active and self._results:
                    try: event = self._results.get_nowait()
                    except queue.Empty: event = None
                    if event:
                        job = self._jobs.get(event["job_id"])
                        if job and job.state not in TERMINAL_STATES:
                            if event["event"] == "stage": job.state = job.stage = event["stage"]
                            else:
                                self._active = None
                                self._finish_locked(job, event["event"], event.get("result"), event.get("error"))
                if not self._active and self._pending:
                    job = self._jobs[self._pending.popleft()]
                    self._spawn_worker_locked()
                    job.state = job.stage = "preparing"; job.started_at = time.monotonic(); self._active = job.job_id
                    self._commands.put((job.job_id, str(job.path), job.hotwords))
