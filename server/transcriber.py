from __future__ import annotations

import logging
from dataclasses import dataclass
from pathlib import Path
from threading import Lock

LOGGER = logging.getLogger(__name__)


@dataclass(frozen=True)
class TranscriptionResult:
    text: str
    language: str
    duration_seconds: float | None = None


class LocalTranscriber:
    """Lazy faster-whisper wrapper with CUDA-to-CPU fallback."""

    def __init__(self, model_dir: Path, model_name: str = "small") -> None:
        self.model_dir = model_dir
        self.model_name = model_name
        self.device = "cpu"
        self._model = None
        self._load_lock = Lock()

    @property
    def model_available(self) -> bool:
        return self.model_dir.exists() and any(self.model_dir.rglob("*"))

    def _load(self):
        if self._model is not None:
            return self._model
        with self._load_lock:
            if self._model is not None:
                return self._model
            from faster_whisper import WhisperModel

            self.model_dir.mkdir(parents=True, exist_ok=True)
            source = self.model_name
            if self.model_available:
                snapshots = sorted(self.model_dir.rglob("model.bin"))
                if snapshots:
                    source = str(snapshots[0].parent)
            try:
                import ctranslate2

                cuda_count = ctranslate2.get_cuda_device_count()
            except Exception:
                cuda_count = 0

            if cuda_count:
                try:
                    self._model = WhisperModel(
                        source,
                        device="cuda",
                        compute_type="float16",
                        download_root=str(self.model_dir),
                    )
                    self.device = "cuda"
                    LOGGER.info("Whisper carregado em CUDA")
                    return self._model
                except Exception as exc:
                    LOGGER.warning("CUDA indisponível (%s); usando CPU", exc)

            self._model = WhisperModel(
                source,
                device="cpu",
                compute_type="int8",
                cpu_threads=4,
                download_root=str(self.model_dir),
            )
            self.device = "cpu"
            LOGGER.info("Whisper carregado em CPU int8")
            return self._model

    def warmup(self) -> None:
        self._load()

    def transcribe(self, audio_path: Path) -> TranscriptionResult:
        model = self._load()
        segments, info = model.transcribe(
            str(audio_path),
            language="pt",
            beam_size=5,
            vad_filter=True,
            condition_on_previous_text=False,
            temperature=0,
        )
        text = " ".join(segment.text.strip() for segment in segments).strip()
        duration = getattr(info, "duration", None)
        return TranscriptionResult(text=text, language="pt", duration_seconds=duration)

