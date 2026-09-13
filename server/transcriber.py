from __future__ import annotations

import logging
from dataclasses import dataclass
from pathlib import Path
from threading import Lock

LOGGER = logging.getLogger(__name__)
MODEL_REPOSITORY = "Systran/faster-whisper-small"
MODEL_REVISION = "536b0662742c02347bc0e980a01041f333bce120"
BASE_MODEL_REPOSITORY = "Systran/faster-whisper-base"
BASE_MODEL_REVISION = "a80717a3a48b1b28aa687bca146cb7301feae1b1"
MODE_PROFILE = {
    "fast": {"name": "base", "repository": BASE_MODEL_REPOSITORY, "revision": BASE_MODEL_REVISION, "beam_size": 1},
    "balanced": {"name": "small", "repository": MODEL_REPOSITORY, "revision": MODEL_REVISION, "beam_size": 1},
    "precise": {"name": "small", "repository": MODEL_REPOSITORY, "revision": MODEL_REVISION, "beam_size": 5},
}

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
        self._models = {}
        self._load_lock = Lock()

    @property
    def model_available(self) -> bool:
        return all((self._snapshot_path(profile) / "model.bin").exists() for profile in (MODE_PROFILE["fast"], MODE_PROFILE["balanced"]))

    def _snapshot_path(self, profile: dict) -> Path:
        repository_folder = "models--" + profile["repository"].replace("/", "--")
        return self.model_dir / repository_folder / "snapshots" / profile["revision"]

    def _model_source(self, profile: dict) -> str:
        snapshot = self._snapshot_path(profile)
        if (snapshot / "model.bin").exists():
            return str(snapshot)
        from huggingface_hub import snapshot_download
        return snapshot_download(repo_id=profile["repository"], revision=profile["revision"], cache_dir=str(self.model_dir))

    def _load(self, transcription_mode: str):
        profile = MODE_PROFILE.get(transcription_mode, MODE_PROFILE["balanced"])
        model_name = profile["name"]
        if model_name in self._models:
            return self._models[model_name]
        with self._load_lock:
            if model_name in self._models:
                return self._models[model_name]
            from faster_whisper import WhisperModel
            self.model_dir.mkdir(parents=True, exist_ok=True)
            model = WhisperModel(self._model_source(profile), device="cpu", compute_type="int8", cpu_threads=4, local_files_only=True)
            self._models[model_name] = model
            LOGGER.info("Whisper %s carregado em CPU int8", model_name)
            return model

    def warmup(self, transcription_mode: str = "balanced") -> None:
        self._load(transcription_mode)

    def transcribe(self, audio_path: Path, hotwords: list[str] | None = None, transcription_mode: str = "balanced") -> TranscriptionResult:
        clean_hotwords = [term.strip() for term in (hotwords or []) if term.strip()]
        profile = MODE_PROFILE.get(transcription_mode, MODE_PROFILE["balanced"])
        segments, info = self._load(transcription_mode).transcribe(
            str(audio_path),
            beam_size=profile["beam_size"],
            vad_filter=True,
            condition_on_previous_text=False,
            temperature=(0.0, 0.2, 0.4),
            compression_ratio_threshold=2.4,
            repetition_penalty=1.1,
            no_repeat_ngram_size=3,
            hotwords=", ".join(clean_hotwords) or None,
        )
        return TranscriptionResult(
            text=" ".join(segment.text.strip() for segment in segments).strip(),
            language=getattr(info, "language", "") or "",
            language_probability=getattr(info, "language_probability", None),
            duration_seconds=getattr(info, "duration", None),
        )
