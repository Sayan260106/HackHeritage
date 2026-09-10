"""ORCA-X Refinement 16: conformal uncertainty and safety-aware decisions.

Refinement 15 optimized a fixed operating point under calibration-only safety
constraints. Refinement 16 adds an uncertainty layer: conformal prediction sets
are constructed from the chronological calibration slice, then converted into
an auditable risk decision without looking at the held-out test labels.

Evaluation contract
-------------------
* Same clean +6h forward target from Refinement 11.
* Same causal dynamic feature family and Refinement 13 winner.
* No location ID, coordinates, stored labels, or future features.
* Leave-one-coast-out selection; Digha is excluded from selection and audited
  only after the method is frozen.
* Chronological train/calibration/test split inside every training fold.
* Temperature is fitted on calibration only.
* Conformal quantiles are fitted on calibration only.
* No Digha labels are used to select coverage, thresholds, or decisions.
* Production model, policy, thresholds, and source data are untouched.

Decision principle
------------------
A conformal prediction set contains every class whose calibrated probability is
at least the calibration-derived nonconformity threshold. A singleton set uses
that class. For an ambiguous set containing HIGH/EXTREME, the highest-risk
member is selected conservatively. Sets larger than two classes are marked
UNCERTAIN rather than being forced into false precision.
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.metrics import (
    accuracy_score,
    balanced_accuracy_score,
    confusion_matrix,
    f1_score,
    log_loss,
)

from refinement14_calibrated_risk_model import (
    HOLDOUT_LOCATION,
    SOURCE_PATH,
    TARGET_COLUMN,
    add_dynamic_features,
    apply_temperature,
    class_weights,
    chronological_split,
    fit_temperature,
    load_clean,
    make_model,
    probabilities,
)

OUT_DIR = Path(__file__).resolve().parents[1] / "models" / "refinement16"
COVERAGE_GRID = (0.80, 0.85, 0.90, 0.95)
MAX_SET_SIZE = 2


def normalize_probs(probs: np.ndarray) -> np.ndarray:
    p = np.asarray(probs, dtype=np.float64)
    p = np.clip(p, 1e-12, None)
    return p / p.sum(axis=1, keepdims=True)


def conformal_threshold(y: np.ndarray, probs: np.ndarray, coverage: float) -> float:
    """Finite-sample split-conformal threshold for 1-p_true nonconformity."""
    p = normalize_probs(probs)
    scores = 1.0 - p[np.arange(len(y)), y]
    scores = np.sort(scores)
    n = len(scores)
    rank = int(np.ceil((n + 1) * coverage)) - 1
    rank = min(max(rank, 0), n - 1)
    return float(scores[rank])


def prediction_sets(probs: np.ndarray, threshold: float) -> np.ndarray:
    p = normalize_probs(probs)
    return p >= (1.0 - threshold - 1e-12)


def set_sizes(sets: np.ndarray) -> np.ndarray:
    return sets.sum(axis=1).astype(int)


def conformal_coverage(y: np.ndarray, sets: np.ndarray) -> float:
    return float(sets[np.arange(len(y)), y].mean())


def selective_decision(probs: np.ndarray, sets: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Return conservative predictions and an explicit uncertainty mask."""
    p = normalize_probs(probs)
    pred = p.argmax(axis=1).astype(int)
    uncertain = set_sizes(sets) > MAX_SET_SIZE

    for i in range(len(pred)):
        members = np.flatnonzero(sets[i])
        if len(members) == 0:
            continue
        if len(members) == 1:
            pred[i] = int(members[0])
        elif np.any(np.isin(members, [2, 3])):
            pred[i] = int(members.max())
        else:
            pred[i] = int(members[np.argmax(p[i, members])])
    return pred, uncertain


def recall(y: np.ndarray, pred: np.ndarray, cls: int) -> float:
    mask = y == cls
    return float(((pred == cls) & mask).sum() / max(mask.sum(), 1))


def critical_recall(y: np.ndarray, pred: np.ndarray) -> float:
    mask = np.isin(y, [2, 3])
    return float(np.isin(pred[mask], [2, 3]).mean()) if mask.any() else 0.0


def metrics(y: np.ndarray, probs: np.ndarray, pred: np.ndarray, uncertain: np.ndarray) -> dict:
    p = normalize_probs(probs)
    auto = ~uncertain
    return {
        "accuracy": float(accuracy_score(y, pred)),
        "balanced_accuracy": float(balanced_accuracy_score(y, pred)),
        "macro_f1": float(f1_score(y, pred, average="macro", zero_division=0)),
        "weighted_f1": float(f1_score(y, pred, average="weighted", zero_division=0)),
        "high_recall": recall(y, pred, 2),
        "extreme_recall": recall(y, pred, 3),
        "high_extreme_recall": critical_recall(y, pred),
        "log_loss": float(log_loss(y, p, labels=[0, 1, 2, 3])),
        "uncertain_rate": float(uncertain.mean()),
        "selective_coverage": float(auto.mean()),
        "selective_accuracy": float(accuracy_score(y[auto], pred[auto])) if auto.any() else 0.0,
        "selective_macro_f1": float(f1_score(y[auto], pred[auto], average="macro", zero_division=0)) if auto.any() else 0.0,
        "confusion_matrix": confusion_matrix(y, pred, labels=[0, 1, 2, 3]).tolist(),
        "rows": int(len(y)),
    }


def choose_coverage(y: np.ndarray, cal_probs: np.ndarray) -> tuple[float, dict]:
    """Select conformal coverage using calibration labels only."""
    best = None
    best_score = -np.inf
    p = normalize_probs(cal_probs)
    for coverage in COVERAGE_GRID:
        threshold = conformal_threshold(y, p, coverage)
        sets = prediction_sets(p, threshold)
        pred, uncertain = selective_decision(p, sets)
        crit = critical_recall(y, pred)
        macro = f1_score(y, pred, average="macro", zero_division=0)
        bal = balanced_accuracy_score(y, pred)
        uncertainty_penalty = float(uncertain.mean())
        score = 0.40 * macro + 0.25 * bal + 0.30 * crit - 0.05 * uncertainty_penalty
        if score > best_score + 1e-12:
            best_score = score
            best = {
                "coverage": float(coverage),
                "threshold": float(threshold),
                "objective": float(score),
                "calibration_coverage": conformal_coverage(y, sets),
                "calibration_critical_recall": float(crit),
                "calibration_macro_f1": float(macro),
                "calibration_balanced_accuracy": float(bal),
                "calibration_uncertain_rate": uncertainty_penalty,
            }
    assert best is not None
    return float(best["coverage"]), best


def fit_fold(train: pd.DataFrame, cal: pd.DataFrame, test: pd.DataFrame, features: list[str]) -> dict:
    model = make_model()
    model.fit(train[features], train[TARGET_COLUMN], sample_weight=class_weights(train[TARGET_COLUMN]), verbose=False)
    cal_raw = normalize_probs(probabilities(model, cal[features]))
    test_raw = normalize_probs(probabilities(model, test[features]))
    y_cal = cal[TARGET_COLUMN].to_numpy(dtype=int)
    y_test = test[TARGET_COLUMN].to_numpy(dtype=int)

    temperature = fit_temperature(y_cal, cal_raw)
    cal_probs = normalize_probs(apply_temperature(cal_raw, temperature))
    test_probs = normalize_probs(apply_temperature(test_raw, temperature))
    coverage, selection = choose_coverage(y_cal, cal_probs)
    threshold = float(selection["threshold"])

    test_sets = prediction_sets(test_probs, threshold)
    test_pred, test_uncertain = selective_decision(test_probs, test_sets)
    argmax_pred = test_probs.argmax(axis=1)
    no_uncertainty = np.zeros(len(test), dtype=bool)

    return {
        "coverage_target": coverage,
        "conformal_threshold": threshold,
        "temperature": float(temperature),
        "selection": selection,
        "test_conformal_coverage": conformal_coverage(y_test, test_sets),
        "test_mean_set_size": float(set_sizes(test_sets).mean()),
        "argmax_test": metrics(y_test, test_probs, argmax_pred, no_uncertainty),
        "conformal_safety_test": metrics(y_test, test_probs, test_pred, test_uncertain),
    }


def main() -> None:
    print("=" * 78)
    print("ORCA-X CONFORMAL UNCERTAINTY + SAFETY BENCHMARK — REFINEMENT 16")
    print("=" * 78)
    print("Selection: mean leave-one-coast-out; Digha excluded from selection")
    print("Calibration: chronological; temperature + conformal quantile fitted only on calibration")
    print("Decision: singleton prediction or conservative critical-class choice; large sets abstain")
    print("Forward horizon: +6h")

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
        train, cal, _ = chronological_split(train_pool)
        test = df[df.location_id == location]
        result = fit_fold(train, cal, test, features)
        folds.append({"location": location, **result})
        m = result["conformal_safety_test"]
        print(
            f"{location:12s} coverage={result['test_conformal_coverage']:.4f} "
            f"set_size={result['test_mean_set_size']:.3f} "
            f"macro_f1={m['macro_f1']:.4f} critical={m['high_extreme_recall']:.4f} "
            f"uncertain={m['uncertain_rate']:.4f} selective_acc={m['selective_accuracy']:.4f}"
        )

    def mean(section: str, key: str) -> float:
        return float(np.mean([f[section][key] for f in folds]))

    summary = {
        "refinement": 16,
        "contract": {
            "source": str(SOURCE_PATH),
            "forward_horizon_hours": 6,
            "holdout_location": HOLDOUT_LOCATION,
            "selection_locations": selection_locations,
            "features": len(features),
            "no_future_features": True,
            "calibration_only_conformal_selection": True,
        },
        "selection_mean": {
            "argmax": {
                "accuracy": mean("argmax_test", "accuracy"),
                "balanced_accuracy": mean("argmax_test", "balanced_accuracy"),
                "macro_f1": mean("argmax_test", "macro_f1"),
                "high_extreme_recall": mean("argmax_test", "high_extreme_recall"),
            },
            "conformal_safety": {
                "accuracy": mean("conformal_safety_test", "accuracy"),
                "balanced_accuracy": mean("conformal_safety_test", "balanced_accuracy"),
                "macro_f1": mean("conformal_safety_test", "macro_f1"),
                "high_extreme_recall": mean("conformal_safety_test", "high_extreme_recall"),
                "conformal_coverage": float(np.mean([f["test_conformal_coverage"] for f in folds])),
                "uncertain_rate": mean("conformal_safety_test", "uncertain_rate"),
                "selective_coverage": mean("conformal_safety_test", "selective_coverage"),
                "selective_accuracy": mean("conformal_safety_test", "selective_accuracy"),
            },
        },
        "folds": folds,
    }

    coverages = np.array([f["coverage_target"] for f in folds], dtype=float)
    thresholds = np.array([f["conformal_threshold"] for f in folds], dtype=float)
    frozen_coverage = float(np.median(coverages))
    frozen_threshold = float(np.median(thresholds))

    non_digha = df[df.location_id != HOLDOUT_LOCATION]
    train, cal, _ = chronological_split(non_digha)
    model = make_model()
    model.fit(train[features], train[TARGET_COLUMN], sample_weight=class_weights(train[TARGET_COLUMN]), verbose=False)
    cal_raw = normalize_probs(probabilities(model, cal[features]))
    temp = fit_temperature(cal[TARGET_COLUMN].to_numpy(dtype=int), cal_raw)
    digha = df[df.location_id == HOLDOUT_LOCATION]
    digha_probs = normalize_probs(apply_temperature(probabilities(model, digha[features]), temp))
    digha_y = digha[TARGET_COLUMN].to_numpy(dtype=int)
    digha_sets = prediction_sets(digha_probs, frozen_threshold)
    digha_pred, digha_uncertain = selective_decision(digha_probs, digha_sets)

    summary["digha_final_audit"] = {
        "temperature": float(temp),
        "frozen_coverage_target": frozen_coverage,
        "frozen_conformal_threshold": frozen_threshold,
        "conformal_coverage": conformal_coverage(digha_y, digha_sets),
        "mean_set_size": float(set_sizes(digha_sets).mean()),
        "metrics": metrics(digha_y, digha_probs, digha_pred, digha_uncertain),
    }

    out_path = OUT_DIR / "refinement16_results.json"
    out_path.write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print("=" * 78)
    print("REFINEMENT 16 COMPLETE")
    print("=" * 78)
    print(json.dumps(summary["selection_mean"], indent=2))
    print("Digha final audit:")
    print(json.dumps(summary["digha_final_audit"], indent=2))
    print(f"Saved: {out_path}")
    print("Production model, policy, thresholds, and source dataset were NOT modified.")


if __name__ == "__main__":
    main()
