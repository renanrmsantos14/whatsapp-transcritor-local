import asyncio
from pathlib import Path

import httpx

from server import app as app_module
from server.jobs import Job

class FakeJobs:
    max_jobs = 3
    def __init__(self): self.jobs = {}; self.full = False
    @property
    def queue_depth(self): return 3 if self.full else len([j for j in self.jobs.values() if j.state not in {"completed", "failed", "canceled"}])
    def snapshot(self): return {"depth": self.queue_depth, "capacity": 3, "active": False}
    def create(self, path, hotwords):
        if self.full: raise OverflowError
        job = Job("job-1", path, hotwords); self.jobs[job.job_id] = job; return job
    def get(self, job_id): return self.jobs.get(job_id)
    def cancel(self, job_id):
        job = self.jobs.get(job_id)
        if job: job.state = job.stage = "canceled"; job.error = {"code": "canceled", "message": "Transcrição cancelada", "retryable": False}; job.path.unlink(missing_ok=True)
        return job
    def stop(self): pass

def request(method, path, **kwargs):
    async def run():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app_module.app), base_url="http://test") as client:
            return await client.request(method, path, **kwargs)
    return asyncio.run(run())

def setup(monkeypatch):
    token = Path(__file__).with_name(".test-token"); token.write_text("test-token", encoding="utf-8")
    monkeypatch.setattr(app_module, "TOKEN_FILE", token); jobs = FakeJobs(); app_module.app.state.jobs = jobs
    return token, jobs

def test_health_requires_token_and_reports_v2(monkeypatch):
    token, _ = setup(monkeypatch)
    try:
        assert request("GET", "/health").status_code == 401
        body = request("GET", "/health", headers={"X-Local-Token": "test-token"}).json()
        assert body["api_version"] == 2 and body["backend_version"] == "0.2.0"
    finally: token.unlink(missing_ok=True)

def test_job_lifecycle_and_cleanup(monkeypatch):
    token, jobs = setup(monkeypatch)
    try:
        created = request("POST", "/jobs", headers={"X-Local-Token": "test-token"}, files={"audio": ("note.ogg", b"OggS" + b"\0" * 32, "audio/ogg")}, data={"glossary": '["Betinhos"]'})
        assert created.status_code == 202 and created.json()["job_id"] == "job-1"
        assert request("GET", "/jobs/job-1", headers={"X-Local-Token": "test-token"}).json()["state"] == "queued"
        canceled = request("DELETE", "/jobs/job-1", headers={"X-Local-Token": "test-token"})
        assert canceled.json()["state"] == "canceled" and not jobs.jobs["job-1"].path.exists()
    finally: token.unlink(missing_ok=True)

def test_validation_queue_and_missing_job(monkeypatch):
    token, jobs = setup(monkeypatch)
    try:
        bad = request("POST", "/jobs", headers={"X-Local-Token": "test-token"}, files={"audio": ("note.txt", b"bad", "text/plain")})
        assert bad.status_code == 415 and bad.json()["error"]["code"] == "unsupported_media"
        jobs.full = True
        full = request("POST", "/jobs", headers={"X-Local-Token": "test-token"}, files={"audio": ("note.ogg", b"OggS" + b"\0" * 32, "audio/ogg")})
        assert full.status_code == 429 and full.json()["error"]["retryable"] is True
        assert request("GET", "/jobs/lost", headers={"X-Local-Token": "test-token"}).json()["error"]["code"] == "job_lost"
    finally: token.unlink(missing_ok=True)
