"""Run a scripted financial audit without a browser, network or model."""

import argparse
import json

from backend.app.env import FinAuditEnv
from backend.app.generator import generate
from backend.app.policies import OraclePolicy, PUBLIC_POLICIES, run_policy
from backend.artifacts import IsolatedPolicy, SCENARIOS


def _print_step(transition):
    action = transition["action"]
    observation = transition["observation"]
    details = action.get("table") or action.get("doc_id") or ""
    if action["action"] == "submit":
        details = f"{len(action['findings'])} findings"
    elif "records" in observation:
        details += f" · {len(observation['records'])} records"
    elif observation.get("error"):
        details += f" · {observation['error']}"
    print(f"{transition['step']:02d}. {action['action']} {details} · {observation['steps_remaining']} steps left")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--scenario", default="duplicate_invoice", choices=tuple(dict.fromkeys(SCENARIOS)))
    parser.add_argument("--policy", default="reconciliation", choices=(*PUBLIC_POLICIES, "oracle", "all"))
    parser.add_argument("--quiet", action="store_true", help="Print final metrics only.")
    arguments = parser.parse_args()
    config = {"scenario": arguments.scenario}
    policies = (*PUBLIC_POLICIES, "oracle") if arguments.policy == "all" else (arguments.policy,)
    for name in policies:
        env = FinAuditEnv(training=False)
        observation, _ = env.reset(arguments.seed, config)
        print(f"\n{env.episode_id} · {arguments.scenario} · {name}")
        if name == "oracle":
            policy = OraclePolicy(generate(arguments.seed, config)["truth"])
            metrics = run_policy(env, policy, observation, on_step=None if arguments.quiet else _print_step)
        else:
            with IsolatedPolicy(name) as policy:
                metrics = run_policy(env, policy, observation, on_step=None if arguments.quiet else _print_step)
        print(json.dumps(metrics, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
