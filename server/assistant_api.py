"""Read-only WhatsApp assistant API and same-origin local panel sessions."""
from __future__ import annotations

import asyncio
import hashlib
import hmac
import os
import secrets
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import FileResponse
from pydantic import BaseModel, ConfigDict, Field, field_validator

from .assistant_jev import JevEvaluator, build_context, evaluate, review_result, provider_key
from .assistant_store import AssistantStore, now_iso

ROOT = Path(__file__).resolve().parents[1]
LOCAL_ORIGIN = "http://127.0.0.1:8765"
EXTENSION_ORIGIN = "chrome-extension://fnbeofeamojeohjnommhklnkpfflhjnk"
CID = r"^[A-Za-z0-9@._:+-]{1,180}$"


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


class Consent(Strict):
    id: str = Field(pattern=CID)
    name: str = Field(min_length=1, max_length=160)
    collect: bool
    external: bool
    role: str = Field(default="", max_length=160)
    relation: str = Field(default="", max_length=160)


class Message(Strict):
    id: str = Field(min_length=1, max_length=256)
    author: str = Field(min_length=1, max_length=160)
    outgoing: bool
    sent_at: str | None = Field(default=None, max_length=80)
    time_raw: str = Field(default="", max_length=100)
    text: str = Field(default="", max_length=8000)
    quoted: str = Field(default="", max_length=4000)
    kind: Literal["text", "audio", "system"] = "text"
    audio_missing: bool = False
    metadata_missing: bool = False

    @field_validator("sent_at")
    @classmethod
    def aware_time(cls, value):
        if value is None:
            return value
        timestamp = datetime.fromisoformat(value)
        if timestamp.tzinfo is None:
            raise ValueError("Timestamp precisa incluir fuso.")
        return timestamp.astimezone(timezone.utc).isoformat()


class Ingest(Strict):
    id: str = Field(pattern=CID)
    messages: list[Message] = Field(min_length=1, max_length=80)


class Approval(Strict):
    context_hash: str = Field(pattern=r"^[a-f0-9]{64}$")


class Correction(Strict):
    pending_id: str = Field(min_length=1, max_length=256)
    priority: Literal["Ver agora", "Responder hoje", "Acompanhar", "Informativo", "Revisar"]
    owner: str = Field(min_length=1, max_length=160)
    resolved: bool = False


class Rules(Strict):
    near_hours: int = Field(default=2, ge=1, le=48)
    confidence: float = Field(default=0.85, ge=0.5, le=1)
    retention_days: int = Field(default=30, ge=1, le=365)
    instructions: str = Field(default="", max_length=4000)
    user_name: str = Field(default="", max_length=160)


class Ticket(Strict):
    ticket: str = Field(min_length=20, max_length=160)


class AssistantManager:
    def __init__(self, path, token_reader, evaluator=None):
        self.path, self.token_reader = path, token_reader
        self._store = None
        self.evaluator = evaluator or JevEvaluator()
        self.tasks = {}
        self.approved_contexts = {}
        self.tickets, self.sessions = {}, {}
        self.loop_task = None

    @property
    def store(self):
        if self._store is None:
            self._store = AssistantStore(self.path)
        return self._store

    async def stop(self, cid=None):
        targets = [self.tasks[cid]] if cid in self.tasks else [] if cid else list(self.tasks.values())
        if cid is None and self.loop_task:
            targets.append(self.loop_task)
            self.loop_task = None
        for task in targets:
            task.cancel()
        if targets:
            await asyncio.gather(*targets, return_exceptions=True)
        if cid:
            self.tasks.pop(cid, None)
            self.approved_contexts.pop(cid, None)

    def schedule(self, cid, context):
        existing = self.tasks.get(cid)
        if existing and not existing.done():
            return
        self.approved_contexts[cid] = context
        self.tasks[cid] = asyncio.create_task(self.run(cid, context))
        self.start()

    def start(self):
        if not self.loop_task:
            self.loop_task = asyncio.create_task(self.tick())

    async def run(self, cid, context):
        row = context["row"]
        current = lambda: self.store.is_current(cid, row["version"], row["generation"], context["hash"])
        try:
            if not current():
                return
            if context["blocked"]:
                result = review_result(context, context["blocked"])
            else:
                result = await evaluate(context, self.evaluator, current)
            if current():
                self.store.finish(cid, row["version"], row["generation"], result)
        except asyncio.CancelledError:
            raise
        except Exception:
            # Provider exceptions can contain request text or API keys. Never log/return them.
            if current():
                self.store.finish(cid, row["version"], row["generation"], None,
                                  "Jev indisponível. Verifique chave, SDK e conexão no serviço local; resultado anterior está desatualizado.")

    async def tick(self):
        try:
            while True:
                await asyncio.sleep(60)
                self.store.prune()
                for row in self.store.list():
                    if row["status"] == "ready" and row["next_at"] and datetime.fromisoformat(row["next_at"]) <= datetime.now(timezone.utc):
                        context = self.approved_contexts.get(row["id"]) or self.store.approved_context(row["id"])
                        if context and self.store.is_current(row["id"], context["row"]["version"], context["row"]["generation"], context["hash"]):
                            self.schedule(row["id"], context)
        except asyncio.CancelledError:
            return


def install_assistant(app, token_reader, path=None, evaluator=None):
    manager = AssistantManager(path or Path(os.getenv("ASSISTANT_DB", ROOT / "data" / "assistant.sqlite3")), token_reader, evaluator)
    app.state.assistant = manager
    router = APIRouter(prefix="/assistant")

    def origin_ok(request):
        return request.headers.get("origin") in {LOCAL_ORIGIN, EXTENSION_ORIGIN}

    async def authorize(request: Request):
        if request.headers.get("host") != "127.0.0.1:8765":
            raise HTTPException(403, "Host local inválido.")
        supplied = request.headers.get("X-Local-Token", "")
        expected = token_reader()
        if supplied and expected and hmac.compare_digest(supplied, expected):
            if request.headers.get("origin") and not origin_ok(request):
                raise HTTPException(403, "Origem inválida.")
            return
        session = request.cookies.get("wa_assistant", "")
        expires = manager.sessions.get(hashlib.sha256(session.encode()).hexdigest(), 0)
        if expires <= time.time():
            raise HTTPException(401, "Abra o painel pelo ícone da extensão.")
        if request.method not in {"GET", "HEAD"} and request.headers.get("origin") != LOCAL_ORIGIN:
            raise HTTPException(403, "Origem inválida.")

    @router.get("")
    @router.get("/assets/{asset}")
    async def panel(asset: str = "assistant.html"):
        if asset not in {"assistant.html", "assistant.js", "assistant.css"}:
            raise HTTPException(404)
        response = FileResponse(ROOT / "extension" / asset)
        response.headers["Content-Security-Policy"] = "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"
        response.headers["Cache-Control"] = "no-store"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["X-Content-Type-Options"] = "nosniff"
        return response

    @router.post("/api/ticket", dependencies=[Depends(authorize)])
    async def ticket(request: Request):
        # Session cookies cannot create new sessions; only the extension/local CLI can.
        if not request.headers.get("X-Local-Token"):
            raise HTTPException(403)
        manager.tickets = {k: v for k, v in manager.tickets.items() if v > time.time()}
        if len(manager.tickets) >= 20:
            raise HTTPException(429)
        value = secrets.token_urlsafe(32)
        manager.tickets[hashlib.sha256(value.encode()).hexdigest()] = time.time() + 60
        return {"ticket": value}

    @router.post("/api/session")
    async def session(body: Ticket, request: Request, response: Response):
        if request.headers.get("origin") != LOCAL_ORIGIN or request.headers.get("host") != "127.0.0.1:8765":
            raise HTTPException(403)
        expires = manager.tickets.pop(hashlib.sha256(body.ticket.encode()).hexdigest(), 0)
        if expires <= time.time():
            raise HTTPException(401, "Link expirou. Abra novamente pelo ícone da extensão.")
        value = secrets.token_urlsafe(32)
        manager.sessions = {k: v for k, v in manager.sessions.items() if v > time.time()}
        manager.sessions[hashlib.sha256(value.encode()).hexdigest()] = time.time() + 8 * 3600
        response.set_cookie("wa_assistant", value, httponly=True, samesite="strict", path="/assistant", max_age=8 * 3600)
        response.headers["Cache-Control"] = "no-store"
        return {"success": True}

    api = APIRouter(prefix="/api", dependencies=[Depends(authorize)])

    @api.get("/state")
    async def state():
        return {"conversations": manager.store.list(), "rules": manager.store.rules(),
                "provider_configured": bool(provider_key()),
                "limits": {"messages": 40, "context_bytes": 60000, "pending": 12}}

    @api.get("/permission/{cid}")
    async def permission(cid: str):
        try:
            row, _, _ = manager.store.get(cid)
            return {"collect": bool(row["collect"]), "exists": True, "excluded": False}
        except KeyError:
            return {"collect": False, "exists": False, "excluded": manager.store.excluded(cid)}

    @api.post("/auto-collect")
    async def auto_collect(body: Consent):
        if body.external or not body.collect:
            raise HTTPException(400, "A coleta automática permite somente armazenamento local.")
        if manager.store.excluded(body.id):
            return {"success": True, "collect": False}
        try:
            row, _, _ = manager.store.get(body.id)
            if row["name"] in {"Profile details", "Dados do perfil", "Detalhes do perfil"} and body.name != row["name"]:
                await manager.stop(body.id)
                manager.store.consent(body.id, body.name, bool(row["collect"]), bool(row["external"]), row["role"], row["relation"])
            return {"success": True, "collect": bool(row["collect"])}
        except KeyError:
            manager.store.consent(cid=body.id, name=body.name, collect=True, external=False)
        return {"success": True, "collect": True}

    @api.post("/consent")
    async def consent(body: Consent):
        await manager.stop(body.id)
        try:
            manager.store.consent(**body.model_dump(exclude={"id"}), cid=body.id)
        except ValueError as error:
            raise HTTPException(400, str(error)) from None
        return {"success": True}

    @api.post("/messages")
    async def ingest(body: Ingest):
        if len(body.model_dump_json().encode()) > 120000:
            raise HTTPException(413, "Lote muito grande; envie menos mensagens sem truncar textos.")
        try:
            changed = manager.store.ingest(body.id, [m.model_dump() for m in body.messages])
        except PermissionError as error:
            raise HTTPException(403, str(error)) from None
        if changed:
            await manager.stop(body.id)
        return {"success": True, "changed": changed}

    @api.get("/conversations/{cid}")
    async def detail(cid: str):
        try:
            row, messages, corrections = manager.store.get(cid)
        except KeyError:
            raise HTTPException(404) from None
        return {"conversation": manager.store.decode(row), "messages": messages, "corrections": corrections}

    @api.get("/conversations/{cid}/preview")
    async def preview(cid: str):
        try:
            context = build_context(manager.store, cid)
        except KeyError:
            raise HTTPException(404) from None
        return {"context_hash": context["hash"], "state": context["state"], "blocked": context["blocked"],
                "bytes": len(__import__("json").dumps(context["state"], ensure_ascii=False).encode())}

    @api.post("/conversations/{cid}/analyze", status_code=202)
    async def analyze(cid: str, body: Approval):
        try:
            context = build_context(manager.store, cid)
        except KeyError:
            raise HTTPException(404) from None
        if context["hash"] != body.context_hash:
            raise HTTPException(409, "Contexto mudou. Revise os trechos novamente.")
        row = context["row"]
        if not manager.store.approve(cid, row["version"], row["generation"], context["hash"], context):
            raise HTTPException(403, "Coleta local e envio externo precisam estar autorizados.")
        manager.schedule(cid, context)
        return {"success": True, "status": "queued"}

    @api.post("/conversations/{cid}/corrections")
    async def correction(cid: str, body: Correction):
        await manager.stop(cid)
        try:
            manager.store.correct(cid, **body.model_dump())
        except KeyError:
            raise HTTPException(404) from None
        except ValueError as error:
            raise HTTPException(400, str(error)) from None
        return {"success": True}

    @api.delete("/conversations/{cid}")
    async def delete(cid: str):
        await manager.stop(cid)
        manager.store.delete(cid)
        return {"success": True}

    @api.post("/rules")
    async def rules(body: Rules):
        for cid in list(manager.tasks):
            await manager.stop(cid)
        manager.store.set_rules(body.model_dump())
        return {"success": True}

    router.include_router(api)
    app.include_router(router)
    return manager
