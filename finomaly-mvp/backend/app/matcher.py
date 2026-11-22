"""Canonical finding validation, one-to-one matching and terminal reward."""

import re


MAX_FINDINGS = 30
MAX_EVIDENCE_IDS = 10
MAX_AFFECTED_IDS = 30
MAX_EXPLANATION = 1000
MAX_ID_LENGTH = 128
MAX_AMOUNT = (1 << 53) - 1
CURRENCY_PATTERN = re.compile(r"[A-Z]{3}\Z")
ISSUE_TYPES = frozenset({"duplicate_invoice", "partial_allocation", "fx_rate", "period_cutoff"})
FINDING_FIELDS = {
    "type", "affected_ids", "claimed_amount_minor", "currency", "evidence_ids", "explanation",
}


def _ids(value, maximum):
    if not isinstance(value, list) or len(value) > maximum:
        raise ValueError("invalid identifiers")
    if not all(isinstance(item, str) and len(item) <= MAX_ID_LENGTH and item.strip() for item in value):
        raise ValueError("invalid identifier")
    return sorted({item.strip() for item in value})


def validate_submission(action, episode_id):
    """Validate the published schema and return a fresh canonical list."""
    if set(action) != {"action", "episode_id", "findings"} or action["episode_id"] != episode_id:
        raise ValueError("invalid submission")
    findings = action["findings"]
    if not isinstance(findings, list) or len(findings) > MAX_FINDINGS:
        raise ValueError("invalid findings")
    canonical = []
    for finding in findings:
        if not isinstance(finding, dict) or set(finding) != FINDING_FIELDS:
            raise ValueError("invalid finding")
        kind = finding["type"]
        currency = finding["currency"]
        amount = finding["claimed_amount_minor"]
        explanation = finding["explanation"]
        if not isinstance(kind, str) or kind.strip().lower() not in ISSUE_TYPES:
            raise ValueError("invalid issue type")
        if not isinstance(currency, str) or not CURRENCY_PATTERN.fullmatch(currency.strip().upper()):
            raise ValueError("invalid currency")
        if type(amount) is not int or not -MAX_AMOUNT <= amount <= MAX_AMOUNT:
            raise ValueError("invalid amount")
        if not isinstance(explanation, str) or len(explanation) > MAX_EXPLANATION:
            raise ValueError("invalid explanation")
        canonical.append({
            "type": kind.strip().lower(),
            "affected_ids": _ids(finding["affected_ids"], MAX_AFFECTED_IDS),
            "claimed_amount_minor": amount,
            "currency": currency.strip().upper(),
            "evidence_ids": _ids(finding["evidence_ids"], MAX_EVIDENCE_IDS),
            "explanation": explanation,
        })
    return canonical


def _qualifies(finding, issue):
    if finding["type"] != issue["type"] or finding["currency"] != issue["currency"]:
        return False
    if set(finding["affected_ids"]) != set(issue["affected_ids"]):
        return False
    difference = abs(finding["claimed_amount_minor"] - issue["expected_amount_minor"])
    if difference > issue.get("amount_tolerance_minor", 0):
        return False
    evidence = set(finding["evidence_ids"])
    return any(required and evidence.issuperset(required) for required in issue["acceptable_evidence_sets"])


def _matches(findings, truth):
    """Find maximum cardinality so ambiguous claims do not depend on a greedy choice."""
    ordered_truth = sorted(truth, key=lambda issue: issue["issue_id"])
    matches = {}
    candidates = [
        [index for index, issue in enumerate(ordered_truth) if _qualifies(finding, issue)]
        for finding in findings
    ]

    def assign(finding_index, visited):
        for issue_index in candidates[finding_index]:
            if issue_index in visited:
                continue
            visited.add(issue_index)
            if issue_index not in matches or assign(matches[issue_index], visited):
                matches[issue_index] = finding_index
                return True
        return False

    for finding_index in range(len(findings)):
        assign(finding_index, set())
    return matches


def evaluate(findings, truth, inspection_steps=0, *, invalid=False):
    """Score canonical findings. All money tolerances are in integer minor units."""
    tp = len(_matches(findings, truth))
    fp = len(findings) - tp
    fn = len(truth) - tp
    precision = tp / len(findings) if findings else 0.0
    recall = tp / len(truth) if truth else 0.0
    denominator = 2 * tp + fp + fn
    f1 = 2 * tp / denominator if denominator else 1.0
    reward = max(-1.0, min(1.0, 2 * f1 - 1 - 0.002 * inspection_steps))
    return {
        "precision": precision,
        "recall": recall,
        "f1": f1,
        "reward": -1.0 if invalid else reward,
        "tp": tp,
        "fp": fp,
        "fn": fn,
    }
