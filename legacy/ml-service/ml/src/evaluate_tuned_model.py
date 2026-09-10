"""Evaluate the selected XGBoost candidate without contaminating the Digha holdout.

This script compares the current baseline configuration against the selected
hyperparameter candidate using the exact train.py data/feature contract.

Important methodology:
* Temporal validation is used for model selection.
* Digha is NEVER used to choose parameters.
* Both candidates are retrained on the complete non-Digha training pool before
  the final Digha comparison, so the spatial comparison is apples-to-apples.
* The production model file is never overwritten.

Run from repository root:
    python ml/src/evaluate_tuned_model.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.metrics import (
    accuracy_score,
    balanced_accuracy_score,
    confusion_matrix,
    f1_score,
    recall_score,
)
from xgboost import XGBClassifier

SRC_DIR = Path(__file__).resolve().parent
if str(SRC_DIR) not in sys.path:
    sys.path.insert(0, str(SRC_DIR))

from config import MODELS_DIR, TARGET_COLUMN  # noqa: E402
from train import HOLDOUT_LOCATION, RANDOM_STATE, add_dynamic_features, class_weights, load_dataset  # noqa: E402

BASELINE = {
    "n_estimators": 900,
    "learning_rate": 0.035,
    "max_depth": 6,
    "min_child_weight": 8,
    "subsample": 0.85,
    "colsample_bytree": 0.85,
    "reg_alpha": 0.15,
    "reg_lambda": 2.0,
    "gamma": 0.05,
}


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


def metrics(y: pd.Series, probabilities: np.ndarray) -> dict:
    pred = probabilities.argmax(axis=1)
    severe_true = (y.to_numpy(dtype=int) >= 2).astype(int)
    severe_pred = (pred >= 2).astype(int)
    return {
        "accuracy": float(accuracy_score(y, pred)),
        "balanced_accuracy": float(balanced_accuracy_score(y, pred)),
        "macro_f1": float(f1_score(y, pred, average="macro", zero_division=0)),
        "weighted_f1": float(f1_score(y, pred, average="weighted", zero_division=0)),
        "high_extreme_recall": float(recall_score(severe_true, severe_pred, zero_division=0)),
        "confusion_matrix": confusion_matrix(y, pred, labels=[0, 1, 2, 3]).tolist(),
    }


def train_and_score(params: dict, train_df: pd.DataFrame, eval_df: pd.DataFrame, features: list[str]) -> dict:
    model = make_model(params)
    weights = class_weights(train_df[TARGET_COLUMN])
    model.fit(
        train_df[features],
        train_df[TARGET_COLUMN],
        sample_weight=train_df[TARGET_COLUMN].map(weights).to_numpy(dtype=np.float32),
        verbose=False,
    )
    probabilities = model.predict_proba(eval_df[features])
    return metrics(eval_df[TARGET_COLUMN], probabilities)


def main() -> None:
    print("=" * 78)
    print("ORCA-X TUNED MODEL EVALUATION — REFINEMENT 4")
    print("=" * 78)
    print("Digha is a final spatial holdout and is not used for selection.")

    tuning_path = MODELS_DIR / "tuning" / "best_xgboost_params.json"
    if not tuning_path.exists():
        raise FileNotFoundError(f"Run tune_xgboost.py first: {tuning_path}")
    selected = json.loads(tuning_path.read_text(encoding="utf-8"))

    raw = load_dataset()
    df, features = add_dynamic_features(raw)
    pool = df[df["location_id"] != HOLDOUT_LOCATION].sort_values("timestamp").copy()
    digha = df[df["location_id"] == HOLDOUT_LOCATION].copy()

    n = len(pool)
    train_end = int(n * 0.70)
    validation_end = int(n * 0.85)
    train_df = pool.iloc[:train_end].copy()
    validation_df = pool.iloc[train_end:validation_end].copy()

    print(f"Training rows: {len(train_df):,}")
    print(f"Temporal validation rows: {len(validation_df):,}")
    print(f"Digha rows: {len(digha):,}")

    print("\n[1/4] Baseline on temporal validation")
    baseline_temporal = train_and_score(BASELINE, train_df, validation_df, features)
    print(json.dumps(baseline_temporal, indent=2))

    print("\n[2/4] Selected candidate on temporal validation")
    candidate_temporal = train_and_score(selected, train_df, validation_df, features)
    print(json.dumps(candidate_temporal, indent=2))

    print("\n[3/4] Baseline retrained on complete non-Digha pool -> Digha")
    baseline_digha = train_and_score(BASELINE, pool, digha, features)
    print(json.dumps(baseline_digha, indent=2))

    print("\n[4/4] Candidate retrained on complete non-Digha pool -> Digha")
    candidate_digha = train_and_score(selected, pool, digha, features)
    print(json.dumps(candidate_digha, indent=2))

    objective = lambda m: 0.5 * m["macro_f1"] + 0.5 * m["balanced_accuracy"]
    summary = {
        "methodology": "baseline and candidate use identical forward-target, point-in-time features, class weighting and non-Digha training pool; Digha is evaluation-only",
        "baseline_params": BASELINE,
        "candidate_params": selected,
        "temporal": {
            "baseline": baseline_temporal,
            "candidate": candidate_temporal,
            "objective_baseline": objective(baseline_temporal),
            "objective_candidate": objective(candidate_temporal),
            "objective_delta": objective(candidate_temporal) - objective(baseline_temporal),
        },
        "digha": {
            "baseline": baseline_digha,
            "candidate": candidate_digha,
            "objective_baseline": objective(baseline_digha),
            "objective_candidate": objective(candidate_digha),
            "objective_delta": objective(candidate_digha) - objective(baseline_digha),
        },
        "production_model_modified": False,
    }

    out = MODELS_DIR / "tuning" / "tuned_model_evaluation.json"
    out.write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print("\n" + "=" * 78)
    print("FINAL COMPARISON")
    print("=" * 78)
    print(f"Temporal objective: baseline={objective(baseline_temporal):.5f} candidate={objective(candidate_temporal):.5f}")
    print(f"Digha objective:    baseline={objective(baseline_digha):.5f} candidate={objective(candidate_digha):.5f}")
    print(f"Digha HIGH+EXTREME recall: baseline={baseline_digha['high_extreme_recall']:.5f} candidate={candidate_digha['high_extreme_recall']:.5f}")
    print(f"Saved: {out}")
    print("Production model was NOT modified.")


if __name__ == "__main__":
    main()
