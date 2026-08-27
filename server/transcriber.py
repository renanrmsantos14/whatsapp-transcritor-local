from __future__ import annotations

import logging
from dataclasses import dataclass
from pathlib import Path
from threading import Lock

LOGGER = logging.getLogger(__name__)
MODEL_REPOSITORY = "Systran/faster-whisper-small"
MODEL_REVISION = "536b0662742c02347bc0e980a01041f333bce120"

@dataclass(frozen=True)
class TranscriptionResult:
    text: str
    language: str
    language_probability: float | None
    duration_seconds: float | None

class LocalTranscriber:
    def __init__(self, model_dir: Path) -> None:
        self.model_dir = model_dir
        self.model_name = "small"
        self.device = "cpu"
        self._model = None
        self._load_lock = Lock()

    @property
    def model_available(self) -> bool:
        return any(self.model_dir.rglob("model.bin")) if self.model_dir.exists() else False

    def _model_source(self) -> str:
        snapshots = sorted(self.model_dir.rglob("model.bin")) if self.model_dir.exists() else []
        if snapshots:
            return str(snapshots[0].parent)
        from huggingface_hub import snapshot_download
        return snapshot_download(repo_id=MODEL_REPOSITORY, revision=MODEL_REVISION, cache_dir=str(self.model_dir))

    def _load(self):
        if self._model is not None:
            return self._model
        with self._load_lock:
            if self._model is not None:
                return self._model
            from faster_whisper import WhisperModel
            self.model_dir.mkdir(parents=True, exist_ok=True)
            self._model = WhisperModel(self._model_source(), device="cpu", compute_type="int8", cpu_threads=4, local_files_only=True)
            LOGGER.info("Whisper small carregado em CPU int8")
            return self._model

    def warmup(self) -> None:
        self._load()

    def transcribe(self, audio_path: Path, hotwords: list[str] | None = None) -> TranscriptionResult:
        clean_hotwords = [term.strip() for term in (hotwords or []) if term.strip()]
        segments, info = self._load().transcribe(str(audio_path), beam_size=5, vad_filter=True, condition_on_previous_text=False, temperature=0, hotwords=", ".join(clean_hotwords) or None)
        return TranscriptionResult(
            text=" ".join(segment.text.strip() for segment in segments).strip(),
            language=getattr(info, "language", "") or "",
            language_probability=getattr(info, "language_probability", None),
            duration_seconds=getattr(info, "duration", None),
        )
