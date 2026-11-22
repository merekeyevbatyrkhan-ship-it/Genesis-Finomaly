"""Deterministic synthetic companies and evaluator-only causal histories."""

from __future__ import annotations

import csv
import json
import re
from copy import deepcopy
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone, tzinfo
from decimal import ROUND_HALF_EVEN, Decimal, localcontext
from hashlib import sha256
from pathlib import Path
from random import Random
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError


SCHEMA_VERSION = "1.0"
CURRENCY_DIGITS = {"KZT": 2, "USD": 2, "EUR": 2, "GBP": 2, "CHF": 2, "CNY": 2, "JPY": 0, "UZS": 2}
SCENARIOS = {
    "clean": (),
    "duplicate_invoice": ("duplicate_invoice",),
    "partial_allocation": ("partial_allocation",),
    "fx_rate": ("fx_rate",),
    "period_cutoff": ("period_cutoff",),
    "allocation_fx": ("partial_allocation", "fx_rate"),
    "duplicate_cutoff": ("duplicate_invoice", "period_cutoff"),
}
ERROR_TYPES = frozenset(SCENARIOS["allocation_fx"] + SCENARIOS["duplicate_cutoff"])
COUPLED = {name: SCENARIOS[name] for name in ("allocation_fx", "duplicate_cutoff")}
FIXED_ZONES = {"UTC": "+00:00", "Asia/Almaty": "+05:00", "Asia/Oral": "+05:00"}
VIRTUAL_NAMES = ("Alba Virtual", "Aral Virtual", "Mira Synthetic", "Delta Fictional", "Nadir Demo")


def _integer(value: object, name: str, low: int, high: int) -> int:
    if type(value) is not int or not low <= value <= high:
        raise ValueError(f"{name} must be an integer between {low} and {high}")
    return value


def _local_date(value: object, key: str) -> date:
    if not isinstance(value, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
        raise ValueError(f"{key} must be an ISO date (YYYY-MM-DD)")
    try:
        return date.fromisoformat(value)
    except ValueError:
        raise ValueError(f"{key} must be a valid date") from None


def _timezone(label: object) -> tzinfo:
    if not isinstance(label, str):
        raise ValueError("timezone must be a UTC offset or IANA name")
    if re.fullmatch(r"[+-](?:0\d|1[0-4]):[0-5]\d", label):
        sign = -1 if label[0] == "-" else 1
        minutes = int(label[1:3]) * 60 + int(label[4:])
        if minutes <= 14 * 60:
            return timezone(timedelta(minutes=sign * minutes))
    if label and not label.startswith(("/", "\\")) and ".." not in label:
        try:
            return ZoneInfo(label)
        except (ZoneInfoNotFoundError, ValueError):
            if label in FIXED_ZONES:
                return _timezone(FIXED_ZONES[label])
    raise ValueError("timezone must be a supported IANA name or UTC offset up to 14:00")


@dataclass(frozen=True)
class Settings:
    company: str
    scenario: str
    currency: str
    start: date
    end: date
    zone_label: str
    zone: tzinfo
    documents: int
    records: int | None
    issues: tuple[str, ...]

    @classmethod
    def parse(cls, config: dict, rng: Random) -> Settings:
        if not isinstance(config, dict):
            raise ValueError("config must be an object")
        scenario = config.get("scenario", "duplicate_invoice")
        if not isinstance(scenario, str) or scenario not in SCENARIOS:
            raise ValueError("unknown scenario")
        company = config.get("company_name", f"{rng.choice(VIRTUAL_NAMES)} {rng.randrange(10, 100)}")
        if not isinstance(company, str) or not company.strip() or len(company.strip()) > 100:
            raise ValueError("company_name must be 1–100 characters")
        currency = config.get("base_currency", "KZT")
        if not isinstance(currency, str) or currency not in CURRENCY_DIGITS:
            raise ValueError("unsupported base_currency")
        start = _local_date(config.get("period_start", "2026-01-01"), "period_start")
        end = _local_date(config.get("period_end", "2026-01-31"), "period_end")
        if end < start or end > date.max - timedelta(days=31):
            raise ValueError("period_end must follow period_start and allow posting dates")
        zone_label = config.get("timezone", rng.choice(("+05:00", "+03:00", "-05:00", "+00:00")))
        zone = _timezone(zone_label)
        documents = _integer(
            config.get("documents_count", config.get("document_count", 60)), "documents_count", 20, 200
        )
        records = config.get("ledger_count", config.get("records_count"))
        if records is not None:
            records = _integer(records, "ledger_count", 200, 2000)
        types = config.get("error_types", SCENARIOS[scenario])
        if not isinstance(types, (list, tuple)) or any(
            not isinstance(item, str) or item not in ERROR_TYPES for item in types
        ):
            raise ValueError("error_types must contain supported error names")
        count = _integer(config.get("issue_count", config.get("error_count", len(types))), "issue_count", 0, 12)
        if count and not types:
            raise ValueError("nonzero issue_count needs at least one error type")
        issues = tuple(types[index % len(types)] for index in range(count))
        return cls(company.strip(), scenario, currency, start, end, zone_label, zone, documents, records, issues)


class Company:
    def __init__(self, rng: Random, settings: Settings):
        self.rng = rng
        self.settings = settings
        self.ledger: list[dict] = []
        self.invoices: list[dict] = []
        self.payments: list[dict] = []
        self.fx: dict[tuple[date, str], dict] = {}
        self.truth: list[dict] = []
        self.changes: list[dict] = []
        self.ids: set[str] = set()
        self.entities = [(self.new_id("E"), f"{name} {rng.randrange(10, 100)}") for name in VIRTUAL_NAMES]

    def new_id(self, prefix: str) -> str:
        while True:
            value = f"{prefix}-{self.rng.getrandbits(40):010X}"
            if value not in self.ids:
                self.ids.add(value)
                return value

    def day(self) -> date:
        duration = (self.settings.end - self.settings.start).days
        return self.settings.start + timedelta(days=self.rng.randint(0, duration))

    def stamp(self, day: date) -> str:
        return datetime.combine(day, time(12), self.settings.zone).isoformat()

    def row(
        self, tx: str, day: date, entry_kind: str, account: str, amount: int, *, debit: bool,
        party: tuple[str, str], invoice_id: str | None = None, payment_id: str | None = None,
        documents: tuple[str, ...] = (),
    ) -> dict:
        titles = {
            "invoice_accrual": "Начисление по счёту",
            "payment_receipt": "Поступление и распределение платежа",
            "refund": "Возврат переплаты",
            "operating_expense": "Операционный расход",
            "opening_balance": "Входящий остаток",
        }
        record = {
            "row_id": self.new_id("L"), "transaction_id": tx, "timestamp": self.stamp(day),
            "account": account, "entry_kind": entry_kind,
            "debit_minor": amount if debit else 0, "credit_minor": 0 if debit else amount,
            "currency": self.settings.currency, "entity_id": party[0], "counterparty": party[1],
            "invoice_id": invoice_id, "payment_id": payment_id,
            "amount_minor": amount, "description": titles[entry_kind], "document_ids": list(documents),
        }
        self.ledger.append(record)
        return record

    def accrual(self, invoice: dict, day: date) -> tuple[dict, dict]:
        tx = self.new_id("T")
        common = {
            "party": (invoice["entity_id"], invoice["counterparty"]),
            "invoice_id": invoice["invoice_id"], "documents": (invoice["doc_id"],),
        }
        amount = invoice["total_minor"]
        receivable = self.row(tx, day, "invoice_accrual", "receivables", amount, debit=True, **common)
        revenue = self.row(tx, day, "invoice_accrual", "revenue", amount, debit=False, **common)
        return receivable, revenue

    def invoice(self, total: int, day: date, party: tuple[str, str] | None = None) -> tuple[dict, tuple[dict, dict]]:
        entity_id, counterparty = party if party is not None else self.rng.choice(self.entities)
        first_line = total // 2
        invoice = {
            "doc_id": self.new_id("DOC"), "invoice_id": self.new_id("I"),
            "entity_id": entity_id, "counterparty": counterparty,
            "issued_at": self.stamp(day), "due_at": self.stamp(day + timedelta(days=30)),
            "service_date": day.isoformat(), "currency": self.settings.currency, "total_minor": total,
            "line_items": [
                {"description": "Синтетическая услуга A", "quantity": 1, "unit_minor": first_line, "total_minor": first_line},
                {"description": "Синтетическая услуга B", "quantity": 1, "unit_minor": total - first_line, "total_minor": total - first_line},
            ],
        }
        self.invoices.append(invoice)
        return invoice, self.accrual(invoice, day)

    def rate(self, day: date, source: str) -> dict:
        key = (day, source)
        if key not in self.fx:
            major, fraction = divmod(self.rng.randrange(2_500, 30_000), 10_000)
            self.fx[key] = {
                "rate_id": self.new_id("FX"), "date": day.isoformat(),
                "source_currency": source, "target_currency": self.settings.currency,
                "rate": f"{major}.{fraction:04d}",
            }
        return self.fx[key]

    def convert(self, amount: int, source: str, rate: str) -> int:
        with localcontext() as context:
            context.prec = 32
            digits = CURRENCY_DIGITS[self.settings.currency] - CURRENCY_DIGITS[source]
            major_to_minor = Decimal(amount).scaleb(digits)
            return int((major_to_minor * Decimal(rate)).to_integral_value(rounding=ROUND_HALF_EVEN))

    def payment(
        self, invoice: dict, day: date, amount: int, currency: str, base_amount: int, *,
        overpayment: int = 0, refund: bool = False,
    ) -> tuple[dict, dict, dict | None]:
        payment = {
            "doc_id": self.new_id("DOC"), "payment_id": self.new_id("P"),
            "timestamp": self.stamp(day), "currency": currency, "amount_minor": amount,
            "invoice_refs": [invoice["invoice_id"]], "entity_id": invoice["entity_id"],
            "counterparty": invoice["counterparty"], "kind": "refund" if refund else "payment",
        }
        self.payments.append(payment)
        tx = self.new_id("T")
        common = {
            "party": (invoice["entity_id"], invoice["counterparty"]),
            "invoice_id": invoice["invoice_id"], "payment_id": payment["payment_id"],
            "documents": (invoice["doc_id"], payment["doc_id"]),
        }
        if refund:
            cash = self.row(tx, day, "refund", "cash", base_amount, debit=False, **common)
            self.row(tx, day, "refund", "settlement", base_amount, debit=True, **common)
            return payment, cash, None
        cash = self.row(tx, day, "payment_receipt", "cash", base_amount, debit=True, **common)
        receivable = self.row(tx, day, "payment_receipt", "receivables", base_amount - overpayment, debit=False, **common)
        if overpayment:
            self.row(tx, day, "payment_receipt", "settlement", overpayment, debit=False, **common)
        return payment, cash, receivable

    def note_issue(
        self, kind: str, affected: list[str], amount: int, evidence: list[str],
        before: list[dict], after: list[dict], reason: str,
    ) -> None:
        issue_id = self.new_id("Q")
        self.truth.append({
            "issue_id": issue_id, "type": kind, "affected_ids": affected, "expected_amount_minor": amount,
            "currency": self.settings.currency, "acceptable_evidence_sets": [evidence],
            "amount_tolerance_minor": 0,
        })
        self.changes.append({
            "issue_id": issue_id, "type": kind, "reason": reason,
            "before": deepcopy(before), "after": deepcopy(after),
        })

    def close_cutoff(self, invoice: dict, rows: tuple[dict, dict]) -> None:
        before = deepcopy(rows)
        for row in rows:
            row["timestamp"] = self.stamp(self.settings.end + timedelta(days=1))
        self.note_issue(
            "period_cutoff", [rows[0]["row_id"]], rows[0]["amount_minor"],
            [invoice["doc_id"], rows[0]["row_id"]], list(before), list(rows), "posted_after_service_period",
        )

    def change_payment(
        self, kinds: tuple[str, ...], links: tuple[dict, dict, dict, dict, dict | None],
    ) -> None:
        invoice, payment, cash, receivable, rate = links
        if "fx_rate" in kinds:
            if rate is None:
                raise ValueError("foreign payment needs an FX quote")
            before = deepcopy([cash, receivable])
            expected = cash["debit_minor"]
            with localcontext() as context:
                context.prec = 32
                factor = self.rng.choice(("0.83", "0.91", "1.12", "1.21"))
                wrong_rate = format(Decimal(rate["rate"]) * Decimal(factor), ".8f")
            booked = self.convert(payment["amount_minor"], payment["currency"], wrong_rate)
            cash["debit_minor"] = cash["amount_minor"] = booked
            receivable["credit_minor"] = receivable["amount_minor"] = booked
            self.note_issue(
                "fx_rate", [payment["doc_id"]], abs(booked - expected),
                [payment["doc_id"], cash["row_id"], rate["rate_id"]],
                before, [cash, receivable], "payment_posted_using_an_incorrect_rate",
            )
        if "partial_allocation" in kinds:
            before = deepcopy([cash, receivable])
            amount = max(1, receivable["credit_minor"] // 4)
            receivable["credit_minor"] -= amount
            receivable["amount_minor"] = receivable["credit_minor"]
            suspense = self.row(
                cash["transaction_id"], date.fromisoformat(payment["timestamp"][:10]),
                "payment_receipt", "suspense", amount, debit=False,
                party=(cash["entity_id"], cash["counterparty"]), invoice_id=cash["invoice_id"],
                payment_id=cash["payment_id"], documents=tuple(cash["document_ids"]),
            )
            self.note_issue(
                "partial_allocation", [payment["doc_id"]], amount,
                [payment["doc_id"], invoice["doc_id"], cash["row_id"], suspense["row_id"]],
                before, [cash, receivable, suspense], "part_of_an_invoice_payment_left_in_suspense",
            )

    def add_expenses(self, size: int) -> None:
        missing = size - len(self.ledger)
        if missing < 0:
            raise ValueError("ledger_count is too small for this documents_count and issue_count")
        if missing % 2:
            original = next(row for row in self.ledger if row["account"] == "revenue")
            split_minor = original["credit_minor"] // 3
            original["credit_minor"] -= split_minor
            original["amount_minor"] = original["credit_minor"]
            self.ledger.append({
                **original, "row_id": self.new_id("L"), "credit_minor": split_minor, "amount_minor": split_minor,
            })
            missing -= 1
        for _ in range(missing // 2):
            day = self.day()
            amount = self.rng.randrange(350, 250_000)
            tx = self.new_id("T")
            party = self.rng.choice(self.entities)
            self.row(tx, day, "operating_expense", "opex", amount, debit=True, party=party)
            self.row(tx, day, "operating_expense", "cash", amount, debit=False, party=party)

    def opening_balance(self) -> None:
        day = self.settings.start
        tx = self.new_id("T")
        party = (self.new_id("E"), self.settings.company)
        amount = self.rng.randrange(250_000_000, 400_000_000)
        cash = self.row(tx, day, "opening_balance", "cash", amount, debit=True, party=party)
        equity = self.row(tx, day, "opening_balance", "equity", amount, debit=False, party=party)
        opening = datetime.combine(day, time(0), self.settings.zone).isoformat()
        cash["timestamp"] = equity["timestamp"] = opening

    def clean_distractors(self) -> None:
        day = self.day()
        amount = self.rng.randrange(85_000, 420_000)
        party = self.rng.choice(self.entities)
        split, _ = self.invoice(amount, day, party)
        same_total, _ = self.invoice(amount, day, party)
        currency = self.settings.currency
        first = amount // 3
        self.payment(split, day, first, currency, first)
        self.payment(split, day, amount - first, currency, amount - first)
        extra = amount // 20
        self.payment(same_total, day, amount + extra, currency, amount + extra, overpayment=extra)
        self.payment(same_total, day, extra, currency, extra, refund=True)

    def invoices_and_payments(self) -> None:
        currency = self.settings.currency
        foreign_currencies = [code for code in CURRENCY_DIGITS if code != currency]
        doc_count = len(self.invoices) + len(self.payments)
        while doc_count < self.settings.documents:
            day = self.day()
            add_payment = doc_count + 2 <= self.settings.documents and self.rng.random() < 0.60
            foreign = add_payment and self.rng.random() < 0.45
            source = self.rng.choice(foreign_currencies) if foreign else currency
            amount = self.rng.randrange(85_000, 420_000)
            if foreign:
                quote = self.rate(day, source)
                total = self.convert(amount, source, quote["rate"])
            else:
                total = amount
            invoice, _ = self.invoice(total, day)
            if add_payment:
                self.payment(invoice, day, amount, source, total)
            doc_count += 1 + add_payment

    def issue_history(self) -> tuple[list, list]:
        settings = self.settings
        issue_types = list(settings.issues)
        groups: list[tuple[str, ...]] = []
        pair = COUPLED.get(settings.scenario)
        while pair and all(kind in issue_types for kind in pair):
            groups.append(pair)
            for kind in pair:
                issue_types.remove(kind)
        groups.extend((kind,) for kind in issue_types)

        invoice_changes = []
        payment_changes = []
        foreign = [code for code in CURRENCY_DIGITS if code != settings.currency]
        plans = []
        pay_day = self.day()
        for kinds in groups:
            if kinds[0] in ("duplicate_invoice", "period_cutoff"):
                day = settings.end if "period_cutoff" in kinds else self.day()
                invoice, base_rows = self.invoice(self.rng.randrange(90_000, 420_000), day)
                invoice_changes.append((kinds, invoice, base_rows, day))
            else:
                fx_source = self.rng.choice(foreign) if "fx_rate" in kinds else settings.currency
                amount = self.rng.randrange(85_000, 420_000)
                rate = self.rate(pay_day, fx_source) if fx_source != settings.currency else None
                base = self.convert(amount, fx_source, rate["rate"]) if rate else amount
                plans.append((kinds, fx_source, amount, rate, base))
        if plans:
            total = sum(plan[4] for plan in plans)
            invoice, _ = self.invoice(total, pay_day)
            for kinds, source, amount, rate, base in plans:
                payment, cash, receivable = self.payment(invoice, pay_day, amount, source, base)
                assert receivable is not None
                payment_changes.append((kinds, (invoice, payment, cash, receivable, rate)))
        return invoice_changes, payment_changes

    def materialize(self, seed: int) -> dict:
        self.opening_balance()
        self.clean_distractors()
        invoice_changes, payment_changes = self.issue_history()
        self.invoices_and_payments()
        reserved = self.settings.issues.count("duplicate_invoice") * 2 + self.settings.issues.count("partial_allocation")
        record_count = self.settings.records or max(260, len(self.ledger) + reserved + 12)
        self.add_expenses(record_count - reserved)
        clean_ledger = deepcopy(self.ledger)
        for kinds, invoice, rows, day in invoice_changes:
            if "duplicate_invoice" in kinds:
                duplicate = self.accrual(invoice, day)
                self.note_issue(
                    "duplicate_invoice", [rows[0]["row_id"], duplicate[0]["row_id"]], invoice["total_minor"],
                    [invoice["doc_id"], rows[0]["row_id"], duplicate[0]["row_id"]],
                    [], list(duplicate), "one_invoice_accrued_twice",
                )
                rows = duplicate
            if "period_cutoff" in kinds:
                self.close_cutoff(invoice, rows)
        for kinds, links in payment_changes:
            self.change_payment(kinds, links)

        rates = list(self.fx.values())
        if not rates:
            foreign = next(code for code in CURRENCY_DIGITS if code != self.settings.currency)
            rates.append(self.rate(self.settings.start, foreign))
        for records in (self.ledger, self.invoices, self.payments, rates):
            self.rng.shuffle(records)
        identity = (self.settings.company, self.ledger, self.invoices, self.payments, rates)
        digest = sha256(json.dumps(identity, ensure_ascii=False).encode("utf-8")).hexdigest()[:20]
        manifest = {
            "schema_version": SCHEMA_VERSION, "episode_id": f"FIN-{digest.upper()}",
            "company_name": self.settings.company, "base_currency": self.settings.currency,
            "period_start": self.settings.start.isoformat(), "period_end": self.settings.end.isoformat(),
            "timezone": self.settings.zone_label, "ledger_count": len(self.ledger),
            "documents_count": len(self.invoices) + len(self.payments),
            "currency_minor_digits": dict(CURRENCY_DIGITS), "rounding": ROUND_HALF_EVEN,
        }
        policy = {
            "rounding": ROUND_HALF_EVEN, "currency_minor_digits": dict(CURRENCY_DIGITS),
            "fx_date": "local calendar date of the payment timestamp",
            "fx_rate": "base currency major units per source currency major unit",
            "reporting_period": "inclusive local period_start through period_end",
            "accrual_date": "local service_date in the invoice",
            "invoice_allocation": "a receipt referencing an invoice is allocated in full, up to the amount due",
            "unapplied_invoice_receipt": "suspense credit in booked base minor units",
            "overpayment": "credit to settlement is valid and reversed by a refund",
            "affected_ids": {
                "duplicate_invoice": "receivables debit row IDs of both accruals",
                "partial_allocation": "payment document ID",
                "fx_rate": "payment document ID",
                "period_cutoff": "receivables debit row ID of the mistimed accrual",
            },
        }
        provenance = {
            "seed": seed, "schema_version": SCHEMA_VERSION, "scenario": self.settings.scenario,
            "issues_requested": list(self.settings.issues), "clean_ledger": clean_ledger, "changes": self.changes,
        }
        return {
            "manifest": manifest, "ledger": self.ledger, "invoices": self.invoices, "payments": self.payments,
            "fx": rates, "policy": policy, "truth": self.truth, "provenance": provenance,
        }


def generate(seed: int, config: dict) -> dict:
    """Generate public data and an evaluator-only truth/change log."""
    if type(seed) is not int or not -(2**127) <= seed < 2**127:
        raise ValueError("seed must be a signed integer of at most 128 bits")
    rng = Random(seed & (2**128 - 1))
    settings = Settings.parse(config, rng)
    return Company(rng, settings).materialize(seed)


def _write_json(path: Path, data: object) -> None:
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")


def export_episode(episode: dict, directory: Path, *, include_private: bool = False) -> None:
    """Save the case's public file formats and optionally its isolated evaluator files."""
    directory = Path(directory)
    private = directory / "private"
    if not include_private and any((directory / name).exists() for name in ("private", "truth.json", "provenance.json")):
        raise ValueError("public export needs a directory without evaluator files")
    directory.mkdir(parents=True, exist_ok=True)
    _write_json(directory / "manifest.json", episode["manifest"])
    _write_json(directory / "policy.json", episode["policy"])
    for table in ("ledger", "fx"):
        records = episode[table]
        with (directory / f"{table}.csv").open("w", encoding="utf-8", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=list(records[0]), lineterminator="\n")
            writer.writeheader()
            for record in records:
                writer.writerow({
                    name: json.dumps(value, ensure_ascii=False) if value is None or isinstance(value, list) else value
                    for name, value in record.items()
                })
    for table in ("invoices", "payments"):
        rows = (json.dumps(record, ensure_ascii=False) for record in episode[table])
        (directory / f"{table}.jsonl").write_text("\n".join(rows) + "\n", encoding="utf-8", newline="\n")
    if include_private:
        private.mkdir(exist_ok=True)
        _write_json(private / "truth.json", episode["truth"])
        _write_json(private / "provenance.json", episode["provenance"])
