"""Refinement 40: audit v2.6 evaluation results before production promotion.

This script consumes the evaluation JSON produced by train.py and turns the
four-class metrics into an explicit production gate. It never changes the
production model artifact.
"""
from __future__ import annotations

import json
from pathlib import Path

from config import MODELS_DIR, RISK_CLASS_NAMES

EVAL_PATH = MODELS_DIR / "orca_xgb_risk_evaluation.json"


def _section(report: dict, split: str) -> dict:
    return report["model_metrics"][split]


def _class_rows(metric: dict) -> list[tuple[str, float, float, float, int]]:
    rows = []
    for cls in range(4):
        name = RISK_CLASS_NAMES[cls]
        item = metric["classification_report"][name]
        rows.append(
            (name, float(item["precision"]), float(item["recall"]), float(item["f1-score"]), int(item["support"]))
        )
    return rows


def _print_split(name: str, metric: dict) -> None:
    print(f"\n{name}")
    print("-" * len(name))
    print(
        f"accuracy={metric['accuracy']:.4f} | balanced_accuracy={metric['balanced_accuracy']:.4f} | "
        f"macro_f1={metric['macro_f1']:.4f} | EXTREME_recall={metric['critical_recall']:.4f}"
    )
    print("class                 precision  recall  f1      support")
    for cls, precision, recall, f1, support in _class_rows(metric):
        print(f"{cls:<20} {precision:>8.4f} {recall:>7.4f} {f1:>7.4f} {support:>9,}")
    print("confusion_matrix=[actual rows x predicted columns]")
    for row in metric["confusion_matrix"]:
        print("  ", row)


def main() -> None:
    if not EVAL_PATH.exists():
        raise FileNotFoundError(
            f"Missing {EVAL_PATH}. Run ml/src/train.py in evaluation-only mode first."
        )
    report = json.loads(EVAL_PATH.read_text(encoding="utf-8"))

    print("=" * 88)
    print("ORCA-X REFINEMENT 40 — v2.6 ERROR ANALYSIS + PRODUCTION GATE")
    print("Production artifact is never modified by this script.")
    print("=" * 88)

    for split, title in [
        ("validation_2024", "2024 VALIDATION"),
        ("temporal_test_2025", "2025 LOCKED TEMPORAL TEST"),
        ("digha_spatial_holdout", "DIGHА SPATIAL HOLDOUT"),
    ]:
        _print_split(title, _section(report, split))

    temporal = _section(report, "temporal_test_2025")
    digha = _section(report, "digha_spatial_holdout")
    selected = int(report["selected_estimators"])

    # Conservative safety gate: the final temporal test must demonstrate useful
    # critical recall and class-balanced performance, while Digha must retain
    # meaningful spatial generalisation. These are review thresholds, not claims
    # of real-world incident accuracy.
    gates = {
        "temporal_accuracy_above_majority": temporal["accuracy"] > report["majority_baselines"]["temporal_test_2025"]["accuracy"],
        "temporal_macro_f1_above_majority": temporal["macro_f1"] > report["majority_baselines"]["temporal_test_2025"]["macro_f1"],
        "temporal_extreme_recall_ge_0_70": temporal["critical_recall"] >= 0.70,
        "temporal_balanced_accuracy_ge_0_65": temporal["balanced_accuracy"] >= 0.65,
        "digha_balanced_accuracy_ge_0_60": digha["balanced_accuracy"] >= 0.60,
        "digha_extreme_recall_ge_0_50": digha["critical_recall"] >= 0.50,
    }

    print("\nProduction gate")
    print("-")
    for name, passed in gates.items():
        print(f"{'PASS' if passed else 'FAIL':<5} {name}")
    print(f"Selected estimators: {selected}")

    all_pass = all(gates.values())
    print("\n" + ("REFINEMENT 40 GATE: PASS" if all_pass else "REFINEMENT 40 GATE: REVIEW REQUIRED"))
    print(
        "NOTE: labels are operational severity proxies, not observed incidents or official warnings. "
        "A PASS authorizes technical promotion review; it does not establish safety guarantees."
    )

    out = dict(report)
    out["refinement40"] = {
        "gates": gates,
        "gate_pass": all_pass,
        "selected_estimators": selected,
        "production_promotion_authorized_for_review": all_pass,
    }
    EVAL_PATH.write_text(json.dumps(out, indent=2), encoding="utf-8")
    print(f"Updated evaluation report: {EVAL_PATH}")


if __name__ == "__main__":
    main()
