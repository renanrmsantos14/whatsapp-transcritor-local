"""Offline safety/contract checks. The fixture evaluator is not an accuracy test of Jev."""
import asyncio
import json
import os
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from server.assistant_api import install_assistant, Message
from server.assistant_jev import build_context, evaluate, review_result, redact, deadline_candidates, JevEvaluator
from server.assistant_samples import samples
from server.assistant_store import AssistantStore


AT = datetime.fromisoformat("2026-09-28T11:00:00-03:00")


class FixtureEvaluator:
    def __init__(self, sample):
        self.sample, self.calls = sample, []

    async def ask(self, state, questions):
        self.calls.append((state, questions))
        expected = self.sample["expected"]
        choices = {}
        for key, (instructions, options) in questions.items():
            if key.startswith("m"):
                choice = expected["origins"][int(key[1:])]
            elif key == "priority":
                choice = expected["priority"]
            elif key == "owner":
                choice = "me" if expected["owner"] == "Eu" else next((p for p, name in state["participants"].items() if name == expected["owner"]), "unknown")
            elif key == "deadline":
                choice = "ambiguous" if expected["deadline_precision"] == "ambiguous" else next(iter(state["deadline_candidates"]), "none") if expected["deadline_precision"] else "none"
            elif key == "evidence":
                choice = state["messages"][-1]["id"] if "resolved" in expected["origins"] else "none"
            elif key == "same_obligation":
                choice = "independent"
            assert choice in options, (key, choice)
            choices[key] = {"choice": choice, "confidence": .99, "probabilities": {k: .99 if k == choice else .01 / max(1, len(options) - 1) for k in options}}
        return choices, "fixture-not-Jev"


def seed(store, sample, external=True):
    store.set_rules({**store.rules(), "user_name": "Renan"})
    store.consent(sample["id"], sample["name"], True, external)
    store.ingest(sample["id"], sample["messages"])
    context = build_context(store, sample["id"])
    store.approve(sample["id"], context["row"]["version"], context["row"]["generation"], context["hash"])
    return context


@pytest.mark.parametrize("sample", samples(AT), ids=lambda s: s["id"])
def test_synthetic_contract(tmp_path, sample):
    store = AssistantStore(tmp_path / "state.db")
    context = seed(store, sample)
    result = asyncio.run(evaluate(context, FixtureEvaluator(sample), lambda: True, at=AT))
    assert result["priority"] == sample["expected"]["priority"]
    for pending in result["pending"]:
        assert set(pending["evidence_ids"]) <= {m["id"] for m in sample["messages"]}
        assert pending["action"] in [m["text"] for m in sample["messages"]] + ["Áudio ainda não transcrito"]
    if sample["expected"]["owner"] and sample["expected"]["owner"] != "Desconhecido":
        assert result["pending"][0]["owner"] == sample["expected"]["owner"]
    precision = sample["expected"]["deadline_precision"]
    if precision and precision != "ambiguous":
        assert result["pending"][0]["deadline"]["precision"] == precision
    if sample["id"] == "sample:multiple":
        assert len(result["pending"]) == 2
    if sample["id"] == "sample:relative":
        assert result["pending"][0]["deadline"]["value"] == "2026-09-29T10:00:00-03:00"


def test_consent_dedup_redaction_and_delete(tmp_path):
    sample = samples(AT)[1]
    store = AssistantStore(tmp_path / "state.db")
    with pytest.raises(PermissionError):
        store.ingest(sample["id"], sample["messages"])
    context = seed(store, sample, external=False)
    assert not store.approve(sample["id"], context["row"]["version"], context["row"]["generation"], context["hash"])
    version = context["row"]["version"]
    assert not store.ingest(sample["id"], sample["messages"])
    assert store.get(sample["id"])[0]["version"] == version
    assert "cookies" not in context["state"] and "token" not in context["state"]
    assert sample["id"] not in json.dumps(context["state"])
    assert "abc123" not in redact("senha: abc123")
    assert "secret" not in redact("Authorization: Bearer secret")
    assert stat_mode(store.path) == 0o600
    store.delete(sample["id"])
    with pytest.raises(KeyError):
        store.get(sample["id"])
    with pytest.raises(PermissionError):
        store.ingest(sample["id"], sample["messages"])


def stat_mode(path):
    return path.stat().st_mode & 0o777


def test_changes_invalidate_approval_and_old_result(tmp_path):
    sample = samples(AT)[1]
    store = AssistantStore(tmp_path / "state.db")
    context = seed(store, sample)
    row = context["row"]
    current = lambda: store.is_current(sample["id"], row["version"], row["generation"], context["hash"])
    assert current()
    updated = {**sample["messages"][0], "text": "Já resolvi, pode desconsiderar."}
    store.ingest(sample["id"], [updated])
    assert not current()
    store.finish(sample["id"], row["version"], row["generation"], {"priority": "Ver agora"})
    assert store.get(sample["id"])[0]["result"] is None
    store.delete(sample["id"])
    seed(store, sample)
    assert not current()  # Delete/re-create cannot resurrect the old approval.


def test_large_context_never_sent(tmp_path):
    sample = samples(AT)[1]
    sample["messages"][0]["text"] = "x" * 61000
    store = AssistantStore(tmp_path / "state.db")
    context = seed(store, sample)
    evaluator = FixtureEvaluator(sample)
    result = asyncio.run(evaluate(context, evaluator, lambda: True, at=AT))
    assert result["priority"] == "Revisar" and not evaluator.calls


def test_corrections_retrieval_and_retention(tmp_path):
    sample = samples(AT)[1]
    store = AssistantStore(tmp_path / "state.db")
    context = seed(store, sample)
    result = asyncio.run(evaluate(context, FixtureEvaluator(sample), lambda: True, at=AT))
    row = context["row"]
    store.finish(sample["id"], row["version"], row["generation"], result)
    store.correct(sample["id"], result["pending"][0]["id"], "Ver agora", "Eu", False)
    next_context = build_context(store, sample["id"])
    assert next_context["state"]["confirmed_examples"][0]["priority"] == "Ver agora"
    assert store.list()[0]["result"]["priority"] == "Ver agora"
    with store.db() as db:
        db.execute("UPDATE messages SET first_seen='2020-01-01T00:00:00+00:00'")
    store.prune()
    assert store.get(sample["id"])[1]  # Open pendency + correction retain their evidence.
    store.delete(sample["id"])
    with store.db() as db:
        assert db.execute("SELECT COUNT(*) FROM corrections").fetchone()[0] == 0


def test_conversation_correction_without_pendency(tmp_path):
    sample = samples(AT)[3]
    store = AssistantStore(tmp_path / "state.db")
    context = seed(store, sample)
    result = asyncio.run(evaluate(context, FixtureEvaluator(sample), lambda: True, at=AT))
    store.finish(sample["id"], context["row"]["version"], context["row"]["generation"], result)
    store.correct(sample["id"], "__conversation__", "Revisar", "Desconhecido", False)
    assert store.list()[0]["result"]["priority"] == "Revisar"


@pytest.fixture
def client(tmp_path):
    @asynccontextmanager
    async def lifespan(app):
        yield
        await app.state.assistant.stop()
    app = FastAPI(lifespan=lifespan)
    install_assistant(app, lambda: "local-secret", tmp_path / "state.db", FixtureEvaluator(samples(AT)[1]))
    with TestClient(app, base_url="http://127.0.0.1:8765") as client:
        yield client


HEADERS = {"X-Local-Token": "local-secret"}


def test_api_auth_origin_and_whitelist(client):
    assert client.get("/assistant/api/state").status_code == 401
    assert client.post("/assistant/api/rules", headers={**HEADERS, "Origin": "https://evil.example"}).status_code == 403
    assert client.get("/assistant/api/state", headers={**HEADERS, "Host": "evil.example"}).status_code == 403
    assert client.get("/assistant/assets/local-config.js").status_code == 404
    assert "frame-ancestors 'none'" in client.get("/assistant").headers["content-security-policy"]
    sample = samples(AT)[1]
    assert client.post("/assistant/api/messages", headers=HEADERS, json={"id": sample["id"], "messages": sample["messages"]}).status_code == 403
    client.post("/assistant/api/consent", headers=HEADERS, json={"id": sample["id"], "name": sample["name"], "collect": True, "external": True})
    payload = {"id": sample["id"], "messages": [{**sample["messages"][0], "cookies": "session-secret"}]}
    assert client.post("/assistant/api/messages", headers=HEADERS, json=payload).status_code == 422


def test_panel_ticket_is_one_use_and_cookie_needs_origin(client):
    ticket = client.post("/assistant/api/ticket", headers=HEADERS).json()["ticket"]
    assert client.post("/assistant/api/session", json={"ticket": ticket}).status_code == 403
    response = client.post("/assistant/api/session", headers={"Origin": "http://127.0.0.1:8765"}, json={"ticket": ticket})
    assert response.status_code == 200
    assert "HttpOnly" in response.headers["set-cookie"] and "SameSite=strict" in response.headers["set-cookie"]
    assert client.post("/assistant/api/session", headers={"Origin": "http://127.0.0.1:8765"}, json={"ticket": ticket}).status_code == 401
    assert client.get("/assistant/api/state").status_code == 200
    assert client.post("/assistant/api/rules").status_code == 403


def test_api_preview_stale_approval_and_exclusion(client):
    sample = samples(AT)[1]
    client.post("/assistant/api/consent", headers=HEADERS, json={"id": sample["id"], "name": sample["name"], "collect": True, "external": True})
    client.post("/assistant/api/messages", headers=HEADERS, json={"id": sample["id"], "messages": sample["messages"]})
    preview = client.get(f"/assistant/api/conversations/{sample['id']}/preview", headers=HEADERS).json()
    client.post("/assistant/api/messages", headers=HEADERS, json={"id": sample["id"], "messages": [{**sample["messages"][0], "text": "Já resolvido."}]})
    assert client.post(f"/assistant/api/conversations/{sample['id']}/analyze", headers=HEADERS, json={"context_hash": preview["context_hash"]}).status_code == 409
    client.delete(f"/assistant/api/conversations/{sample['id']}", headers=HEADERS)
    assert client.get(f"/assistant/api/conversations/{sample['id']}", headers=HEADERS).status_code == 404


def test_cancellation_and_failure_preserve_prior_result(tmp_path):
    async def scenario():
        sample = samples(AT)[1]
        from server.assistant_api import AssistantManager
        gate = asyncio.Event()
        class Blocking:
            async def ask(self, state, questions):
                await gate.wait()
                raise RuntimeError("secret text that must not leak")
        manager = AssistantManager(tmp_path / "state.db", lambda: "local-secret", Blocking())
        context = seed(manager.store, sample)
        prior = {"priority": "Responder hoje", "pending": [], "next_at": None}
        manager.store.finish(sample["id"], context["row"]["version"], context["row"]["generation"], prior)
        manager.schedule(sample["id"], context)
        await asyncio.sleep(0)
        await manager.stop(sample["id"])
        manager.store.delete(sample["id"])
        gate.set()
        assert not manager.store.list()
        context = seed(manager.store, sample)
        manager.store.finish(sample["id"], context["row"]["version"], context["row"]["generation"], prior)
        await manager.run(sample["id"], context)
        row = manager.store.list()[0]
        assert row["status"] == "error" and row["result"] == prior
        assert "secret text" not in row["error"]
        await manager.stop()
    asyncio.run(scenario())


def test_sdk_shape_and_no_retries(monkeypatch):
    import typesafe_sdk
    captured = {}
    class Client:
        def __init__(self, **kwargs): captured.update(kwargs)
        async def __aenter__(self): return self
        async def __aexit__(self, *args): pass
        async def system_one(self, state, questions):
            from types import SimpleNamespace
            assert isinstance(questions["q"], typesafe_sdk.Choice)
            return SimpleNamespace(model="stub", choices={"q": SimpleNamespace(choice="yes", confidence=.9, probabilities={"yes": .9, "no": .1})})
    monkeypatch.setattr(typesafe_sdk, "AsyncTypeSafeClient", Client)
    answer, _ = asyncio.run(JevEvaluator().ask({}, {"q": ("Supported?", {"yes": None, "no": None})}))
    assert answer["q"]["confidence"] == .9 and captured["retry"].max_retries == 0


def test_unknown_timestamp_rejected_and_relative_date_not_invented():
    with pytest.raises(ValueError):
        Message(id="m", author="Eu", outgoing=True, sent_at="2026-09-28T10:00:00")
    assert not deadline_candidates([{"id": "m", "text": "até amanhã às 10h", "sent_at": None}])


def test_date_candidates_do_not_combine_unrelated_times():
    candidates = deadline_candidates([{"id": "m", "text": "Envio até 29/09/2026. A reunião de outro assunto começa às 15:30. Outro envio em 30/09/2026 às 10h.", "sent_at": AT.isoformat()}])
    assert candidates["dm_0"]["precision"] == "day"
    assert candidates["dm_0"]["value"] == "2026-09-29"
    assert candidates["dm_1"]["value"] == "2026-09-30T10:00:00-03:00"


def test_approved_snapshot_survives_restart_but_not_revocation(tmp_path):
    store = AssistantStore(tmp_path / "state.db")
    sample = samples(AT)[0]
    context = seed(store, sample)
    row = context["row"]
    store.approve(sample["id"], row["version"], row["generation"], context["hash"], context)
    restored = AssistantStore(store.path).approved_context(sample["id"])
    assert restored["state"] == context["state"]
    store.consent(sample["id"], sample["name"], True, False)
    assert store.approved_context(sample["id"]) is None


def test_low_confidence_routes_to_review(tmp_path):
    sample = samples(AT)[1]
    class Uncertain(FixtureEvaluator):
        async def ask(self, state, questions):
            values, model = await super().ask(state, questions)
            if "priority" in values:
                values["priority"]["confidence"] = .84
            return values, model
    store = AssistantStore(tmp_path / "state.db")
    context = seed(store, sample)
    result = asyncio.run(evaluate(context, Uncertain(sample), lambda: True, at=AT))
    assert result["priority"] == "Revisar"
    assert result["pending"][0]["model_priority"] == "Responder hoje"


def test_context_selection_keeps_pending_and_later_resolution(tmp_path):
    store = AssistantStore(tmp_path / "state.db")
    sample = samples(AT)[1]
    context = seed(store, sample)
    result = asyncio.run(evaluate(context, FixtureEvaluator(sample), lambda: True, at=AT))
    row = context["row"]
    store.finish(sample["id"], row["version"], row["generation"], result)
    replies = [{**sample["messages"][0], "id": f"later-{i}", "text": f"Atualização {i}", "sent_at": (AT + timedelta(minutes=i)).isoformat()} for i in range(5)]
    store.ingest(sample["id"], replies)
    next_context = build_context(store, sample["id"])
    assert len(next_context["messages"]) == 6  # Open origin and every subsequent reply.


def test_context_narrows_accepted_information_but_rules_restore_full_context(tmp_path):
    store = AssistantStore(tmp_path / "state.db")
    sample = samples(AT)[3]
    sample["messages"] = [{**sample["messages"][0], "id": f"info-{i}", "sent_at": (AT + timedelta(minutes=i)).isoformat()} for i in range(8)]
    sample["expected"]["origins"] = ["none"] * 8
    context = seed(store, sample)
    result = asyncio.run(evaluate(context, FixtureEvaluator(sample), lambda: True, at=AT))
    row = context["row"]
    store.finish(sample["id"], row["version"], row["generation"], result)
    narrowed = build_context(store, sample["id"])
    assert len(narrowed["messages"]) == 2
    assert narrowed["state"]["omitted_previously_analyzed_messages"] == 6
    # Editing an old message is new evidence, not silently omitted old history.
    store.ingest(sample["id"], [{**sample["messages"][0], "text": "Agora preciso da sua aprovação."}])
    assert len(build_context(store, sample["id"])["messages"]) == 8
    store.set_rules({**store.rules(), "instructions": "Confira as atualizações anteriores."})
    assert len(build_context(store, sample["id"])["messages"]) == 8


def test_acceptance_reply_does_not_duplicate_request(tmp_path):
    sample = samples(AT)[2]
    sample["expected"]["origins"] = ["other", "other"]
    class SameObligation(FixtureEvaluator):
        async def ask(self, state, questions):
            answers, model = await super().ask(state, questions)
            if "same_obligation" in answers:
                answers["same_obligation"]["choice"] = "m0"
            return answers, model
    store = AssistantStore(tmp_path / "state.db")
    context = seed(store, sample)
    result = asyncio.run(evaluate(context, SameObligation(sample), lambda: True, at=AT))
    assert len(result["pending"]) == 1
    assert result["pending"][0]["id"] == sample["messages"][0]["id"]
    assert sample["messages"][1]["id"] in result["pending"][0]["evidence_ids"]


def test_current_deadline_selected_before_priority(tmp_path):
    from server.assistant_samples import holdout_samples
    sample = next(s for s in holdout_samples(AT) if s["id"] == "holdout:rescheduled")
    class CurrentDeadline(FixtureEvaluator):
        async def ask(self, state, questions):
            answers, model = await super().ask(state, questions)
            if "deadline" in answers:
                answers["deadline"]["choice"] = "dm1_0"
            if "priority" in answers:
                assert list(state["deadline_candidates"]) == ["dm1_0"]
                assert state["deadline_candidates"]["dm1_0"]["raw"] == "amanhã às 18h"
            return answers, model
    store = AssistantStore(tmp_path / "state.db")
    context = seed(store, sample)
    result = asyncio.run(evaluate(context, CurrentDeadline(sample), lambda: True, at=AT))
    assert result["priority"] == "Responder hoje"
    assert result["pending"][0]["deadline"]["message_id"] == sample["messages"][1]["id"]


def test_uncertain_grouping_cannot_reopen_completed_actions(tmp_path):
    from server.assistant_samples import holdout_samples
    sample = next(s for s in holdout_samples(AT) if s["id"] == "holdout:cancelled")
    sample["expected"]["origins"] = ["resolved", "resolved", "none"]
    class Completed(FixtureEvaluator):
        async def ask(self, state, questions):
            answers, model = await super().ask(state, questions)
            if "same_obligation" in answers:
                answers["same_obligation"].update(choice="m0", confidence=.52)
            return answers, model
    store = AssistantStore(tmp_path / "state.db")
    context = seed(store, sample)
    result = asyncio.run(evaluate(context, Completed(sample), lambda: True, at=AT))
    assert result["priority"] == "Informativo"
    assert all(p["resolved"] for p in result["pending"])


def test_automatic_selection_preserves_complete_tail(tmp_path):
    sample = samples(AT)[0]
    base = sample["messages"][0]
    sample["messages"] = [{**base, "id": f"message-{i}", "text": f"Atualização {i}", "quoted": ""} for i in range(93)]
    store = AssistantStore(tmp_path / "state.db")
    context = seed(store, sample)
    assert not context["blocked"]
    assert len(context["messages"]) == 40
    assert context["state"]["context_selection"]["older_unanalyzed"] == 53
    assert context["messages"][-1]["id"] == "message-92"
