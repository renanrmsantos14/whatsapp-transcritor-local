from __future__ import annotations

import hmac, json, logging, os, tempfile, time
from contextlib import asynccontextmanager
from logging.handlers import RotatingFileHandler
from pathlib import Path
from typing import Annotated

from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .jobs import Job, JobManager
from .transcriber import MODEL_REPOSITORY, MODEL_REVISION

ROOT = Path(__file__).resolve().parents[1]
MODEL_DIR = Path(os.getenv("WHISPER_MODEL_DIR", ROOT / "data" / "models"))
TOKEN_FILE = Path(os.getenv("LOCAL_TOKEN_FILE", ROOT / "server" / ".local-token"))
LOG_DIR = Path(os.getenv("WHISPER_LOG_DIR", ROOT / "logs"))
EXTENSION_ID = "fnbeofeamojeohjnommhklnkpfflhjnk"
MAX_BYTES, MAX_DURATION_SECONDS = 25 * 1024 * 1024, 10 * 60
ALLOWED_CONTENT_TYPES = {"application/octet-stream", "audio/ogg", "audio/opus", "audio/webm", "audio/wav", "audio/mpeg", "audio/mp4"}

LOGGER = logging.getLogger("whatsapp_transcritor")
LOG_DIR.mkdir(parents=True, exist_ok=True)
if not LOGGER.handlers:
    handler = RotatingFileHandler(LOG_DIR / "backend.log", maxBytes=1024 * 1024, backupCount=3, encoding="utf-8")
    handler.setFormatter(logging.Formatter("[%(asctime)s] %(levelname)s %(message)s"))
    LOGGER.addHandler(handler)
LOGGER.setLevel(logging.INFO); LOGGER.propagate = False

@asynccontextmanager
async def lifespan(application: FastAPI):
    yield
    application.state.jobs.stop()

app = FastAPI(title="WhatsApp Local Transcriber", version="0.2.0", docs_url=None, redoc_url=None, openapi_url=None, lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=[f"chrome-extension://{EXTENSION_ID}"], allow_methods=["GET", "POST", "DELETE", "OPTIONS"], allow_headers=["Content-Type", "X-Local-Token"])
app.state.jobs = JobManager(MODEL_DIR)

def failure(code: str, message: str, retryable: bool, status: int) -> HTTPException:
    return HTTPException(status_code=status, detail={"success": False, "error": {"code": code, "message": message, "retryable": retryable}})

@app.exception_handler(HTTPException)
async def http_error(_, exc: HTTPException) -> JSONResponse:
    detail = exc.detail if isinstance(exc.detail, dict) and exc.detail.get("success") is False else {"success": False, "error": {"code": "http_error", "message": "Falha na requisição", "retryable": exc.status_code >= 500}}
    return JSONResponse(status_code=exc.status_code, content=detail)

@app.exception_handler(RequestValidationError)
async def validation_error(_, __) -> JSONResponse:
    return JSONResponse(status_code=400, content={"success": False, "error": {"code": "invalid_request", "message": "Requisição inválida", "retryable": False}})

def _token() -> str:
    try: return TOKEN_FILE.read_text(encoding="utf-8").strip()
    except OSError: return os.getenv("LOCAL_TOKEN", "").strip()

async def require_token(supplied: Annotated[str | None, Header(alias="X-Local-Token")] = None) -> None:
    expected = _token()
    if not expected or not supplied or not hmac.compare_digest(supplied, expected):
        raise failure("unauthorized", "Token local inválido", False, 401)

def _supported_signature(path: Path) -> bool:
    with path.open("rb") as stream: header = stream.read(16)
    return header.startswith((b"OggS", b"RIFF", b"ID3", b"\x1a\x45\xdf\xa3")) or header[4:8] == b"ftyp" or header[:2] in {b"\xff\xfb", b"\xff\xf3", b"\xff\xf2"}

async def _store_upload(upload: UploadFile) -> Path:
    content_type = (upload.content_type or "application/octet-stream").lower().split(";", 1)[0].strip()
    if content_type not in ALLOWED_CONTENT_TYPES: raise failure("unsupported_media", "Formato de áudio não suportado", False, 415)
    handle = tempfile.NamedTemporaryFile(prefix="whatsapp-transcriber-", suffix=Path(upload.filename or "audio.ogg").suffix or ".ogg", delete=False)
    path, total = Path(handle.name), 0
    try:
        with handle:
            while chunk := await upload.read(1024 * 1024):
                total += len(chunk)
                if total > MAX_BYTES: raise failure("file_too_large", "Áudio excede 25 MB", False, 413)
                handle.write(chunk)
        if not total or not _supported_signature(path): raise failure("unsupported_media", "Conteúdo não parece ser áudio válido", False, 415)
        return path
    except Exception:
        path.unlink(missing_ok=True); raise

def _media_duration(path: Path) -> float | None:
    try:
        import av
        with av.open(str(path)) as container:
            values = [float(stream.duration * stream.time_base) for stream in container.streams if stream.duration and stream.time_base]
        return max(values, default=None)
    except Exception: return None

def _job_payload(job: Job) -> dict:
    payload = {"success": True, "job_id": job.job_id, "state": job.state, "stage": job.stage, "elapsed_seconds": round((job.finished_at or time.monotonic()) - (job.started_at or job.created_at), 3)}
    if job.result is not None: payload["result"] = job.result
    if job.error is not None: payload["error"] = job.error
    return payload

@app.get("/health", dependencies=[Depends(require_token)])
async def health() -> dict:
    return {"success": True, "extension_version": "0.2.0", "backend_version": "0.2.0", "api_version": 2, "compatible": True,
            "model": {"repository": MODEL_REPOSITORY, "revision": MODEL_REVISION, "profile": "small/int8"}, "state": "ready", "device": "cpu",
            "queue": app.state.jobs.snapshot(), "capabilities": ["jobs", "cancel", "vad", "language_detection", "hotwords"]}

@app.post("/jobs", status_code=202, dependencies=[Depends(require_token)])
async def create_job(audio: UploadFile = File(...), glossary: str = Form("[]")) -> JSONResponse:
    jobs: JobManager = app.state.jobs
    if jobs.queue_depth >= jobs.max_jobs: raise failure("queue_full", "Fila de transcrição cheia", True, 429)
    try: hotwords = json.loads(glossary)
    except json.JSONDecodeError: raise failure("invalid_request", "Glossário inválido", False, 400)
    if not isinstance(hotwords, list) or len(hotwords) > 200 or any(not isinstance(term, str) for term in hotwords): raise failure("invalid_request", "Glossário inválido", False, 400)
    path = await _store_upload(audio)
    try:
        duration = _media_duration(path)
        if duration and duration > MAX_DURATION_SECONDS: raise failure("audio_too_long", "Áudio excede 10 minutos", False, 413)
        try: job = jobs.create(path, hotwords)
        except OverflowError: raise failure("queue_full", "Fila de transcrição cheia", True, 429)
        LOGGER.info("Job criado (bytes=%d, fila=%d)", path.stat().st_size, jobs.queue_depth)
        return JSONResponse(status_code=202, content={"success": True, "job_id": job.job_id, "state": job.state})
    except Exception:
        if path.exists() and not any(item.path == path for item in getattr(jobs, "_jobs", {}).values()): path.unlink(missing_ok=True)
        raise

@app.get("/jobs/{job_id}", dependencies=[Depends(require_token)])
async def get_job(job_id: str) -> dict:
    job = app.state.jobs.get(job_id)
    if not job: raise failure("job_lost", "Job não encontrado", True, 404)
    return _job_payload(job)

@app.delete("/jobs/{job_id}", dependencies=[Depends(require_token)])
async def cancel_job(job_id: str) -> dict:
    job = app.state.jobs.cancel(job_id)
    if not job: raise failure("job_lost", "Job não encontrado", True, 404)
    return _job_payload(job)
