"""ORCA-X Refinement 15: risk-sensitive operating-point optimization.

Refinement 14 showed that probability calibration materially improves ECE,
while a safety-aware HIGH/EXTREME decision layer can raise critical recall to
~88% at a substantial accuracy cost. Refinement 15 asks a narrower question:
can we choose a safer operating point with an explicit constraint rather than
using unconstrained class offsets?

Evaluation contract
-------------------
* Same clean +6h forward target from Refinement 11.
* Same causal dynamic feature family and Refinement 13 winner.
* No location ID, coordinates, stored labels, or future features.
* Leave-one-coast-out selection; Digha is excluded from selection and audited
  only after the operating point is frozen.
* Chronological train/calibration/test split inside each training fold.
* Temperature and operating-point parameters are fitted on calibration only.
* The operating point maximizes macro-F1 subject to a minimum HIGH+EXTREME
  recall and a minimum accuracy floor relative to calibrated argmax.
* Probabilities are explicitly renormalized before every probabilistic metric,
  eliminating the sklearn warning caused by floating-point row-sum drift.
* No production artifacts are modified.
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.metrics import (
    accuracy_score,
    balanced_accuracy_score,
    brier_score_loss,
    confusion_matrix,
    f1_score,
    log_loss,
)

from refinement14_calibrated_risk_model import (
    BASE_FEATURES,
    DIRECTIONAL,
    DYNAMIC_BASE,
    HOLDOUT_LOCATION,
    OUT_DIR as R14_OUT_DIR,
    SOURCE_PATH,
    TARGET_COLUMN,
    BEST_PARAMS,
    add_dynamic_features,
    apply_temperature,
    class_weights,
    chronological_split,
    critical_recall,
    fit_temperature,
    load_clean,
    make_model,
    probabilities,
)

RANDOM_STATE = 42
OUT_DIR = Path(__file__).resolve().parents[1] / "models" / "refinement15"

# Safety constraints. These are selection constraints, not production policy
# thresholds. They are deliberately evaluated on calibration data only.
MIN_CRITICAL_RECALL = 0.85
MIN_ACCURACY_FRACTION_OF_BASELINE = 0.90


def normalize_probs(probs: np.ndarray) -> np.ndarray:
    """Force every probability row to sum to exactly one."""
    p = np.asarray(probs, dtype=np.float64)
    p = np.clip(p, 1e-12, None)
    return p / p.sum(axis=1, keepdims=True)


def multiclass_brier(y: np.ndarray, probs: np.ndarray) -> float:
    p = normalize_probs(probs)
    one_hot = np.eye(4, dtype=np.float64)[y]
    return float(np.mean(np.sum((p - one_hot) ** 2, axis=1)))


def ece(y: np.ndarray, probs: np.ndarray, bins: int = 15) -> float:
    p = normalize_probs(probs)
    confidence = p.max(axis=1)
    pred = p.argmax(axis=1)
    correct = (pred == y).astype(float)
    edges = np.linspace(0.0, 1.0, bins + 1)
    score = 0.0
    for lo, hi in zip(edges[:-1], edges[1:]):
        mask = (confidence >= lo) & (
            confidence < hi if hi < 1.0 else confidence <= hi
        )
        if mask.any():
            score += mask.mean() * abs(
                correct[mask].mean() - confidence[mask].mean()
            )
    return float(score)


def metrics(y: np.ndarray, probs: np.ndarray, pred: np.ndarray | None = None) -> dict:
    p = normalize_probs(probs)
    if pred is None:
        pred = p.argmax(axis=1)
    return {
        "accuracy": float(accuracy_score(y, pred)),
        "balanced_accuracy": float(balanced_accuracy_score(y, pred)),
        "macro_f1": float(f1_score(y, pred, average="macro", zero_division=0)),
        "weighted_f1": float(f1_score(y, pred, average="weighted", zero_division=0)),
        "high_recall": float(((y == 2) & (pred == 2)).sum() / max((y == 2).sum(), 1)),
        "extreme_recall": float(((y == 3) & (pred == 3)).sum() / max((y == 3).sum(), 1)),
        "high_extreme_recall": critical_recall(y, pred),
        "log_loss": float(log_loss(y, p, labels=[0, 1, 2, 3])),
        "brier": multiclass_brier(y, p),
        "ece": ece(y, p),
        "confusion_matrix": confusion_matrix(y, pred, labels=[0, 1, 2, 3]).tolist(),
        "rows": int(len(y)),
    }


def safety_scores(probs: np.ndarray, high_threshold: float, extreme_threshold: float) -> np.ndarray:
    """Apply explicit critical-class probability thresholds.

    EXTREME is checked first, then HIGH. If neither threshold is met, the
    normal argmax decision is retained. This makes the operating point easy
    to audit and avoids unconstrained logit-offset tuning.
    """
    p = normalize_probs(probs)
    pred = p.argmax(axis=1).astype(int)
    extreme = p[:, 3] >= extreme_threshold
    high = (p[:, 2] >= high_threshold) & ~extreme
    pred[high] = 2
    pred[extreme] = 3
    return pred


def operating_objective(y: np.ndarray, pred: np.ndarray) -> float:
    """Primary calibration objective: macro-F1, with balanced accuracy support."""
    macro = f1_score(y, pred, average="macro", zero_division=0)
    bal = balanced_accuracy_score(y, pred)
    return float(0.70 * macro + 0.30 * bal)


def select_operating_point(y: np.ndarray, calibrated_probs: np.ndarray) -> tuple[float, float, dict]:
    p = normalize_probs(calibrated_probs)
    baseline_pred = p.argmax(axis=1)
    baseline_acc = accuracy_score(y, baseline_pred)

    best_score = -np.inf
    best = None
    # Lower thresholds make the classifier more conservative. We deliberately
    # search a transparent probability grid instead of tuning arbitrary logits.
    grid = np.arange(0.20, 0.81, 0.02)
    for high_t in grid:
        for extreme_t in grid:
            if extreme_t < high_t:
                continue
            pred = safety_scores(p, float(high_t), float(extreme_t))
            acc = accuracy_score(y, pred)
            crit = critical_recall(y, pred)
            if crit < MIN_CRITICAL_RECALL:
                continue
            if acc < MIN_ACCURACY_FRACTION_OF_BASELINE * baseline_acc:
                continue
            score = operating_objective(y, pred)
            if score > best_score + 1e-12:
                best_score = score
                best = (float(high_t), float(extreme_t), {
                    "objective": float(score),
                    "calibration_accuracy": float(acc),
                    "calibration_critical_recall": float(crit),
                    "baseline_accuracy": float(baseline_acc),
                })

    if best is None:
        # Transparent fallback: use argmax rather than silently inventing a
        # threshold when the requested safety/accuracy constraints conflict.
        return 1.01, 1.01, {
            "objective": float(operating_objective(y, baseline_pred)),
            "calibration_accuracy": float(baseline_acc),
            "calibration_critical_recall": float(critical_recall(y, baseline_pred)),
            "baseline_accuracy": float(baseline_acc),
            "fallback": True,
        }
    return best


def fit_fold(train, cal, test, features) -> dict:
    model = make_model()
    model.fit(
        train[features],
        train[TARGET_COLUMN],
        sample_weight=class_weights(train[TARGET_COLUMN]),
        verbose=False,
    )
    raw_cal = normalize_probs(probabilities(model, cal[features]))
    raw_test = normalize_probs(probabilities(model, test[features]))
    y_cal = cal[TARGET_COLUMN].to_numpy(dtype=int)
    y_test = test[TARGET_COLUMN].to_numpy(dtype=int)

    temperature = fit_temperature(y_cal, raw_cal)
    cal_probs = normalize_probs(apply_temperature(raw_cal, temperature))
    test_probs = normalize_probs(apply_temperature(raw_test, temperature))
    high_t, extreme_t, selection = select_operating_point(y_cal, cal_probs)

    base_pred = test_probs.argmax(axis=1)
    safety_pred = safety_scores(test_probs, high_t, extreme_t)
    return {
        "temperature": float(temperature),
        "high_probability_threshold": float(high_t),
        "extreme_probability_threshold": float(extreme_t),
        "selection": selection,
        "calibration_rows": int(len(cal)),
        "test_rows": int(len(test)),
        "calibrated_argmax_test": metrics(y_test, test_probs, base_pred),
        "risk_constrained_test": metrics(y_test, test_probs, safety_pred),
    }


def main() -> None:
    print("=" * 78)
    print("ORCA-X RISK-CONSTRAINED OPERATING POINT BENCHMARK — REFINEMENT 15")
    print("=" * 78)
    print("Selection: mean leave-one-coast-out; Digha excluded from selection")
    print("Calibration: chronological train/calibration/test; no future leakage")
    print("Decision: probability thresholds with explicit critical-recall + accuracy constraints")
    print(f"Minimum calibration critical recall: {MIN_CRITICAL_RECALL:.2f}")
    print(f"Minimum calibration accuracy: {MIN_ACCURACY_FRACTION_OF_BASELINE:.0%} of argmax baseline")

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    df = load_clean()
    df, features = add_dynamic_features(df)
    print(f"Rows: {len(df):,} | Locations: {df.location_id.nunique()} | Features: {len(features)}")
    print(f"Target distribution: {df[TARGET_COLUMN].value_counts().sort_index().to_dict()}")

    locations = sorted(df.location_id.unique())
    selection_locations = [x for x in locations if x != HOLDOUT_LOCATION]
    folds = []

    for location in selection_locations:
        train_pool = df[df.location_id != location]
        train, cal, test = chronological_split(train_pool)
        result = fit_fold(train, cal, df[df.location_id == location], features)
        folds.append({"location": location, **result})
        print(
            f"{location:12s} argmax_f1={result['calibrated_argmax_test']['macro_f1']:.4f} "
            f"constrained_f1={result['risk_constrained_test']['macro_f1']:.4f} "
            f"critical={result['risk_constrained_test']['high_extreme_recall']:.4f} "
            f"acc={result['risk_constrained_test']['accuracy']:.4f}"
        )

    def mean_metric(name: str, section: str = "risk_constrained_test") -> float:
        return float(np.mean([f[section][name] for f in folds]))

    summary = {
        "refinement": 15,
        "contract": {
            "source": str(SOURCE_PATH),
            "forward_horizon_hours": 6,
            "holdout_location": HOLDOUT_LOCATION,
            "selection_locations": selection_locations,
            "features": len(features),
            "no_future_features": True,
        },
        "constraints": {
            "min_critical_recall": MIN_CRITICAL_RECALL,
            "min_accuracy_fraction_of_argmax": MIN_ACCURACY_FRACTION_OF_BASELINE,
        },
        "selection_mean": {
            "argmax": {
                "accuracy": mean_metric("accuracy", "calibrated_argmax_test"),
                "balanced_accuracy": mean_metric("balanced_accuracy", "calibrated_argmax_test"),
                "macro_f1": mean_metric("macro_f1", "calibrated_argmax_test"),
                "high_extreme_recall": mean_metric("high_extreme_recall", "calibrated_argmax_test"),
            },
            "risk_constrained": {
                "accuracy": mean_metric("accuracy"),
                "balanced_accuracy": mean_metric("balanced_accuracy"),
                "macro_f1": mean_metric("macro_f1"),
                "high_extreme_recall": mean_metric("high_extreme_recall"),
            },
        },
        "folds": folds,
    }

    # Final Digha audit: no threshold selection from Digha. Freeze the mean
    # threshold from non-Digha folds, then train on all non-Digha rows.
    thresholds = np.array([
        [f["high_probability_threshold"], f["extreme_probability_threshold"]]
        for f in folds
        if not f["selection"].get("fallback", False)
    ], dtype=float)
    if len(thresholds):
        frozen_high, frozen_extreme = np.median(thresholds, axis=0)
    else:
        frozen_high, frozen_extreme = 1.01, 1.01

    non_digha = df[df.location_id != HOLDOUT_LOCATION]
    train, cal, _ = chronological_split(non_digha)
    model = make_model()
    model.fit(
        train[features], train[TARGET_COLUMN],
        sample_weight=class_weights(train[TARGET_COLUMN]), verbose=False,
    )
    cal_probs = normalize_probs(probabilities(model, cal[features]))
    temp = fit_temperature(cal[TARGET_COLUMN].to_numpy(dtype=int), cal_probs)
    digha = df[df.location_id == HOLDOUT_LOCATION]
    digha_probs = normalize_probs(apply_temperature(probabilities(model, digha[features]), temp))
    digha_y = digha[TARGET_COLUMN].to_numpy(dtype=int)
    digha_pred = safety_scores(digha_probs, frozen_high, frozen_extreme)
    summary["digha_final_audit"] = {
        "temperature": float(temp),
        "frozen_high_threshold": float(frozen_high),
        "frozen_extreme_threshold": float(frozen_extreme),
        "metrics": metrics(digha_y, digha_probs, digha_pred),
    }

    out_path = OUT_DIR / "refinement15_results.json"
    out_path.write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print("=" * 78)
    print("REFINEMENT 15 COMPLETE")
    print("=" * 78)
    print(json.dumps(summary["selection_mean"], indent=2))
    print("Digha final audit:")
    print(json.dumps(summary["digha_final_audit"], indent=2))
    print(f"Saved: {out_path}")
    print("Production model, policy, thresholds, and source dataset were NOT modified.")


if __name__ == "__main__":
    main()
