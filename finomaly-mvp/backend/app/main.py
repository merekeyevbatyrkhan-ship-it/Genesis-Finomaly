"""HTTP adapter for the public web demonstration."""

from collections import OrderedDict
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path
from threading import Lock
from typing import Any, Literal
from uuid import uuid4

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ConfigDict, Field

from .env import FinAuditEnv
from .policies import ReconciliationPolicy

ERROR_TYPES = {
    "duplicate_invoice": ("duplicate_invoice",),
    "partial_allocation": ("partial_allocation",),
    "fx_rate": ("fx_rate",),
    "period_cutoff": ("period_cutoff",),
    "allocation_fx": ("partial_allocation", "fx_rate"),
    "duplicate_cutoff": ("duplicate_invoice", "period_cutoff"),
    "clean": (),
}
TITLES = {
    "duplicate_invoice": "Дублирование счета",
    "partial_allocation": "Частичное распределение платежа",
    "fx_rate": "Ошибка валютного курса",
    "period_cutoff": "Ошибка отчетного периода",
}
CURRENCIES = Literal["KZT", "USD", "EUR", "GBP", "CHF", "CNY", "JPY", "UZS"]


class EpisodeInput(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    company_name: str = Field(min_length=1, max_length=120)
    scenario: str
    error_types: list[str] = Field(max_length=4)
    seed: int = Field(strict=True, ge=0, le=2**32 - 1)
    base_currency: CURRENCIES
    period_start: date
    period_end: date


class StepInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    expected_step: int = Field(strict=True, ge=1, le=100)
    action: dict[str, Any] | None = None


def browser_rows(public):
    ledger = [
        {
            "id": row["row_id"],
            "date": row["timestamp"],
            "amountMinor": row.get("amount_minor", max(row["debit_minor"], row["credit_minor"])),
            "currency": row["currency"],
            "invoiceId": row.get("invoice_id") or "",
            "counterparty": row.get("counterparty") or "—",
            "description": row.get("description") or row["account"],
            "documentIds": row.get("document_ids", []),
        }
        for row in public["ledger"]
    ]
    documents = [
        {
            "id": row["doc_id"],
            "date": row["issued_at"],
            "amountMinor": row["total_minor"],
            "currency": row["currency"],
            "invoiceId": row["invoice_id"],
            "counterparty": row.get("counterparty") or "—",
            "reference": row["invoice_id"],
            "kind": "Счёт",
        }
        for row in public["invoices"]
    ]
    documents.extend(
        {
            "id": row["doc_id"],
            "date": row["timestamp"],
            "amountMinor": row["amount_minor"],
            "currency": row["currency"],
            "invoiceId": next(iter(row.get("invoice_refs") or ()), ""),
            "counterparty": row.get("counterparty") or "—",
            "reference": row["payment_id"],
            "kind": "Платёж",
        }
        for row in public["payments"]
    )
    documents.extend(
        {
            "id": row["rate_id"],
            "date": row["date"],
            "amountMinor": 0,
            "currency": row["target_currency"],
            "invoiceId": "",
            "counterparty": "Таблица курсов",
            "reference": f'{row["source_currency"]} → {row["target_currency"]}',
            "note": f'Курс {row["rate"]}',
            "kind": "Курс FX",
        }
        for row in public["fx"]
    )
    return ledger, documents


def to_trace(number, action, observation, terminated, truncated, spent_steps):
    name = action.get("action")
    name = name if isinstance(name, str) and len(name) <= 32 else "unknown"
    records = []
    rows = observation.get("records", [])
    if isinstance(observation.get("record"), dict):
        rows = [observation["record"]]
    for row in rows:
        if "row_id" in row:
            records.append({"source": "ledger", "id": row["row_id"]})
        elif row_id := row.get("doc_id") or row.get("rate_id"):
            records.append({"source": "documents", "id": row_id})
    status = "ok"
    if observation.get("error"):
        status = "error"
    if terminated:
        status = "terminated"
    if truncated:
        status = "truncated"
    detail = observation.get("error") or observation.get("result")
    if not detail:
        detail = f"Получено записей: {len(records)}."
    params = (
        {"count": len(action["findings"])} if name == "submit" and isinstance(action.get("findings"), list)
        else {key: action[key] for key in ("table", "id", "doc_id", "cursor", "limit", "expression")
              if key in action and (action[key] is None
                                    or isinstance(action[key], str) and len(action[key]) <= 160
                                    or type(action[key]) is int and abs(action[key]) < 2**53)}
    )
    return {
        "number": number,
        "action": name,
        "params": params,
        "records": records,
        "spentSteps": spent_steps,
        "stepsRemaining": observation["steps_remaining"],
        "status": status,
        "observation": str(detail),
    }


@dataclass
class BrowserRun:
    id: str
    env: FinAuditEnv
    observation: dict
    ledger: list
    documents: list
    policy: ReconciliationPolicy = field(default_factory=ReconciliationPolicy)
    trace: list = field(default_factory=list)
    mode: str | None = None
    lock: Any = field(default_factory=Lock)

    def snapshot(self):
        status = "running"
        if self.env.terminated:
            status = "completed"
        if self.env.truncated:
            status = "truncated"
        evaluation = self.env.evaluation
        result = None
        if evaluation is not None:
            findings = [
                {
                    "id": f"F-{index:02}",
                    "type": finding["type"],
                    "title": TITLES[finding["type"]],
                    "explanation": finding["explanation"],
                    "amountMinor": finding["claimed_amount_minor"],
                    "currency": finding["currency"],
                    "affectedIds": finding["affected_ids"],
                    "evidenceIds": finding["evidence_ids"],
                }
                for index, finding in enumerate(self.env.submitted_findings, 1)
                if finding["type"] in TITLES
            ]
            result = {key: evaluation[key] for key in ("precision", "recall", "f1", "reward")}
            result["findings"] = [] if self.env.truncated else findings
        return {
            "id": self.id,
            "status": status,
            "stepBudget": 100,
            "stepsRemaining": self.env.steps_remaining,
            "ledger": self.ledger,
            "documents": self.documents,
            "trace": self.trace.copy(),
            "result": result,
        }


app = FastAPI(title="FINOMALY Demo API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://127.0.0.1:5173", "http://localhost:5173"],
    allow_methods=["GET", "POST"],
    allow_headers=["Accept", "Content-Type"],
)
sessions: OrderedDict[str, BrowserRun] = OrderedDict()
sessions_lock = Lock()
MAX_SESSIONS = 64


@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.post("/api/episodes")
def create_episode(request: EpisodeInput):
    expected = ERROR_TYPES.get(request.scenario)
    if expected is None or sorted(request.error_types) != sorted(expected):
        raise HTTPException(422, "scenario and error_types must match")
    if request.period_start > request.period_end:
        raise HTTPException(422, "invalid reporting period")
    config = request.model_dump(mode="json", exclude={"seed"})
    # Browser controls can pause. The offline environment keeps its 60-second default.
    env = FinAuditEnv(training=True, time_limit=900.0)
    try:
        observation, _ = env.reset(request.seed, config)
    except ValueError:
        raise HTTPException(422, "invalid episode configuration") from None
    ledger, documents = browser_rows(env.public_data())
    run = BrowserRun(uuid4().hex, env, observation, ledger, documents)
    with sessions_lock:
        sessions[run.id] = run
        if len(sessions) > MAX_SESSIONS:
            sessions.popitem(last=False)
    return run.snapshot()


def get_run(session_id):
    with sessions_lock:
        run = sessions.get(session_id)
        if run is None:
            raise HTTPException(404, "episode session not found")
        sessions.move_to_end(session_id)
        return run


@app.get("/api/episodes/{session_id}")
def view_episode(session_id: str):
    run = get_run(session_id)
    with run.lock:
        return run.snapshot()


@app.get("/api/episodes/{session_id}/observation")
def view_observation(session_id: str):
    run = get_run(session_id)
    with run.lock:
        return {"episode_id": run.env.episode_id, "observation": run.observation}


@app.post("/api/episodes/{session_id}/step")
def episode_step(session_id: str, request: StepInput):
    run = get_run(session_id)
    with run.lock:
        if request.expected_step <= len(run.trace):
            return run.snapshot()
        if request.expected_step != len(run.trace) + 1 or run.env.terminated or run.env.truncated:
            raise HTTPException(409, "unexpected step or episode already finished")
        mode = "manual" if request.action is not None else "automatic"
        if run.mode is not None and run.mode != mode:
            raise HTTPException(409, "episode already uses another control mode")
        run.mode = mode
        action = request.action if request.action is not None else run.policy.next_action(run.observation)
        before = run.env.steps_remaining
        observation, _, terminated, truncated, _ = run.env.step(action)
        run.observation = observation
        run.trace.append(to_trace(
            request.expected_step, action, observation, terminated, truncated,
            before - run.env.steps_remaining,
        ))
        return run.snapshot()


frontend_dist = Path(__file__).resolve().parents[2] / "frontend" / "dist"
if (frontend_dist / "index.html").is_file():
    app.mount("/", StaticFiles(directory=frontend_dist, html=True), name="frontend")
