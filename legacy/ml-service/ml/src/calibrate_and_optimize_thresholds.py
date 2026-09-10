"""ORCA-X Refinement 4C: probability calibration + safety thresholds.

Selection uses temporal validation only. Digha is never used to select
thresholds; it is evaluated afterward as a spatial generalization audit.
No production model is overwritten.
"""
from __future__ import annotations

import json
from pathlib import Path
import sys

import numpy as np
import pandas as pd
from sklearn.isotonic import IsotonicRegression
from sklearn.metrics import accuracy_score, balanced_accuracy_score, f1_score, recall_score
import xgboost as xgb

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "ml" / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

from config import MODELS_DIR, TARGET_COLUMN
from train import HOLDOUT_LOCATION, add_dynamic_features, class_weights, load_dataset

RANDOM_STATE = 42
TUNED_PARAMS = {
    "n_estimators": 1000, "learning_rate": 0.05, "max_depth": 6,
    "min_child_weight": 12, "subsample": 0.75, "colsample_bytree": 0.75,
    "reg_alpha": 0.15, "reg_lambda": 1.0, "gamma": 0.0,
}
CLASS_AWARE_MULTIPLIERS = {0: 0.95, 1: 1.15, 2: 1.20, 3: 1.80}
OUT = MODELS_DIR / "tuning" / "calibration"


def make_model(params: dict) -> xgb.XGBClassifier:
    return xgb.XGBClassifier(objective="multi:softprob", num_class=4, tree_method="hist", eval_metric="mlogloss", random_state=RANDOM_STATE, n_jobs=-1, **params)


def fit_model(train_df, features, params, multipliers):
    model = make_model(params)
    weights = class_weights(train_df[TARGET_COLUMN])
    weights = {k: v * multipliers.get(k, 1.0) for k, v in weights.items()}
    model.fit(train_df[features], train_df[TARGET_COLUMN], sample_weight=train_df[TARGET_COLUMN].map(weights).to_numpy(dtype=np.float32), verbose=False)
    return model


def fit_isotonic(y, raw):
    calibrators = []
    for cls in range(4):
        iso = IsotonicRegression(out_of_bounds="clip", y_min=0.0, y_max=1.0)
        iso.fit(raw[:, cls], (y == cls).astype(float))
        calibrators.append(iso)
    return calibrators


def calibrate(raw, calibrators):
    calibrated = np.column_stack([calibrators[i].predict(raw[:, i]) for i in range(4)])
    calibrated = np.clip(calibrated, 1e-8, None)
    return calibrated / calibrated.sum(axis=1, keepdims=True)


def apply_thresholds(probs, thresholds):
    t_mod, t_high, t_ext = thresholds
    pred = np.argmax(probs, axis=1).astype(int)
    ext = probs[:, 3] >= t_ext
    high = (~ext) & (probs[:, 2] >= t_high)
    moderate = (~ext) & (~high) & (probs[:, 1] >= t_mod)
    pred[ext], pred[high], pred[moderate] = 3, 2, 1
    return pred


def summary(y, pred):
    recalls = recall_score(y, pred, labels=[0, 1, 2, 3], average=None, zero_division=0)
    return {
        "accuracy": float(accuracy_score(y, pred)),
        "balanced_accuracy": float(balanced_accuracy_score(y, pred)),
        "macro_f1": float(f1_score(y, pred, average="macro", zero_division=0)),
        "weighted_f1": float(f1_score(y, pred, average="weighted", zero_division=0)),
        "low_recall": float(recalls[0]), "moderate_recall": float(recalls[1]),
        "high_recall": float(recalls[2]), "extreme_recall": float(recalls[3]),
        "high_extreme_recall": float((recalls[2] + recalls[3]) / 2.0),
    }


def objective(m):
    return 0.45 * m["macro_f1"] + 0.35 * m["balanced_accuracy"] + 0.20 * m["extreme_recall"]


def evaluate_candidate(name, train_df, calibration_df, validation_df, digha, features, params, multipliers):
    model = fit_model(train_df, features, params, multipliers)
    calibrator = fit_isotonic(calibration_df[TARGET_COLUMN].to_numpy(dtype=int), model.predict_proba(calibration_df[features]))
    val_probs = calibrate(model.predict_proba(validation_df[features]), calibrator)
    y_val = validation_df[TARGET_COLUMN].to_numpy(dtype=int)
    argmax_metrics = summary(y_val, np.argmax(val_probs, axis=1))

    floors = {
        "high_recall": argmax_metrics["high_recall"] - 0.005,
        "extreme_recall": argmax_metrics["extreme_recall"] - 0.005,
        "high_extreme_recall": argmax_metrics["high_extreme_recall"] - 0.005,
    }
    best = None
    grid = np.arange(0.20, 0.71, 0.05)
    for tm in grid:
        for th in grid:
            for te in grid:
                if not (tm <= th <= te):
                    continue
                pred = apply_thresholds(val_probs, (float(tm), float(th), float(te)))
                m = summary(y_val, pred)
                if m["high_recall"] < floors["high_recall"] or m["extreme_recall"] < floors["extreme_recall"] or m["high_extreme_recall"] < floors["high_extreme_recall"]:
                    continue
                score = objective(m)
                if best is None or score > best["objective"]:
                    best = {"thresholds": [float(tm), float(th), float(te)], "objective": float(score), "metrics": m}
    if best is None:
        best = {"thresholds": [0.5, 0.5, 0.5], "objective": float(objective(argmax_metrics)), "metrics": argmax_metrics, "fallback": True}

    full_non_digha = pd.concat([train_df, calibration_df, validation_df], ignore_index=True)
    full_model = fit_model(full_non_digha, features, params, multipliers)
    digha_probs = calibrate(full_model.predict_proba(digha[features]), calibrator)
    digha_pred = apply_thresholds(digha_probs, tuple(best["thresholds"]))
    digha_metrics = summary(digha[TARGET_COLUMN].to_numpy(dtype=int), digha_pred)
    return {
        "name": name, "params": params, "class_weight_multipliers": {str(k): v for k, v in multipliers.items()},
        "temporal_argmax": argmax_metrics, "temporal_selected": best, "digha_final_audit": digha_metrics,
        "selection_data": "temporal validation only; Digha excluded",
    }


def main():
    print("=" * 78)
    print("ORCA-X PROBABILITY CALIBRATION + SAFETY THRESHOLD SEARCH — REFINEMENT 4C")
    print("=" * 78)
    print("Digha is reserved for the final spatial audit and is never used for selection.")
    df = load_dataset()
    df, features = add_dynamic_features(df)
    pool = df[df.location_id != HOLDOUT_LOCATION].sort_values("timestamp").copy()
    digha = df[df.location_id == HOLDOUT_LOCATION].copy()
    n = len(pool)
    train_end = int(n * 0.70)
    calibration_end = int(n * 0.85)
    train_df, calibration_df, validation_df = pool.iloc[:train_end].copy(), pool.iloc[train_end:calibration_end].copy(), pool.iloc[calibration_end:].copy()
    print(f"Training rows: {len(train_df):,}")
    print(f"Calibration rows: {len(calibration_df):,}")
    print(f"Temporal validation rows: {len(validation_df):,}")
    print(f"Digha rows: {len(digha):,}")

    candidates = [
        ("trial12_calibrated", TUNED_PARAMS, {0: 1.0, 1: 1.0, 2: 1.0, 3: 1.0}),
        ("trial14_class_aware_calibrated", TUNED_PARAMS, CLASS_AWARE_MULTIPLIERS),
    ]
    results = []
    for candidate in candidates:
        name, params, multipliers = candidate
        print(f"\nEvaluating {name}...")
        result = evaluate_candidate(name, train_df, calibration_df, validation_df, digha, features, params, multipliers)
        results.append(result)
        print(json.dumps({"name": name, "temporal_argmax": result["temporal_argmax"], "selected": result["temporal_selected"], "digha": result["digha_final_audit"]}, indent=2))

    best = max(results, key=lambda r: r["temporal_selected"]["objective"])
    OUT.mkdir(parents=True, exist_ok=True)
    payload = {"selection_rule": "maximize 0.45 macro-F1 + 0.35 balanced accuracy + 0.20 EXTREME recall subject to explicit candidate-specific safety floors", "digha_used_for_selection": False, "candidates": results, "best_candidate": best["name"], "features": features}
    (OUT / "calibration_threshold_results.json").write_text(json.dumps(payload, indent=2, default=float), encoding="utf-8")
    (OUT / "best_calibration_threshold_config.json").write_text(json.dumps({"candidate": best["name"], "thresholds": best["temporal_selected"]["thresholds"], "objective": best["temporal_selected"]["objective"]}, indent=2), encoding="utf-8")
    print("\n" + "=" * 78)
    print("BEST CALIBRATED + THRESHOLD CANDIDATE")
    print("=" * 78)
    print(json.dumps({"candidate": best["name"], "thresholds": best["temporal_selected"]["thresholds"], "temporal": best["temporal_selected"], "digha_final_audit": best["digha_final_audit"]}, indent=2))
    print(f"Saved: {OUT / 'calibration_threshold_results.json'}")
    print(f"Saved: {OUT / 'best_calibration_threshold_config.json'}")
    print("Production model was NOT modified.")


if __name__ == "__main__":
    main()
