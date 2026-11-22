"""Contract and adversarial checks for the offline environment and evaluator."""

import unittest
from backend.app import env as env_module

from backend.app.env import FinAuditEnv
from backend.app.generator import generate
from backend.app.matcher import evaluate
from backend.app.policies import ReconciliationPolicy, run_policy


def finding(issue):
    return {
        "type": issue["type"],
        "affected_ids": issue["affected_ids"],
        "claimed_amount_minor": issue["expected_amount_minor"],
        "currency": issue["currency"],
        "evidence_ids": issue["acceptable_evidence_sets"][0],
        "explanation": "Сверены источники и записи.",
    }


def submit(env, findings):
    return env.step({"action": "submit", "episode_id": env.episode_id, "findings": findings})


class EnvironmentTests(unittest.TestCase):
    def setUp(self):
        self.env = FinAuditEnv(clock=lambda: 0)

    def reset(self, scenario="duplicate_invoice", seed=173):
        return self.env.reset(seed, {"scenario": scenario})

    def test_reproducible_and_only_public_fields(self):
        first = self.reset()
        query = {"action": "list_records", "table": "ledger", "limit": 7}
        result = self.env.step(query)
        self.assertEqual(self.reset(), first)
        self.assertEqual(self.env.step(query), result)
        self.assertEqual(self.env.steps_remaining, 99)
        self.assertEqual(first[1], {})
        forbidden = {"truth", "seed", "scenario", "error_types", "provenance"}
        self.assertFalse(forbidden.intersection(first[0]))
        self.assertFalse(forbidden.intersection(first[0]["manifest"]))
        self.assertFalse(forbidden.intersection(self.env.public_data()))

    def test_stable_pagination_and_read_only_records(self):
        self.reset()
        request = {"action": "list_records", "table": "ledger", "limit": 50}
        first, reward, terminated, truncated, info = self.env.step(request)
        self.assertEqual((reward, terminated, truncated, info), (0, False, False, {}))
        self.assertEqual(len(first["records"]), 50)
        second = self.env.step({**request, "cursor": first["next_cursor"]})[0]
        self.assertFalse({row["row_id"] for row in first["records"]}.intersection(
            row["row_id"] for row in second["records"]
        ))
        row = first["records"][0]
        row["debit_minor"] = 0
        actual = self.env.step({"action": "get_record", "table": "ledger", "id": row["row_id"]})[0]
        self.assertEqual(actual["record"], self.env.public_data()["ledger"][0])
        error = self.env.step({**request, "limit": 51})[0]
        self.assertEqual(error, {"steps_remaining": 96, "error": "invalid_limit"})

    def test_documents_and_decimal_arithmetic(self):
        self.reset()
        book = self.env.public_data()
        source = book["invoices"][0]
        action = {"action": "get_document", "doc_id": source["doc_id"]}
        self.assertEqual(self.env.step(action)[0]["record"], source)
        calc = {"action": "calculator", "expression": "(0.1 + 0.2) / 3"}
        self.assertEqual(self.env.step(calc)[0]["result"], "0.1")
        for expression in ("a + 1", "2 ** 30", "1 / 0", "9" * 161, [], None):
            self.assertEqual(self.env.step({**calc, "expression": expression})[0]["error"], "invalid_expression")

    def test_unknown_actions_and_ids_are_bounded(self):
        self.reset()
        for action, expected in (
            (None, "invalid_action"),
            ({"action": {"unexpected": True}}, "unknown_action"),
            ({"action": "get_record", "table": "truth", "id": "secret"}, "unknown_table"),
            ({"action": "get_document", "doc_id": "unknown"}, "unknown_id"),
        ):
            observation = self.env.step(action)[0]
            self.assertEqual(observation["error"], expected)
        self.assertEqual(self.env.steps_remaining, 96)

    def test_step_100_includes_submission(self):
        self.reset("clean")
        for _ in range(99):
            transition = self.env.step({})
            self.assertFalse(transition[2] or transition[3])
        observation, reward, terminated, truncated, _ = submit(self.env, [])
        self.assertEqual(observation["steps_remaining"], 0)
        self.assertEqual((terminated, truncated), (True, False))
        self.assertAlmostEqual(reward, 1 - 0.002 * 99)
        score = self.env.evaluation.copy()
        self.assertEqual(submit(self.env, [{}])[0]["error"], "episode_finished")
        self.assertEqual(self.env.evaluation, score)

    def test_step_limit_and_timeout_discard_findings(self):
        self.reset()
        for _ in range(100):
            last = self.env.step({})
        self.assertEqual(last, ({"steps_remaining": 0, "result": "truncated"}, -1, False, True, {}))
        self.assertEqual(self.env.submitted_findings, [])
        values = iter([0, 61])
        env = FinAuditEnv(clock=lambda: next(values))
        env.reset(173, {"scenario": "duplicate_invoice"})
        self.assertEqual(submit(env, [])[0], {"steps_remaining": 100, "result": "truncated"})
        self.assertTrue(env.truncated)
        self.assertEqual(env.submitted_findings, [])

    def test_malformed_submission_and_evaluation_visibility(self):
        self.reset("clean")
        self.assertEqual(submit(self.env, [{}]), (
            {"steps_remaining": 99, "error": "invalid_submission"}, -1, True, False, {},
        ))
        env = FinAuditEnv(training=False, clock=lambda: 0)
        env.reset(173, {"scenario": "clean"})
        self.assertEqual(submit(env, []), ({"steps_remaining": 99, "result": "submitted"}, 0, True, False, {}))
        self.assertEqual(env.evaluation["reward"], 1)
        self.assertEqual(env.evaluation["f1"], 1)

    def test_submission_enforces_schema_limits(self):
        issue = generate(173, {"scenario": "duplicate_invoice"})["truth"][0]
        base = finding(issue)
        for claims in (
            [base] * 31,
            [{**base, "claimed_amount_minor": True}],
            [{**base, "evidence_ids": ["a"] * 11}],
            [{**base, "explanation": "x" * 1001}],
        ):
            with self.subTest(claims=claims):
                self.reset()
                observation, reward, terminated, truncated, info = submit(self.env, claims)
                self.assertEqual(observation["error"], "invalid_submission")
                self.assertEqual((reward, terminated, truncated, info), (-1, True, False, {}))


class MatcherTests(unittest.TestCase):
    def setUp(self):
        self.truth = generate(173, {"scenario": "duplicate_invoice"})["truth"]
        self.correct = [finding(issue) for issue in self.truth]
        self.first = self.correct[0]

    def test_correct_evidence_beats_silence_and_failed_claims(self):
        self.assertEqual(evaluate(self.correct, self.truth)["reward"], 1)
        self.assertEqual(evaluate([], self.truth)["reward"], -1)
        for wrong in (
            {"affected_ids": ["guessed-id"]},
            {"evidence_ids": ["unrelated-evidence"]},
            {"currency": "JPY" if self.first["currency"] != "JPY" else "USD"},
            {"claimed_amount_minor": self.first["claimed_amount_minor"] + 10_000},
        ):
            self.assertEqual(evaluate([{**self.first, **wrong}], self.truth)["tp"], 0)

    def test_clean_cases_and_duplicate_guesses(self):
        self.assertEqual(evaluate([], [])["f1"], 1)
        self.assertEqual(evaluate([self.first], [])["reward"], -1)
        duplicate = evaluate(self.correct + [self.first], self.truth)
        self.assertEqual(duplicate["tp"], len(self.truth))
        self.assertEqual(duplicate["fp"], 1)
        guesses = self.correct + [{**self.first, "affected_ids": [f"guessed-{n}"]} for n in range(25)]
        self.assertLess(evaluate(guesses, self.truth)["reward"], 0)
        self.assertAlmostEqual(evaluate(self.correct, self.truth, 2)["reward"], 0.996)

    def test_ambiguous_match_maximizes_cardinality(self):
        base = self.truth[0]
        left = {**base, "issue_id": "A", "acceptable_evidence_sets": [["proof-left"]]}
        right = {**base, "issue_id": "B", "acceptable_evidence_sets": [["proof-right"]]}
        flexible = {**self.first, "evidence_ids": ["proof-left", "proof-right"]}
        only_left = {**self.first, "evidence_ids": ["proof-left"]}
        self.assertEqual(evaluate([flexible, only_left], [left, right])["tp"], 2)
        self.assertEqual(evaluate([only_left, flexible], [right, left])["tp"], 2)

    def test_renaming_ids_and_reordering_public_records_preserves_score(self):
        seed = 271
        settings = {"scenario": "duplicate_cutoff"}
        source = generate(seed, settings)
        tables = ("ledger", "invoices", "payments", "fx")
        fields = ("row_id", "doc_id", "invoice_id", "payment_id", "entity_id", "transaction_id", "rate_id")
        identifiers = {
            row[field]
            for table in tables for row in source[table] for field in fields
            if isinstance(row.get(field), str)
        }
        aliases = {identifier: f"renamed-{index}" for index, identifier in enumerate(sorted(identifiers), 1)}

        def rename(value):
            if isinstance(value, str):
                return aliases.get(value, value)
            if isinstance(value, list):
                return [rename(item) for item in value]
            if isinstance(value, dict):
                return {key: rename(item) for key, item in value.items()}
            return value

        transformed = rename(source)
        for table in tables:
            transformed[table].reverse()
        env = FinAuditEnv(clock=lambda: 0)
        observation, _ = env.reset(seed, settings)
        base = run_policy(env, ReconciliationPolicy(), observation)
        original_generate = env_module.generate
        try:
            env_module.generate = lambda *_: transformed
            observation, _ = env.reset(seed, settings)
            changed = run_policy(env, ReconciliationPolicy(), observation)
        finally:
            env_module.generate = original_generate
        self.assertEqual(base["f1"], 1)
        for metric in ("tp", "fp", "fn", "f1", "reward", "steps"):
            self.assertEqual(base[metric], changed[metric])


if __name__ == "__main__":
    unittest.main()
