"""Episode state and narrow, JSON-compatible inspection tools."""

import ast
import re
import time
from copy import deepcopy
from decimal import Context, Decimal, DecimalException, ROUND_HALF_EVEN, localcontext

from .generator import generate
from .matcher import evaluate, validate_submission


STEP_BUDGET = 100
PAGE_SIZE_CAP = 50
PRIMARY_IDS = {"ledger": "row_id", "invoices": "doc_id", "payments": "doc_id", "fx": "rate_id"}
PUBLIC_FIELDS = ("manifest", "policy", *PRIMARY_IDS)
MAX_EXPRESSION_LENGTH = 160
MAX_CALCULATOR_VALUE = Decimal("1e30")
EXPRESSION_PATTERN = re.compile(r"[0-9.()+*/ \t\-]+\Z")


def _calculate(text):
    if not isinstance(text, str) or len(text) > MAX_EXPRESSION_LENGTH:
        raise ValueError("invalid expression")
    text = text.strip()
    if not EXPRESSION_PATTERN.fullmatch(text):
        raise ValueError("invalid expression")

    def compute(node):
        if isinstance(node, ast.Constant) and type(node.value) in (int, float):
            value = Decimal(ast.get_source_segment(text, node))
        elif isinstance(node, ast.UnaryOp) and isinstance(node.op, (ast.UAdd, ast.USub)):
            operand = compute(node.operand)
            value = -operand if isinstance(node.op, ast.USub) else operand
        elif isinstance(node, ast.BinOp) and isinstance(node.op, (ast.Add, ast.Sub, ast.Mult, ast.Div)):
            left, right = compute(node.left), compute(node.right)
            if isinstance(node.op, ast.Add):
                value = left + right
            elif isinstance(node.op, ast.Sub):
                value = left - right
            elif isinstance(node.op, ast.Mult):
                value = left * right
            else:
                value = left / right
        else:
            raise ValueError("invalid arithmetic")
        if abs(value) > MAX_CALCULATOR_VALUE:
            raise ValueError("value out of range")
        return value

    with localcontext(Context(prec=38, rounding=ROUND_HALF_EVEN)):
        result = compute(ast.parse(text, mode="eval").body)
    if not result:
        return "0"
    result = format(result, "f")
    return result.rstrip("0").rstrip(".") if "." in result else result


class FinAuditEnv:
    """Owns trusted state. Expose only reset/step JSON to an untrusted policy."""

    def __init__(self, training=True, *, time_limit=60.0, clock=time.monotonic):
        self.training = training
        self._clock = clock
        self.time_limit = time_limit
        self._episode = None
        self.steps_remaining = STEP_BUDGET
        self.inspection_steps = 0
        self.terminated = False
        self.truncated = False
        self.evaluation = None
        self.submitted_findings = []

    @property
    def episode_id(self):
        return self._episode["manifest"]["episode_id"] if self._episode is not None else None

    def reset(self, seed, config=None):
        self._episode = generate(seed, {} if config is None else config)
        self.steps_remaining = STEP_BUDGET
        self.inspection_steps = 0
        self.terminated = self.truncated = False
        self.evaluation = None
        self.submitted_findings = []
        self._tables = {table: self._episode[table] for table in PRIMARY_IDS}
        self._tables["documents"] = self._tables["invoices"] + self._tables["payments"]
        documents = {row["doc_id"]: row for row in self._tables["documents"]}
        self._record_indexes = {
            table: {row[key]: row for row in self._tables[table]} for table, key in PRIMARY_IDS.items()
        }
        self._record_indexes["documents"] = documents
        for table, foreign_id in (("invoices", "invoice_id"), ("payments", "payment_id")):
            self._record_indexes[table].update({row[foreign_id]: row for row in self._tables[table]})
        self._started_at = self._clock()
        return self._observation(
            task="Inspect company records and submit substantiated audit findings.",
            manifest=deepcopy(self._episode["manifest"]),
            policy=deepcopy(self._episode["policy"]),
        ), {}

    def public_data(self):
        """A trusted viewer can display source tables without spending an agent step."""
        self._require_episode()
        return {key: deepcopy(self._episode[key]) for key in PUBLIC_FIELDS}

    def _require_episode(self):
        if self._episode is None:
            raise RuntimeError("reset required")

    def _observation(self, **values):
        return {"steps_remaining": self.steps_remaining, **values}

    def _transition(self, observation, reward=0.0):
        return observation, reward, self.terminated, self.truncated, {}

    def _time_exhausted(self):
        return self._clock() - self._started_at >= self.time_limit

    def _finish(self, *, truncated=False, invalid=False):
        self.terminated = not truncated
        self.truncated = truncated
        self.evaluation = evaluate(
            self.submitted_findings, self._episode["truth"], self.inspection_steps, invalid=invalid,
        )
        if truncated:
            observation = self._observation(result="truncated")
        elif invalid:
            observation = self._observation(error="invalid_submission")
        else:
            observation = self._observation(result="submitted")
        reward = self.evaluation["reward"] if self.training else 0.0
        return self._transition(observation, reward)

    def step(self, action):
        self._require_episode()
        if self.terminated or self.truncated:
            return self._transition(self._observation(error="episode_finished"))
        if self._time_exhausted():
            return self._finish(truncated=True)

        self.steps_remaining -= 1
        if isinstance(action, dict) and action.get("action") == "submit":
            try:
                findings = validate_submission(action, self.episode_id)
            except ValueError:
                return self._finish(invalid=True)
            self.submitted_findings = findings
            return self._finish()

        self.inspection_steps += 1
        result = self._inspect(action)
        if self.steps_remaining == 0 or self._time_exhausted():
            return self._finish(truncated=True)
        return self._transition(result)

    def _inspect(self, action):
        if not isinstance(action, dict):
            return self._observation(error="invalid_action")
        name = action.get("action")
        if name == "list_records":
            return self._list_records(action)
        if name == "get_record":
            return self._get_record(action.get("table"), action.get("id"))
        if name == "get_document":
            return self._get_record("documents", action.get("doc_id"))
        if name == "calculator":
            try:
                return self._observation(result=_calculate(action.get("expression")))
            except (DecimalException, SyntaxError, ValueError):
                return self._observation(error="invalid_expression")
        return self._observation(error="unknown_action")

    def _list_records(self, action):
        table = action.get("table")
        if not isinstance(table, str) or table not in self._tables:
            return self._observation(error="unknown_table")
        limit = action.get("limit", PAGE_SIZE_CAP)
        if type(limit) is not int or not 1 <= limit <= PAGE_SIZE_CAP:
            return self._observation(error="invalid_limit")
        cursor = action.get("cursor")
        cursor = 0 if cursor is None else cursor
        rows = self._tables[table]
        if type(cursor) is not int or not 0 <= cursor <= len(rows):
            return self._observation(error="invalid_cursor")
        end = cursor + limit
        return self._observation(records=deepcopy(rows[cursor:end]), next_cursor=end if end < len(rows) else None)

    def _get_record(self, table, record_id):
        if not isinstance(table, str) or table not in self._record_indexes:
            return self._observation(error="unknown_table")
        if not isinstance(record_id, str) or not 1 <= len(record_id) <= 128:
            return self._observation(error="invalid_id")
        record = self._record_indexes[table].get(record_id)
        return self._observation(record=deepcopy(record)) if record is not None else self._observation(error="unknown_id")
