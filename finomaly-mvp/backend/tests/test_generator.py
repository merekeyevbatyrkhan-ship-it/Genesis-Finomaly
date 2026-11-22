import csv
import json
import unittest
from collections import defaultdict
from decimal import ROUND_HALF_EVEN, Decimal
from pathlib import Path
from tempfile import TemporaryDirectory

from backend.app.generator import CURRENCY_DIGITS, SCENARIOS, export_episode, generate


class SyntheticGeneratorTests(unittest.TestCase):
    def assert_balanced(self, ledger):
        transactions = defaultdict(int)
        for row in ledger:
            self.assertEqual(row["amount_minor"], row["debit_minor"] + row["credit_minor"])
            self.assertEqual(row["debit_minor"] * row["credit_minor"], 0)
            transactions[row["transaction_id"]] += row["debit_minor"] - row["credit_minor"]
        self.assertTrue(all(amount == 0 for amount in transactions.values()))

    def test_replay_and_causal_history(self):
        for scenario, error_types in SCENARIOS.items():
            with self.subTest(scenario=scenario):
                config = {"scenario": scenario, "base_currency": "JPY", "timezone": "+05:30"}
                episode = generate(321, config)
                self.assertEqual(episode, generate(321, config))
                self.assertNotEqual(episode["manifest"], generate(322, config)["manifest"])
                self.assertCountEqual((item["type"] for item in episode["truth"]), error_types)
                self.assert_balanced(episode["ledger"])
                clean = episode["provenance"]["clean_ledger"]
                self.assert_balanced(clean)
                projected = {row["row_id"]: row for row in clean}
                for change in episode["provenance"]["changes"]:
                    for row in change["before"]:
                        self.assertEqual(projected[row["row_id"]], row)
                    projected.update((row["row_id"], row) for row in change["after"])
                self.assertEqual(projected, {row["row_id"]: row for row in episode["ledger"]})

    def test_evidence_independently_explains_reported_amounts(self):
        for scenario in ("allocation_fx", "duplicate_cutoff"):
            with self.subTest(scenario=scenario):
                episode = generate(52, {"scenario": scenario, "base_currency": "EUR"})
                records = {row["row_id"]: row for row in episode["ledger"]}
                records.update((doc["doc_id"], doc) for doc in episode["invoices"] + episode["payments"])
                records.update((fx["rate_id"], fx) for fx in episode["fx"])
                by_kind = {issue["type"]: issue for issue in episode["truth"]}
                for kind, issue in by_kind.items():
                    evidence = [records[key] for key in issue["acceptable_evidence_sets"][0]]
                    self.assertTrue(all(key in records for key in issue["affected_ids"]))
                    if kind == "fx_rate":
                        payment, cash, quote = evidence
                        digits = CURRENCY_DIGITS[issue["currency"]] - CURRENCY_DIGITS[payment["currency"]]
                        correct = Decimal(payment["amount_minor"]).scaleb(digits) * Decimal(quote["rate"])
                        actual = abs(cash["debit_minor"] - int(correct.to_integral_value(rounding=ROUND_HALF_EVEN)))
                    elif kind == "partial_allocation":
                        payment, invoice, cash, suspense = evidence
                        self.assertIn(invoice["invoice_id"], payment["invoice_refs"])
                        self.assertEqual(cash["transaction_id"], suspense["transaction_id"])
                        self.assertEqual(suspense["account"], "suspense")
                        actual = suspense["credit_minor"]
                    elif kind == "period_cutoff":
                        invoice, row = evidence
                        self.assertLess(invoice["service_date"], row["timestamp"][:10])
                        self.assertGreater(row["timestamp"][:10], episode["manifest"]["period_end"])
                        actual = row["debit_minor"]
                    else:
                        invoice, first, second = evidence
                        self.assertEqual(first["invoice_id"], second["invoice_id"])
                        self.assertEqual(first["invoice_id"], invoice["invoice_id"])
                        self.assertNotEqual(first["transaction_id"], second["transaction_id"])
                        actual = first["debit_minor"] + second["debit_minor"] - invoice["total_minor"]
                    self.assertEqual(actual, issue["expected_amount_minor"])
                    self.assertGreater(actual, 0)
                left, right = (set(entry["affected_ids"]) for entry in by_kind.values())
                self.assertTrue(left & right)

    def test_size_and_public_exports(self):
        config = {"scenario": "allocation_fx", "issue_count": 12, "documents_count": 20, "ledger_count": 201}
        episode = generate(-17, config)
        self.assertEqual(len(episode["invoices"]) + len(episode["payments"]), 20)
        self.assertEqual(len(episode["ledger"]), 201)
        self.assertEqual(len(episode["truth"]), 12)
        with TemporaryDirectory() as root:
            public = Path(root) / "public"
            export_episode(episode, public)
            self.assertEqual(
                {path.name for path in public.iterdir()},
                {"manifest.json", "ledger.csv", "invoices.jsonl", "payments.jsonl", "policy.json", "fx.csv"},
            )
            manifest = json.loads((public / "manifest.json").read_text(encoding="utf-8"))
            self.assertNotIn("seed", manifest)
            self.assertNotIn("scenario", manifest)
            with (public / "ledger.csv").open(encoding="utf-8", newline="") as handle:
                self.assertTrue(any(row["invoice_id"] == "null" for row in csv.DictReader(handle)))
            evaluator = Path(root) / "evaluator"
            export_episode(episode, evaluator, include_private=True)
            self.assertTrue((evaluator / "private" / "truth.json").is_file())
            with self.assertRaises(ValueError):
                export_episode(episode, evaluator)
