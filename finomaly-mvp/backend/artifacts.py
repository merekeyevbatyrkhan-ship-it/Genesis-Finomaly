"""Build the public episode splits, audited trajectories and measured baseline report."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from statistics import mean
import subprocess
import sys

from .app.env import FinAuditEnv
from .app.generator import export_episode, generate
from .app.policies import OraclePolicy, PUBLIC_POLICIES, run_policy


ROOT = Path(__file__).resolve().parent.parent
SCENARIOS = (
    "clean", "duplicate_invoice", "partial_allocation", "fx_rate", "period_cutoff",
    "allocation_fx", "duplicate_cutoff", "clean", "allocation_fx", "duplicate_cutoff",
)
CURRENCIES = ("KZT", "USD", "EUR", "JPY", "CHF", "GBP", "CNY", "UZS", "KZT", "EUR")


def split_configs(split):
    for index, scenario in enumerate(SCENARIOS):
        is_dev = split == "dev"
        seed = (37001 if is_dev else 8011) + index * (113 if is_dev else 79)
        yield seed, {
            "scenario": scenario,
            "base_currency": CURRENCIES[(index + 3 * is_dev) % len(CURRENCIES)],
            "period_start": "2025-04-01" if is_dev else "2025-01-01",
            "period_end": "2025-06-30" if is_dev else "2025-03-31",
            "documents_count": 64 if is_dev else 60,
            "ledger_count": 280 if is_dev else 260,
        }


class IsolatedPolicy:
    """Run the public adapter in a process with only the action/observation pipe."""

    def __init__(self, policy_name, seed=17):
        self.policy_name = policy_name
        self.seed = seed
        self.process = None

    def __enter__(self):
        self.process = subprocess.Popen(
            [sys.executable, "-B", "-m", "backend.app.policies", self.policy_name, str(self.seed)],
            cwd=ROOT, stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True, encoding="utf-8",
        )
        return self

    def __exit__(self, exception_type, exception, traceback):
        if self.process.stdin:
            self.process.stdin.close()
        try:
            self.process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            self.process.kill()
            self.process.wait()
        finally:
            if self.process.stdout:
                self.process.stdout.close()

    def next_action(self, observation):
        self.process.stdin.write(json.dumps(observation, allow_nan=False) + "\n")
        self.process.stdin.flush()
        response = self.process.stdout.readline()
        if not response:
            raise RuntimeError(f"Policy subprocess exited before sending an action: {self.policy_name}")
        return json.loads(response)


def _build_split(output, split, trajectory_file):
    catalog = []
    results = []
    for index, (seed, config) in enumerate(split_configs(split), 1):
        episode = generate(seed, config)
        episode_id = episode["manifest"]["episode_id"]
        destination = Path(split) / f"{index:02d}"
        export_episode(episode, output / "episodes" / destination)
        catalog.append({
            "split": split, "path": destination.as_posix(), "seed": seed,
            "config": config, "episode_id": episode_id,
        })
        for name in (*PUBLIC_POLICIES, "oracle"):
            record_trajectory = split == "train" and name == "reconciliation"
            env = FinAuditEnv(training=record_trajectory)
            observation, _ = env.reset(seed, config)
            trajectory = []
            if name == "oracle":
                metrics = run_policy(env, OraclePolicy(episode["truth"]), observation)
            else:
                with IsolatedPolicy(name) as policy:
                    metrics = run_policy(env, policy, observation, on_step=trajectory.append if record_trajectory else None)
            for transition in trajectory:
                trajectory_file.write(json.dumps(transition, ensure_ascii=False, allow_nan=False) + "\n")
            results.append({
                "split": split, "scenario": config["scenario"], "episode_id": episode_id,
                "policy": name, **metrics,
            })
    return catalog, results


def _metric_row(label, outcomes):
    measures = [f"{mean(row[key] for row in outcomes):.3f}" for key in ("precision", "recall", "f1", "reward")]
    measures += [f"{mean(row[key] for row in outcomes):.1f}" for key in ("steps", "time_ms")]
    return "| " + " | ".join([label, str(len(outcomes)), *measures]) + " |\n"


def _report(outcomes):
    report = [
        "# Базовые политики FINOMALY\n\n",
        "Измерено на 20 открытых эпизодах. Каждая политика получила одинаковые книги для каждого эпизода. ",
        "Время от первого запроса политики до завершения эпизода включает обмен JSON для публичных политик. ",
        "Генерация книг, запись файлов и настройка запуска находятся за пределами замера.\n\n",
        "| Выборка и политика | Прогоны | Precision | Recall | F1 | Возврат | Шаги | Время, мс |\n",
        "|---|---:|---:|---:|---:|---:|---:|---:|\n",
    ]
    for split in ("train", "dev", "train + dev"):
        for name in (*PUBLIC_POLICIES, "oracle"):
            rows = [
                outcome for outcome in outcomes
                if outcome["policy"] == name and (split == "train + dev" or outcome["split"] == split)
            ]
            report.append(_metric_row(f"`{split}` · `{name}`", rows))
    examples = [
        outcome for outcome in outcomes
        if outcome["split"] == "dev" and outcome["scenario"] in ("duplicate_invoice", "clean")
    ]
    report += [
        "\nПри пустом эталоне и пустой отправке P и R равны 0, а F1 равен 1 по правилам кейса. ",
        "`random` собирает случайную выборку и отправляет пустой список. ",
        "`flag_everything` помечает все типы ошибок у первых наблюдаемых строк и расходует лимит выводов. ",
        "`oracle` получает эталон внутри оценщика и отправляет его без шагов исследования. ",
        "`reconciliation` выводит расхождения по публичным книгам и оплатам. ",
        "Разница в возврате при одинаковом F1 показывает цену шагов.\n\n",
        "## Диагностика отдельных эпизодов\n\n",
        "| Эпизод | Сценарий | Политика | TP | FP | FN | F1 | Возврат | Шаги | Время, мс |\n",
        "|---|---|---|---:|---:|---:|---:|---:|---:|---:|\n",
    ]
    for row in examples:
        report.append(
            f"| `{row['episode_id']}` | `{row['scenario']}` | `{row['policy']}` | "
            f"{row['tp']} | {row['fp']} | {row['fn']} | {row['f1']:.3f} | "
            f"{row['reward']:.3f} | {row['steps']} | {row['time_ms']:.1f} |\n"
        )
    report += [
        "\nЭто сравнение скриптовых политик на открытых данных. Закрытые эпизоды организаторов ",
        "и изменение качества обученной модели в этом замере не оценивались.\n",
    ]
    return "".join(report)


def build_artifacts(output):
    output.mkdir(parents=True, exist_ok=True)
    (output / "episodes").mkdir(exist_ok=True)
    catalog, outcomes = [], []
    with (output / "trajectories.jsonl").open("w", encoding="utf-8", newline="\n") as trajectory_file:
        for split in ("train", "dev"):
            items, diagnostic = _build_split(output, split, trajectory_file)
            catalog.extend(items)
            outcomes.extend(diagnostic)
    (output / "episodes" / "catalog.json").write_text(
        json.dumps(catalog, indent=2, ensure_ascii=False, allow_nan=False) + "\n", encoding="utf-8",
    )
    (output / "BENCHMARK.md").write_text(_report(outcomes), encoding="utf-8")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=ROOT)
    build_artifacts(parser.parse_args().output.resolve())
