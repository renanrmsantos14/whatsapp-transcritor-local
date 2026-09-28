"""Live Jev acceptance run, exclusively over synthetic conversations."""
import argparse
import asyncio
import json
import sys
import tempfile
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from server.assistant_jev import JevEvaluator, build_context, evaluate, provider_key
from server.assistant_samples import samples, holdout_samples
from server.assistant_store import AssistantStore


async def main(output, only=None):
    at = datetime.now(ZoneInfo("America/Sao_Paulo"))
    gate = asyncio.Semaphore(2)
    with tempfile.TemporaryDirectory(prefix="whatsapp-assistant-synthetic-") as directory:
        store = AssistantStore(Path(directory) / "synthetic.db")
        store.set_rules({**store.rules(), "user_name": "Renan"})
        async def check(sample):
            store.consent(sample["id"], sample["name"], True, True)
            store.ingest(sample["id"], sample["messages"])
            context = build_context(store, sample["id"])
            row = context["row"]
            store.approve(sample["id"], row["version"], row["generation"], context["hash"])
            try:
                async with gate:
                    result = await evaluate(context, JevEvaluator(), lambda: store.is_current(sample["id"], row["version"], row["generation"], context["hash"]), at=at)
                expected = sample["expected"]
                issues = []
                if result["priority"] != expected["priority"]:
                    issues.append("priority")
                active = [p for p in result["pending"] if not p["resolved"]]
                if expected["owner"] and expected["owner"] != "Desconhecido" and not any(p["owner"] == expected["owner"] for p in active):
                    issues.append("owner")
                precision = expected["deadline_precision"]
                if precision and precision != "ambiguous" and not any(p["deadline"] and p["deadline"]["precision"] == precision for p in active):
                    issues.append("deadline")
                expected_deadline = expected.get("deadline_message_index")
                if expected_deadline is not None and not any(p["deadline"] and p["deadline"]["message_id"] == sample["messages"][expected_deadline]["id"] for p in active):
                    issues.append("deadline_source")
                if sample["id"] == "sample:waiting" and len(active) != 1:
                    issues.append("duplicate_pending")
                if sample["id"] == "sample:multiple" and len(active) != 2:
                    issues.append("multiple_pending")
                ids = {m["id"] for m in sample["messages"]}
                if any(not set(p["evidence_ids"]) <= ids for p in result["pending"]):
                    issues.append("unsupported_evidence")
                record = {"id": sample["id"], "expected": expected, "actual": result, "issues": issues, "passed": not issues}
                print(f"{sample['id']}: {result['priority']} — {'OK' if not issues else ', '.join(issues)}", flush=True)
                return record
            except Exception as error:
                # Error class is safe; exception messages may contain provider credentials/state.
                print(f"{sample['id']}: provider_error ({type(error).__name__})", flush=True)
                return {"id": sample["id"], "passed": False, "issues": ["provider_error"], "error_type": type(error).__name__}
        selected = samples(at) + holdout_samples(at)
        if only:
            selected = [sample for sample in selected if sample["id"] in only]
            if not selected:
                raise ValueError("Nenhum caso sintético corresponde ao filtro.")
        records = await asyncio.gather(*(check(sample) for sample in selected))
    report = {"synthetic_only": True, "evaluated_at": at.isoformat(), "cases": records,
              "passed": sum(c["passed"] for c in records), "total": len(records),
              "development": {"passed": sum(c["passed"] for c in records if c["id"].startswith("sample:")), "total": sum(c["id"].startswith("sample:") for c in records)},
              "holdout": {"passed": sum(c["passed"] for c in records if c["id"].startswith("holdout:")), "total": sum(c["id"].startswith("holdout:") for c in records)},
              "missed_urgency": [c["id"] for c in records if c.get("expected", {}).get("priority") == "Ver agora" and c.get("actual", {}).get("priority") != "Ver agora"],
              "unnecessary_pending": [c["id"] for c in records if c.get("expected", {}).get("priority") == "Informativo" and c.get("actual", {}).get("priority") != "Informativo"]}
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    print(f"{report['passed']}/{report['total']} casos aprovados. Relatório: {output}")
    return 0 if report["passed"] == report["total"] else 1


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--live", action="store_true", help="Autoriza enviar somente exemplos sintéticos ao Jev externo.")
    parser.add_argument("--output", type=Path, default=Path("outputs/assistant-validation.json"))
    parser.add_argument("--only", action="append", help="Repetir somente o ID sintético indicado (pode repetir a opção).")
    args = parser.parse_args()
    if not args.live:
        parser.error("Use --live para a avaliação externa sintética; testes offline: python -m pytest -q tests/test_assistant.py")
    if not provider_key():
        parser.error("Configure TYPESAFE_API_KEY ou server/.assistant-key; nunca envie sua chave pelo chat.")
    raise SystemExit(asyncio.run(main(args.output, args.only)))
