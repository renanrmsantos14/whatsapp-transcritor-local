"""Triagem textual local, sem modelo externo ou gravação de conteúdo."""

from __future__ import annotations

import re
from datetime import date, timedelta

CATEGORIES = ("orcamento", "reserva", "duvida", "reclamacao", "follow_up", "outro")
PRIORITIES = ("low", "medium", "high", "urgent")


def _contains(text: str, *terms: str) -> bool:
    return any(term in text for term in terms)


def _due_date(text: str) -> str | None:
    today = date.today()
    if _contains(text, "hoje", "ainda hoje"):
        return today.isoformat()
    if _contains(text, "amanha", "amanhã"):
        return (today + timedelta(days=1)).isoformat()
    match = re.search(r"\b(\d{1,2})/(\d{1,2})(?:/(\d{2,4}))?\b", text)
    if not match:
        return None
    day, month = int(match.group(1)), int(match.group(2))
    year = int(match.group(3) or today.year)
    if year < 100:
        year += 2000
    try:
        return date(year, month, day).isoformat()
    except ValueError:
        return None


def classify_intake(payload: dict) -> dict:
    messages = payload.get("messages") or []
    text = " ".join(str(message.get("text") or "") for message in messages).strip()
    folded = text.casefold()
    if _contains(folded, "reclam", "problema", "pessimo", "péssimo", "erro", "insatisfeito"):
        category, priority = "reclamacao", "high"
    elif _contains(folded, "reserv", "agendar", "agenda", "transfer", "motorista"):
        category, priority = "reserva", "high"
    elif _contains(folded, "orçamento", "orcamento", "preço", "preco", "valor", "cotação", "cotacao"):
        category, priority = "orcamento", "medium"
    elif _contains(folded, "retorno", "responder", "follow", "aguardo", "pendente"):
        category, priority = "follow_up", "medium"
    elif "?" in text or _contains(folded, "como", "qual", "pode me explicar", "dúvida", "duvida"):
        category, priority = "duvida", "low"
    else:
        category, priority = "outro", "low"
    if _contains(folded, "urgente", "urgência", "urgencia", "agora", "imediato", "imediata"):
        priority = "urgent"
    elif _contains(folded, "hoje", "amanhã", "amanha") and priority == "low":
        priority = "high"
    due_date = _due_date(folded)
    return {
        "category": category,
        "priority": priority,
        "summary": text[:500] or "Conversa recebida pelo WhatsApp.",
        "nextAction": "Responder e confirmar os próximos passos.",
        "dueDate": due_date,
        "confidence": 0.62 if category != "outro" else 0.35,
    }
