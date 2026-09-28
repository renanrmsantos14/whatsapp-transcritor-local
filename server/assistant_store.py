"""Local-only assistant state. No WhatsApp credentials or provider key are stored."""
from __future__ import annotations

import hashlib
import json
import os
import sqlite3
import threading
import uuid
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path

PRIORITIES = ("Ver agora", "Responder hoje", "Acompanhar", "Informativo", "Revisar")
DEFAULT_RULES = {"near_hours": 2, "confidence": 0.85, "retention_days": 30, "instructions": "", "user_name": ""}


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def digest(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


class AssistantStore:
    def __init__(self, path: Path):
        self.path = path
        self.lock = threading.RLock()
        path.parent.mkdir(parents=True, exist_ok=True)
        with self.db() as db:
            db.executescript("""
                CREATE TABLE IF NOT EXISTS conversations (
                  id TEXT PRIMARY KEY, name TEXT NOT NULL, collect INTEGER NOT NULL DEFAULT 0,
                  external INTEGER NOT NULL DEFAULT 0, role TEXT NOT NULL DEFAULT '',
                  relation TEXT NOT NULL DEFAULT '', generation TEXT NOT NULL,
                  version INTEGER NOT NULL DEFAULT 0, last_collected TEXT,
                  result TEXT, status TEXT NOT NULL DEFAULT 'disabled', error TEXT,
                  approved_hash TEXT, analyzed_at TEXT, next_at TEXT);
                CREATE TABLE IF NOT EXISTS messages (
                  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
                  id TEXT NOT NULL, payload TEXT NOT NULL, first_seen TEXT NOT NULL,
                  PRIMARY KEY(conversation_id,id));
                CREATE TABLE IF NOT EXISTS corrections (
                  id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
                  payload TEXT NOT NULL, created_at TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS excluded_conversations (id TEXT PRIMARY KEY);
                CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY CHECK(id=1), payload TEXT NOT NULL);
            """)
            if "approved_context" not in {row[1] for row in db.execute("PRAGMA table_info(conversations)")}:
                db.execute("ALTER TABLE conversations ADD COLUMN approved_context TEXT")
            db.execute("INSERT OR IGNORE INTO settings VALUES(1,?)", (json.dumps(DEFAULT_RULES),))
        os.chmod(path, 0o600)

    @contextmanager
    def db(self):
        with self.lock:
            db = sqlite3.connect(self.path)
            db.row_factory = sqlite3.Row
            db.execute("PRAGMA foreign_keys=ON")
            db.execute("PRAGMA secure_delete=ON")
            try:
                with db:
                    yield db
            finally:
                db.close()

    def rules(self):
        with self.db() as db:
            return json.loads(db.execute("SELECT payload FROM settings WHERE id=1").fetchone()[0])

    def set_rules(self, value):
        with self.db() as db:
            db.execute("UPDATE settings SET payload=? WHERE id=1", (json.dumps(value),))
            db.execute("UPDATE conversations SET version=version+1, approved_hash=NULL, approved_context=NULL, status=CASE WHEN collect=1 AND external=1 THEN 'approval_required' WHEN collect=1 THEN 'collecting' ELSE 'disabled' END")

    def list(self):
        with self.db() as db:
            rows = db.execute("SELECT * FROM conversations ORDER BY name").fetchall()
        return [self.decode(row) for row in rows]

    @staticmethod
    def decode(row):
        item = dict(row)
        item["collect"], item["external"] = bool(item["collect"]), bool(item["external"])
        item["result"] = json.loads(item["result"]) if item["result"] else None
        item.pop("approved_hash", None)
        item.pop("approved_context", None)
        return item

    def get(self, cid):
        with self.db() as db:
            row = db.execute("SELECT * FROM conversations WHERE id=?", (cid,)).fetchone()
            if not row:
                raise KeyError(cid)
            messages = [json.loads(m[0]) for m in db.execute("SELECT payload FROM messages WHERE conversation_id=? ORDER BY first_seen,id", (cid,))]
            corrections = [json.loads(c[0]) for c in db.execute("SELECT payload FROM corrections WHERE conversation_id=? ORDER BY created_at", (cid,))]
        # Unknown timestamps remain visibly unknown; arrival order is preserved in that case.
        messages.sort(key=lambda m: m.get("sent_at") or m["observed_at"])
        return dict(row), messages, corrections

    def consent(self, cid, name, collect, external, role="", relation=""):
        if external and not collect:
            raise ValueError("A coleta local precisa estar autorizada antes do envio externo.")
        with self.db() as db:
            db.execute("INSERT OR IGNORE INTO conversations(id,name,generation) VALUES(?,?,?)", (cid, name, uuid.uuid4().hex))
            db.execute("UPDATE conversations SET name=?,collect=?,external=?,role=?,relation=?,version=version+1,approved_hash=NULL,approved_context=NULL,error=NULL,status=? WHERE id=?",
                       (name, collect, external, role, relation, "approval_required" if external else "collecting" if collect else "disabled", cid))

    def ingest(self, cid, messages):
        with self.db() as db:
            row = db.execute("SELECT collect FROM conversations WHERE id=?", (cid,)).fetchone()
            if not row or not row[0]:
                raise PermissionError("Conversa não autorizada para coleta.")
            changed = False
            for message in messages:
                old = db.execute("SELECT payload FROM messages WHERE conversation_id=? AND id=?", (cid, message["id"])).fetchone()
                value = dict(message)
                previous = json.loads(old[0]) if old else None
                # DOM/cache refresh must not erase an already captured transcript.
                if previous and previous.get("kind") == "audio" and previous.get("text") and not value.get("text"):
                    value["text"] = previous["text"]
                    value["audio_missing"] = False
                value["observed_at"] = previous["observed_at"] if previous else now_iso()
                payload = json.dumps(value, ensure_ascii=False, sort_keys=True)
                if old and payload == old[0]:
                    continue
                db.execute("INSERT INTO messages VALUES(?,?,?,?) ON CONFLICT(conversation_id,id) DO UPDATE SET payload=excluded.payload",
                           (cid, value["id"], payload, value["observed_at"]))
                changed = True
            if changed:
                db.execute("UPDATE conversations SET version=version+1,approved_hash=NULL,approved_context=NULL,error=NULL,status=CASE WHEN external=1 THEN 'approval_required' ELSE 'collecting' END WHERE id=?", (cid,))
            db.execute("UPDATE conversations SET last_collected=? WHERE id=?", (now_iso(), cid))
        return changed

    def approve(self, cid, version, generation, context_hash, context=None):
        with self.db() as db:
            if context:
                context = {**context, "row": {**context["row"], "approved_context": None}}
            changed = db.execute("UPDATE conversations SET approved_hash=?,approved_context=?,status='queued',error=NULL WHERE id=? AND version=? AND generation=? AND collect=1 AND external=1",
                                 (context_hash, json.dumps(context, ensure_ascii=False) if context else None, cid, version, generation)).rowcount
        return bool(changed)

    def approved_context(self, cid):
        with self.db() as db:
            row = db.execute("SELECT approved_context FROM conversations WHERE id=?", (cid,)).fetchone()
        return json.loads(row[0]) if row and row[0] else None

    def is_current(self, cid, version, generation, context_hash):
        with self.db() as db:
            row = db.execute("SELECT 1 FROM conversations WHERE id=? AND version=? AND generation=? AND approved_hash=? AND collect=1 AND external=1", (cid, version, generation, context_hash)).fetchone()
        return bool(row)

    def finish(self, cid, version, generation, result, error=None):
        with self.db() as db:
            if error:
                db.execute("UPDATE conversations SET status='error',error=? WHERE id=? AND version=? AND generation=? AND collect=1 AND external=1", (error, cid, version, generation))
            else:
                db.execute("UPDATE conversations SET result=?,status='ready',error=NULL,analyzed_at=?,next_at=? WHERE id=? AND version=? AND generation=? AND collect=1 AND external=1",
                           (json.dumps(result, ensure_ascii=False), now_iso(), result.get("next_at"), cid, version, generation))

    def correct(self, cid, pending_id, priority, owner, resolved):
        row, messages, _ = self.get(cid)
        result = json.loads(row["result"]) if row["result"] else None
        pending = next((p for p in (result or {}).get("pending", []) if p["id"] == pending_id), None)
        if not pending and pending_id != "__conversation__":
            raise ValueError("Pendência não encontrada no resultado atual.")
        if not result or not messages:
            raise ValueError("É necessário um resultado com mensagens para corrigir.")
        authors = {m["author"] for m in messages} | {"Eu", "Desconhecido"}
        if owner not in authors:
            raise ValueError("Responsável precisa ser um participante conhecido.")
        evidence_ids = pending["evidence_ids"] if pending else [m["id"] for m in messages[-40:]]
        correction = {"pending_id": pending_id, "priority": priority, "owner": owner, "resolved": resolved,
                      "version": row["version"], "evidence_ids": evidence_ids,
                      "example_messages": [m for m in messages if m["id"] in evidence_ids]}
        with self.db() as db:
            db.execute("INSERT INTO corrections VALUES(?,?,?,?)", (uuid.uuid4().hex, cid, json.dumps(correction, ensure_ascii=False), now_iso()))
            # The correction is immediately visible, but a new message may reopen it.
            for p in result["pending"]:
                if p["id"] == pending_id:
                    p.update(priority=priority, owner=owner, resolved=resolved, corrected=True)
            active = [p["priority"] for p in result["pending"] if not p.get("resolved")]
            result["priority"] = "Revisar" if "Revisar" in active else min(active, key=PRIORITIES.index) if active else "Informativo"
            if pending_id == "__conversation__":
                result["priority"] = "Informativo" if resolved else priority
                result["conversation_correction"] = correction
            db.execute("UPDATE conversations SET result=?,version=version+1,approved_hash=NULL,approved_context=NULL,status=CASE WHEN external=1 THEN 'approval_required' ELSE 'collecting' END WHERE id=?",
                       (json.dumps(result, ensure_ascii=False), cid))

    def delete(self, cid):
        with self.db() as db:
            db.execute("INSERT OR IGNORE INTO excluded_conversations VALUES(?)", (digest(cid),))
            db.execute("DELETE FROM conversations WHERE id=?", (cid,))

    def excluded(self, cid):
        with self.db() as db:
            return bool(db.execute("SELECT 1 FROM excluded_conversations WHERE id=?", (digest(cid),)).fetchone())

    def prune(self):
        cutoff = (datetime.now(timezone.utc) - timedelta(days=self.rules()["retention_days"])).isoformat()
        for row in self.list():
            if any(not p.get("resolved") for p in (row["result"] or {}).get("pending", [])):
                continue  # Open commitments pin the full observed context, including later replies.
            _, _, corrections = self.get(row["id"])
            pinned = {mid for c in corrections for mid in c["evidence_ids"]}
            with self.db() as db:
                ids = [r[0] for r in db.execute("SELECT id FROM messages WHERE conversation_id=? AND first_seen<?", (row["id"], cutoff)) if r[0] not in pinned]
                if ids:
                    db.executemany("DELETE FROM messages WHERE conversation_id=? AND id=?", [(row["id"], mid) for mid in ids])
                    db.execute("UPDATE conversations SET version=version+1,approved_hash=NULL,approved_context=NULL,status=CASE WHEN external=1 AND collect=1 THEN 'approval_required' ELSE status END WHERE id=?", (row["id"],))
