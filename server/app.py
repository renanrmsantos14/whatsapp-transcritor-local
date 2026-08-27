from __future__ import annotations

import asyncio
import hmac
import logging
import os
import tempfile
import time
from pathlib import Path
from typing import Annotated

from fastapi import Depends, FastAPI, File, Header, HTTPException, UploadFile
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool

from .transcriber import LocalTranscriber, TranscriptionResult

ROOT = Path(__file__).resolve().parents[1]
MODEL_DIR = Path(os.getenv("WHISPER_MODEL_DIR", ROOT / "data" / "models"))
TOKEN_FILE = Path(os.getenv("LOCAL_TOKEN_FILE", ROOT / "server" / ".local-token"))
MAX_BYTES = 25 * 1024 * 1024
MAX_DURATION_SECONDS = 30 * 60
ALLOWED_CONTENT_TYPES = {"application/octet-stream", "audio/ogg", "audio/opus", "audio/webm", "audio/wav", "audio/mpeg"}

LOGGER = logging.getLogger("whatsapp_transcritor")
LOG_DIR = ROOT / "logs"
LOG_DIR.mkdir(parents=True, exist_ok=True)
if not LOGGER.handlers:
    _formatter = logging.Formatter("[%(asctime)s] %(message)s", datefmt="%H:%M:%S")
    _file_handler = logging.FileHandler(LOG_DIR / "backend.log", encoding="utf-8")
    _file_handler.setFormatter(_formatter)
    LOGGER.addHandler(_file_handler)
    _stream_handler = logging.StreamHandler()
    _stream_handler.setFormatter(_formatter)
    LOGGER.addHandler(_stream_handler)
LOGGER.setLevel(logging.INFO)
LOGGER.propagate = False

app = FastAPI(title="WhatsApp Local Transcriber", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"^chrome-extension://[a-p]{32}$",
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type", "X-Local-Token"],
)
app.state.transcriber = LocalTranscriber(MODEL_DIR)
app.state.queue_lock = asyncio.Lock()
app.state.queue_depth = 0


@app.exception_handler(HTTPException)
async def http_exception_handler(_, exc: HTTPException) -> JSONResponse:
    detail = exc.detail
    if isinstance(detail, dict) and detail.get("success") is False:
        return JSONResponse(status_code=exc.status_code, content=detail)
    return JSONResponse(status_code=exc.status_code, content={"success": False, "error": {"code": "http_error", "message": str(detail), "retryable": exc.status_code >= 500}})


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(_, __) -> JSONResponse:
    return JSONResponse(status_code=400, content={"success": False, "error": {"code": "invalid_request", "message": "Requisição inválida", "retryable": False}})


def _token() -> str:
    try:
        return TOKEN_FILE.read_text(encoding="utf-8").strip()
    except OSError:
        return os.getenv("LOCAL_TOKEN", "").strip()


async def require_token(
    supplied: Annotated[str | None, Header(alias="X-Local-Token")] = None,
) -> None:
    expected = _token()
    if not expected or not supplied or not hmac.compare_digest(supplied, expected):
        raise HTTPException(status_code=401, detail={"success": False, "error": {"code": "unauthorized", "message": "Token local inválido", "retryable": False}})


def _supported_signature(path: Path) -> bool:
    with path.open("rb") as handle:
        header = handle.read(16)
    return (
        header.startswith(b"OggS")
        or header.startswith(b"RIFF")
        or header.startswith(b"ID3")
        or header[4:8] == b"ftyp"
        or header.startswith(b"\x1a\x45\xdf\xa3")
    )


async def _store_upload(upload: UploadFile) -> Path:
    content_type = (upload.content_type or "application/octet-stream").lower().split(";", 1)[0].strip()
    if content_type not in ALLOWED_CONTENT_TYPES:
        raise HTTPException(status_code=415, detail={"success": False, "error": {"code": "unsupported_media", "message": "Formato de áudio não suportado", "retryable": False}})
    suffix = Path(upload.filename or "audio.ogg").suffix.lower() or ".ogg"
    handle = tempfile.NamedTemporaryFile(prefix="whatsapp-transcriber-", suffix=suffix, delete=False)
    path = Path(handle.name)
    total = 0
    try:
        with handle:
            while chunk := await upload.read(1024 * 1024):
                total += len(chunk)
                if total > MAX_BYTES:
                    raise HTTPException(status_code=413, detail={"success": False, "error": {"code": "file_too_large", "message": "Áudio excede 25 MB", "retryable": False}})
                handle.write(chunk)
        if total == 0 or not _supported_signature(path):
            raise HTTPException(status_code=415, detail={"success": False, "error": {"code": "invalid_audio", "message": "Conteúdo não parece ser áudio válido", "retryable": False}})
        return path
    except Exception:
        path.unlink(missing_ok=True)
        raise


def _media_duration(path: Path) -> float | None:
    try:
        import av
        with av.open(str(path)) as container:
            durations = [float(stream.duration * stream.time_base) for stream in container.streams if stream.duration and stream.time_base]
        return max(durations, default=None)
    except Exception:
        return None


@app.get("/health", dependencies=[Depends(require_token)])
async def health() -> dict:
    transcriber: LocalTranscriber = app.state.transcriber
    return {
        "status": "ok",
        "model": transcriber.model_name,
        "ready": transcriber.model_available,
        "device": transcriber.device,
        "queue_depth": app.state.queue_depth,
    }


@app.post("/transcribe", dependencies=[Depends(require_token)])
async def transcribe(audio: UploadFile = File(...)) -> JSONResponse:
    if app.state.queue_depth >= 2:
        raise HTTPException(status_code=429, detail={"success": False, "error": {"code": "queue_full", "message": "Fila de transcrição cheia", "retryable": True}})
    path: Path | None = None
    started = time.perf_counter()
    app.state.queue_depth += 1
    try:
        path = await _store_upload(audio)
        if not app.state.transcriber.model_available:
            raise HTTPException(status_code=503, detail={"success": False, "error": {"code": "model_not_ready", "message": "Modelo Whisper ainda não está pronto", "retryable": True}})
        duration = _media_duration(path)
        if duration and duration > MAX_DURATION_SECONDS:
            raise HTTPException(status_code=413, detail={"success": False, "error": {"code": "audio_too_long", "message": "Áudio excede 30 minutos", "retryable": False}})
        async with app.state.queue_lock:
            LOGGER.info("Áudio recebido (%d bytes, dispositivo=%s, duração=%.1fs)", path.stat().st_size, app.state.transcriber.device, duration or 0)
            result: TranscriptionResult = await run_in_threadpool(app.state.transcriber.transcribe, path)
        LOGGER.info("Transcrição concluída em %.1fs", time.perf_counter() - started)
        return JSONResponse({"success": True, "text": result.text, "language": result.language})
    except HTTPException:
        raise
    except Exception:
        LOGGER.exception("Falha na transcrição")
        raise HTTPException(status_code=503, detail={"success": False, "error": {"code": "transcription_failed", "message": "Não foi possível transcrever", "retryable": True}})
    finally:
        app.state.queue_depth = max(0, app.state.queue_depth - 1)
        if path:
            path.unlink(missing_ok=True)
