"""Scripted audit policies that interact with the environment through actions."""

from __future__ import annotations

from collections import defaultdict
from decimal import Decimal, ROUND_HALF_EVEN
import json
import random
import sys
from time import perf_counter


PUBLIC_TABLES = ("invoices", "payments", "fx", "ledger")
ISSUE_TYPES = ("duplicate_invoice", "partial_allocation", "fx_rate", "period_cutoff")
PAGE_SIZE = 50


def _submit(episode_id, findings):
    return {"action": "submit", "episode_id": episode_id, "findings": findings[:30]}


def _finding(kind, affected, evidence, amount, currency, explanation):
    return {
        "type": kind,
        "affected_ids": affected,
        "claimed_amount_minor": amount,
        "currency": currency,
        "evidence_ids": evidence,
        "explanation": explanation,
    }


def _group_by(rows, field):
    groups = defaultdict(list)
    for row in rows:
        if row.get(field) is not None:
            groups[row[field]].append(row)
    return groups


def _accrual_findings(invoices, ledger, manifest):
    accruals = _group_by(
        (row for row in ledger
         if row["entry_kind"] == "invoice_accrual" and row["account"] == "receivables"),
        "invoice_id",
    )
    for invoice in invoices:
        invoice_rows = sorted(
            accruals.get(invoice["invoice_id"], []),
            key=lambda row: (row["timestamp"], row["row_id"]),
        )
        service_date = invoice["service_date"][:10]
        for row in invoice_rows:
            posted_date = row["timestamp"][:10]
            service_in_period = manifest["period_start"] <= service_date <= manifest["period_end"]
            posted_in_period = manifest["period_start"] <= posted_date <= manifest["period_end"]
            if service_in_period != posted_in_period:
                yield _finding(
                    "period_cutoff", [row["row_id"]], [invoice["doc_id"], row["row_id"]],
                    row["debit_minor"], row["currency"],
                    f"Дата оказания услуги {service_date} и дата проводки {posted_date} относятся к разным периодам.",
                )
        exact_accruals = [
            row for row in invoice_rows
            if row["currency"] == invoice["currency"] and row["debit_minor"] == invoice["total_minor"]
        ]
        if len(exact_accruals) > 1:
            original, *duplicates = exact_accruals
            for duplicate in duplicates:
                affected = [original["row_id"], duplicate["row_id"]]
                yield _finding(
                    "duplicate_invoice", affected, [invoice["doc_id"], *affected],
                    duplicate["debit_minor"], duplicate["currency"],
                    "По одному счёту повторно начислена его полная сумма в дебет задолженности.",
                )


def _converted_amount(amount, source, target, rate, digits):
    major_amount = Decimal(amount).scaleb(-digits[source])
    converted = (major_amount * Decimal(rate)).scaleb(digits[target])
    return int(converted.to_integral_value(rounding=ROUND_HALF_EVEN))


def _payment_findings(invoices, payments, ledger, fx, manifest, rules):
    invoice_by_id = {invoice["invoice_id"]: invoice for invoice in invoices}
    entries = _group_by((row for row in ledger if row["entry_kind"] == "payment_receipt"), "payment_id")
    rates = {(row["date"], row["source_currency"], row["target_currency"]): row for row in fx}
    for payment in payments:
        if payment["kind"] != "payment":
            continue
        rows = entries.get(payment["payment_id"], [])
        cash = next((row for row in rows if row["account"] == "cash"), None)
        if cash is None:
            continue
        suspense = next(
            (row for row in rows if row["account"] == "suspense" and row["credit_minor"] > 0), None
        )
        invoice = next((invoice_by_id[ref] for ref in payment["invoice_refs"] if ref in invoice_by_id), None)
        if suspense is not None and invoice is not None:
            receivable = next((row for row in rows if row["account"] == "receivables"), None)
            evidence = [payment["doc_id"], invoice["doc_id"], cash["row_id"], suspense["row_id"]]
            if receivable is not None:
                evidence.append(receivable["row_id"])
            yield _finding(
                "partial_allocation", [payment["doc_id"]], evidence, suspense["credit_minor"], suspense["currency"],
                "Часть полученного платежа осталась на счёте нераспределённых поступлений.",
            )
        source = payment["currency"]
        target = manifest["base_currency"]
        rate = rates.get((payment["timestamp"][:10], source, target))
        if rate is not None and source != target:
            expected = _converted_amount(payment["amount_minor"], source, target, rate["rate"], rules["currency_minor_digits"])
            difference = abs(cash["debit_minor"] - expected)
            if difference:
                yield _finding(
                    "fx_rate", [payment["doc_id"]], [payment["doc_id"], cash["row_id"], rate["rate_id"]],
                    difference, target,
                    f"Пересчёт по опубликованному курсу даёт {expected} мин. ед., в проводке {cash['debit_minor']}.",
                )


class ReconciliationPolicy:
    """Inspect the public books and submit findings based on source records."""

    def __init__(self):
        self.manifest = {}
        self.rules = {}
        self.records = {table: [] for table in PUBLIC_TABLES}
        self.table_index = 0
        self.cursor = None
        self.requested_page = False
        self.checked_document = False

    def next_action(self, observation):
        if "manifest" in observation:
            self.manifest = observation["manifest"]
            self.rules = observation["policy"]
        if self.requested_page:
            self.requested_page = False
            table = PUBLIC_TABLES[self.table_index]
            self.records[table].extend(observation.get("records", []))
            self.cursor = observation.get("next_cursor")
            if self.cursor is None:
                self.table_index += 1
        remaining = observation["steps_remaining"]
        if self.table_index < len(PUBLIC_TABLES) and remaining > 1:
            self.requested_page = True
            return {
                "action": "list_records", "table": PUBLIC_TABLES[self.table_index],
                "cursor": self.cursor, "limit": PAGE_SIZE,
            }
        findings = [
            *_accrual_findings(self.records["invoices"], self.records["ledger"], self.manifest),
            *_payment_findings(
                self.records["invoices"], self.records["payments"], self.records["ledger"],
                self.records["fx"], self.manifest, self.rules,
            ),
        ]
        if not self.checked_document and findings and remaining > 1:
            self.checked_document = True
            document_id = findings[0]["evidence_ids"][0]
            return {"action": "get_document", "doc_id": document_id}
        return _submit(self.manifest["episode_id"], findings)


class RandomExplorerPolicy:
    """Use a fixed RNG to sample public records without a detection heuristic."""

    def __init__(self, seed=17, inspection_limit=8):
        self.random = random.Random(seed)
        self.inspection_limit = inspection_limit
        self.episode_id = None
        self.inspections = 0
        self.table = None

    def next_action(self, observation):
        if "manifest" in observation:
            self.episode_id = observation["manifest"]["episode_id"]
        if self.inspections >= self.inspection_limit or observation["steps_remaining"] <= 1:
            return _submit(self.episode_id, [])
        self.inspections += 1
        records = observation.get("records")
        if records and self.random.randrange(2):
            record = self.random.choice(records)
            if "doc_id" in record:
                return {"action": "get_document", "doc_id": record["doc_id"]}
            return {"action": "get_record", "table": self.table, "id": record.get("row_id") or record["rate_id"]}
        self.table = self.random.choice(PUBLIC_TABLES)
        return {
            "action": "list_records", "table": self.table, "cursor": None,
            "limit": self.random.randint(1, PAGE_SIZE),
        }


class FlagEverythingPolicy:
    """Accuse every sampled row of every issue type until the finding cap."""

    def __init__(self):
        self.episode_id = None

    def next_action(self, observation):
        if "manifest" in observation:
            self.episode_id = observation["manifest"]["episode_id"]
            return {"action": "list_records", "table": "ledger", "cursor": None, "limit": 8}
        findings = [
            _finding(
                kind, [row["row_id"]], [row["row_id"]], row["amount_minor"], row["currency"],
                "Строка помечена без независимой сверки.",
            )
            for row in observation.get("records", []) for kind in ISSUE_TYPES
        ]
        return _submit(self.episode_id, findings)


class OraclePolicy:
    """Evaluator-only upper bound. This adapter must never inspect a closed run from outside the evaluator."""

    def __init__(self, truth):
        self.truth = truth

    def next_action(self, observation):
        findings = [
            _finding(
                issue["type"], issue["affected_ids"], issue["acceptable_evidence_sets"][0],
                issue["expected_amount_minor"], issue["currency"], "Эталонная проверка оценщика.",
            )
            for issue in self.truth
        ]
        return _submit(observation["manifest"]["episode_id"], findings)


PUBLIC_POLICIES = {
    "random": RandomExplorerPolicy,
    "reconciliation": ReconciliationPolicy,
    "flag_everything": FlagEverythingPolicy,
}


def run_policy(env, policy, observation, *, on_step=None):
    """Run one initialized episode. The callback sees only the transition values."""
    started = perf_counter()
    step = 0
    while True:
        action = policy.next_action(observation)
        observation, reward, terminated, truncated, _ = env.step(action)
        step += 1
        if on_step is not None:
            on_step({
                "episode_id": env.episode_id, "step": step, "action": action,
                "observation": observation, "reward": reward,
                "terminated": terminated, "truncated": truncated,
            })
        if terminated or truncated:
            result = env.evaluation
            return {
                **result, "steps": step, "inspection_steps": env.inspection_steps,
                "time_ms": round((perf_counter() - started) * 1000, 3),
            }


def _worker(policy_name, seed=17):
    """Action/observation transport for an isolated public policy process."""
    policy = RandomExplorerPolicy(seed) if policy_name == "random" else PUBLIC_POLICIES[policy_name]()
    for line in sys.stdin:
        observation = json.loads(line)
        action = policy.next_action(observation)
        print(json.dumps(action, ensure_ascii=True, separators=(",", ":")), flush=True)


if __name__ == "__main__":
    _worker(sys.argv[1], int(sys.argv[2]) if len(sys.argv) > 2 else 17)
