"""Targeted XGBoost search for ORCA-X Refinement 4.

Selection is performed ONLY on the temporal validation block from the
training locations. Digha is never used to choose hyperparameters; it remains
a final spatial holdout.

Objectives:
  * macro-F1
  * balanced accuracy

Safety constraint:
  * do not select a candidate whose HIGH/EXTREME recall is materially below
    the current baseline on the temporal validation block.

The production model is never overwritten. The selected configuration is
saved as JSON and a leaderboard is written for auditability.

Run from repository root:
    python ml/src/tune_xgboost.py

The next step after this script is to retrain/evaluate the winning candidate
on the complete non-Digha training pool, then run temporal and Digha holdouts.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.metrics import balanced_accuracy_score, f1_score, recall_score
from xgboost import XGBClassifier

SRC_DIR = Path(__file__).resolve().parent
if str(SRC_DIR) not in sys.path:
    sys.path.insert(0, str(SRC_DIR))

from config import MODELS_DIR, TARGET_COLUMN  # noqa: E402
from train import HOLDOUT_LOCATION, RANDOM_STATE, add_dynamic_features, class_weights, load_dataset  # noqa: E402

N_TRIALS = 18
SEED = 20260825

# Deliberately centered around the current production configuration rather
# than performing a huge expensive grid search.
SEARCH_SPACE = {
    "n_estimators": [600, 800, 1000, 1200],
    "learning_rate": [0.025, 0.035, 0.05],
    "max_depth": [4, 5, 6, 7],
    "min_child_weight": [4, 8, 12],
    "subsample": [0.75, 0.85, 0.95],
    "colsample_bytree": [0.75, 0.85, 0.95],
    "reg_alpha": [0.0, 0.15, 0.35],
    "reg_lambda": [1.0, 2.0, 4.0],
    "gamma": [0.0, 0.05, 0.15],
}


def sample_configs(n: int) -> list[dict]:
    rng = np.random.default_rng(SEED)
    configs: list[dict] = []

    # Always test the current production configuration first.
    configs.append({
        "n_estimators": 900,
        "learning_rate": 0.035,
        "max_depth": 6,
        "min_child_weight": 8,
        "subsample": 0.85,
        "colsample_bytree": 0.85,
        "reg_alpha": 0.15,
        "reg_lambda": 2.0,
        "gamma": 0.05,
    })

    seen = {tuple(sorted(configs[0].items()))}
    keys = list(SEARCH_SPACE)
    while len(configs) < n:
        candidate = {key: SEARCH_SPACE[key][int(rng.integers(0, len(SEARCH_SPACE[key])))] for key in keys}
        marker = tuple(sorted(candidate.items()))
        if marker not in seen:
            seen.add(marker)
            configs.append(candidate)
    return configs


def make_model(params: dict) -> XGBClassifier:
    return XGBClassifier(
        objective="multi:softprob",
        num_class=4,
        tree_method="hist",
        eval_metric="mlogloss",
        random_state=RANDOM_STATE,
        n_jobs=-1,
        **params,
    )


def score(y_true: pd.Series, probabilities: np.ndarray) -> dict:
    pred = probabilities.argmax(axis=1)
    severe_true = (y_true.to_numpy(dtype=int) >= 2).astype(int)
    severe_pred = (pred >= 2).astype(int)
    return {
        "balanced_accuracy": float(balanced_accuracy_score(y_true, pred)),
        "macro_f1": float(f1_score(y_true, pred, average="macro", zero_division=0)),
        "weighted_f1": float(f1_score(y_true, pred, average="weighted", zero_division=0)),
        "high_extreme_recall": float(recall_score(severe_true, severe_pred, zero_division=0)),
    }


def main() -> None:
    print("=" * 78)
    print("ORCA-X TARGETED XGBOOST SEARCH — REFINEMENT 4")
    print("=" * 78)
    print("Selection set: temporal validation only")
    print("Digha: reserved final spatial holdout; NEVER used for tuning")
    print(f"Trials: {N_TRIALS}")

    raw = load_dataset()
    df, features = add_dynamic_features(raw)

    pool = df[df["location_id"] != HOLDOUT_LOCATION].sort_values("timestamp").copy()
    n = len(pool)
    train_end = int(n * 0.70)
    validation_end = int(n * 0.85)
    train_df = pool.iloc[:train_end].copy()
    validation_df = pool.iloc[train_end:validation_end].copy()

    weights = class_weights(train_df[TARGET_COLUMN])
    sample_weight = train_df[TARGET_COLUMN].map(weights).to_numpy(dtype=np.float32)

    configs = sample_configs(N_TRIALS)
    baseline_metrics = None
    results: list[dict] = []

    for trial, params in enumerate(configs, start=1):
        print(f"\n[{trial:02d}/{N_TRIALS}] {params}")
        model = make_model(params)
        model.fit(
            train_df[features],
            train_df[TARGET_COLUMN],
            sample_weight=sample_weight,
            eval_set=[(validation_df[features], validation_df[TARGET_COLUMN])],
            verbose=False,
        )
        probabilities = model.predict_proba(validation_df[features])
        metrics = score(validation_df[TARGET_COLUMN], probabilities)

        if trial == 1:
            baseline_metrics = metrics.copy()

        # Safety guard: candidates that materially reduce severe-risk recall
        # are not allowed to win merely by improving the average score.
        severe_floor = max(0.0, float(baseline_metrics["high_extreme_recall"]) - 0.015)
        safety_ok = metrics["high_extreme_recall"] >= severe_floor
        objective = 0.5 * metrics["macro_f1"] + 0.5 * metrics["balanced_accuracy"]

        record = {
            "trial": trial,
            "objective": float(objective),
            "safety_ok": bool(safety_ok),
            "severe_recall_floor": severe_floor,
            "params": params,
            **metrics,
        }
        results.append(record)
        print(
            f"  objective={objective:.5f} macro_f1={metrics['macro_f1']:.5f} "
            f"balanced_accuracy={metrics['balanced_accuracy']:.5f} "
            f"HIGH+EXTREME recall={metrics['high_extreme_recall']:.5f} "
            f"safety_ok={safety_ok}"
        )

    feasible = [row for row in results if row["safety_ok"]]
    if not feasible:
        raise RuntimeError("No candidate satisfied the severe-risk recall guardrail. Do not replace the production model.")

    best = max(
        feasible,
        key=lambda row: (
            row["objective"],
            row["macro_f1"],
            row["balanced_accuracy"],
            row["high_extreme_recall"],
        ),
    )

    leaderboard = sorted(
        results,
        key=lambda row: (row["safety_ok"], row["objective"], row["macro_f1"], row["balanced_accuracy"]),
        reverse=True,
    )

    output_dir = MODELS_DIR / "tuning"
    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / "xgboost_tuning_results.json").write_text(
        json.dumps(
            {
                "selection_rule": "maximize 0.5*macro_F1 + 0.5*balanced_accuracy on temporal validation, subject to HIGH+EXTREME recall guardrail",
                "digha_used_for_selection": False,
                "training_rows": int(len(train_df)),
                "validation_rows": int(len(validation_df)),
                "feature_count": int(len(features)),
                "baseline": baseline_metrics,
                "best": best,
                "leaderboard": leaderboard,
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    (output_dir / "best_xgboost_params.json").write_text(
        json.dumps(best["params"], indent=2), encoding="utf-8"
    )

    print("\n" + "=" * 78)
    print("BEST TEMPORAL-VALIDATION CANDIDATE")
    print("=" * 78)
    print(json.dumps(best, indent=2))
    print(f"\nSaved: {output_dir / 'xgboost_tuning_results.json'}")
    print(f"Saved: {output_dir / 'best_xgboost_params.json'}")
    print("\nProduction model was NOT modified.")
    print("Digha was NOT used for hyperparameter selection.")


if __name__ == "__main__":
    main()
