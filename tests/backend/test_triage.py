from pathlib import Path

from server import app as app_module
from tests.backend.test_app import request, setup


def test_local_triage_requires_token_and_classifies_request(monkeypatch):
    token, _ = setup(monkeypatch)
    try:
        payload = {"senderPhone": "+5511999999999", "messages": [{"text": "Preciso de um orçamento urgente para hoje", "direction": "inbound"}]}
        assert request("POST", "/v1/triage", json=payload).status_code == 401
        response = request("POST", "/v1/triage", headers={"X-Local-Token": "test-token"}, json=payload)
        assert response.status_code == 200
        assert response.json()["data"]["category"] == "orcamento"
        assert response.json()["data"]["priority"] == "urgent"
        assert response.json()["data"]["dueDate"]
    finally:
        token.unlink(missing_ok=True)
