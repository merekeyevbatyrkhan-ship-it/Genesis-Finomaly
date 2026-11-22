"""Run the offline tests and verify that the released data and trajectories replay."""

import json
from collections import Counter
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import TextTestRunner, defaultTestLoader

from backend.app.env import FinAuditEnv
from backend.app.generator import export_episode, generate

ROOT = Path(__file__).resolve().parent
FORBIDDEN_KEYS = {"truth", "provenance", "seed", "scenario", "error_types", "acceptable_evidence_sets"}


def public_only(value):
    if isinstance(value, dict):
        return FORBIDDEN_KEYS.isdisjoint(value) and all(map(public_only, value.values()))
    if isinstance(value, list):
        return all(map(public_only, value))
    return True


def check_release():
    episodes_dir = ROOT / "episodes"
    catalog = json.loads((episodes_dir / "catalog.json").read_text(encoding="utf-8"))
    if Counter(entry["split"] for entry in catalog) != {"train": 10, "dev": 10}:
        raise RuntimeError("expected 10 train and 10 dev episodes")
    train_runs = {}
    with TemporaryDirectory() as temp:
        for entry in catalog:
            episode = generate(entry["seed"], entry["config"])
            if episode["manifest"]["episode_id"] != entry["episode_id"]:
                raise RuntimeError("episode ID is not reproducible")
            if entry["split"] == "train":
                env = FinAuditEnv(clock=lambda: 0)
                env.reset(entry["seed"], entry["config"])
                train_runs[entry["episode_id"]] = env
            generated_dir = Path(temp) / entry["path"]
            export_episode(episode, generated_dir)
            released_dir = episodes_dir / entry["path"]
            expected = {path.name: path.read_bytes() for path in generated_dir.iterdir()}
            actual = {path.name: path.read_bytes() for path in released_dir.iterdir()}
            if expected != actual:
                raise RuntimeError(f"episode exports differ: {entry['path']}")

    step_counts = Counter()
    with (ROOT / "trajectories.jsonl").open(encoding="utf-8") as source:
        for line in source:
            row = json.loads(line)
            episode_id = row["episode_id"]
            env = train_runs[episode_id]
            step_counts[episode_id] += 1
            if row["step"] != step_counts[episode_id] or not public_only(row["observation"]):
                raise RuntimeError(f"invalid trajectory in {episode_id}")
            observation, reward, terminated, truncated, _ = env.step(row["action"])
            if (observation, reward, terminated, truncated) != (
                row["observation"], row["reward"], row["terminated"], row["truncated"],
            ):
                raise RuntimeError(f"trajectory does not replay in {episode_id}")
    if not all(env.terminated and step_counts[key] for key, env in train_runs.items()):
        raise RuntimeError("expected a complete trajectory for every train episode")
    print(f"Verified 20 exported episodes and {sum(step_counts.values())} replayed steps.")


if __name__ == "__main__":
    suite = defaultTestLoader.discover(str(ROOT / "backend" / "tests"))
    if not TextTestRunner(verbosity=2).run(suite).wasSuccessful():
        raise SystemExit(1)
    check_release()
