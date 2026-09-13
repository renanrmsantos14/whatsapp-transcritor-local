from pathlib import Path
from types import SimpleNamespace

import pytest

from server.transcriber import LocalTranscriber


class FakeModel:
    def __init__(self):
        self.options = []

    def transcribe(self, _, **options):
        self.options.append(options)
        return [SimpleNamespace(text=" teste ")], SimpleNamespace(language="pt", language_probability=1, duration=1)


@pytest.mark.parametrize(("mode", "model_name", "beam_size"), [("fast", "base", 1), ("balanced", "small", 1), ("precise", "small", 5)])
def test_transcription_mode_controls_model_and_search_effort(tmp_path: Path, mode: str, model_name: str, beam_size: int):
    transcriber = LocalTranscriber(tmp_path)
    transcriber._models[model_name] = FakeModel()

    result = transcriber.transcribe(tmp_path / "audio.ogg", transcription_mode=mode)

    assert result.text == "teste"
    options = transcriber._models[model_name].options[0]
    assert options["beam_size"] == beam_size
    assert options["temperature"] == (0.0, 0.2, 0.4)
    assert options["compression_ratio_threshold"] == 2.4
    assert options["repetition_penalty"] == 1.1
    assert options["no_repeat_ngram_size"] == 3
