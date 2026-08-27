from pathlib import Path
from types import SimpleNamespace

from fastapi.testclient import TestClient

from server import app as app_module
from server.transcriber import TranscriptionResult


class FakeTranscriber:
    model_name = "small"
    device = "cpu"
    model_available = True

    def __init__(self):
        self.seen_path: Path | None = None

    def transcribe(self, path: Path) -> TranscriptionResult:
        self.seen_path = path
        assert path.exists()
        return TranscriptionResult("bom dia", "pt", 3.0)


def client(monkeypatch):
    token_file = Path(__file__).with_name(".test-token")
    token_file.write_text("test-token", encoding="utf-8")
    monkeypatch.setattr(app_module, "TOKEN_FILE", token_file)
    fake = FakeTranscriber()
    app_module.app.state.transcriber = fake
    app_module.app.state.queue_depth = 0
    return TestClient(app_module.app), fake, token_file


def test_health_requires_token(monkeypatch):
    client_instance, _, token_file = client(monkeypatch)
    try:
        assert client_instance.get("/health").status_code == 401
        response = client_instance.get("/health", headers={"X-Local-Token": "test-token"})
        assert response.json()["ready"] is True
    finally:
        token_file.unlink(missing_ok=True)


def test_transcribe_removes_temp_file(monkeypatch):
    client_instance, fake, token_file = client(monkeypatch)
    try:
        response = client_instance.post(
            "/transcribe",
            headers={"X-Local-Token": "test-token"},
            files={"audio": ("note.ogg", b"OggS" + b"\x00" * 32, "audio/ogg")},
        )
        assert response.status_code == 200
        assert response.json() == {"success": True, "text": "bom dia", "language": "pt"}
        assert fake.seen_path is not None and not fake.seen_path.exists()
    finally:
        token_file.unlink(missing_ok=True)


def test_invalid_audio_rejected(monkeypatch):
    client_instance, _, token_file = client(monkeypatch)
    try:
        response = client_instance.post(
            "/transcribe",
            headers={"X-Local-Token": "test-token"},
            files={"audio": ("note.txt", b"not audio", "text/plain")},
        )
        assert response.status_code == 415
        assert response.json()["error"]["code"] == "unsupported_media"
    finally:
        token_file.unlink(missing_ok=True)

