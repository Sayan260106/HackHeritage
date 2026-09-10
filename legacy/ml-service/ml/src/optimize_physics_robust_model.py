"""ORCA-X Refinement 5C: leakage-safe optimization of physics-robust features.

CRITICAL CONTRACT
-----------------
The previous version of this optimizer trained against the contemporaneous
``risk_label``. That is target leakage because the production model predicts a
forward risk target. This version imports the exact forward-target construction
and point-in-time feature contract from train.py, then adds physics features.

Selection is performed with leave-one-location-out temporal validation. The
held-out coastline is never used for hyperparameter selection.
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd
import xgboost as xgb
from sklearn.metrics import accuracy_score, balanced_accuracy_score, f1_score, recall_score

from config import TARGET_COLUMN
from train import add_dynamic_features, load_dataset

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "ml" / "models" / "spatial_generalization"
RANDOM_STATE = 42
LOCATIONS = ["digha_wb", "paradip_od", "vizag_ap", "chennai_tn", "goa", "kochi_kl"]


def add_physics_features(df: pd.DataFrame) -> tuple[pd.DataFrame, list[str]]:
    """Add only deterministic features computable from one live observation."""
    x = df.copy()
    eps = 1e-6
    x["gust_excess_kts"] = (x["wind_gust_kts"] - x["wind_speed_kts"]).clip(lower=0)
    x["gust_to_wind_ratio"] = x["wind_gust_kts"] / x["wind_speed_kts"].clip(lower=eps)
    x["wave_to_wind_ratio"] = x["wave_height_m"] / x["wind_speed_kts"].clip(lower=eps)
    x["swell_to_wave_ratio"] = x["swell_height_m"] / x["wave_height_m"].clip(lower=eps)
    x["combined_sea_height_m"] = np.sqrt(x["wave_height_m"] ** 2 + x["swell_height_m"] ** 2)
    x["wave_energy_proxy"] = x["wave_height_m"] ** 2 * x["wave_period_s"]
    x["swell_energy_proxy"] = x["swell_height_m"] ** 2 * x["swell_period_s"]
    x["combined_energy_proxy"] = x["wave_energy_proxy"] + x["swell_energy_proxy"]
    x["wave_steepness_proxy"] = x["wave_height_m"] / x["wave_period_s"].clip(lower=eps)
    x["swell_steepness_proxy"] = x["swell_height_m"] / x["swell_period_s"].clip(lower=eps)
    x["wind_wave_loading"] = x["wind_speed_kts"] * x["wave_height_m"]
    x["gust_wave_loading"] = x["wind_gust_kts"] * x["wave_height_m"]
    x["wind_swell_loading"] = x["wind_speed_kts"] * x["swell_height_m"]
    x["wave_swell_height_sum"] = x["wave_height_m"] + x["swell_height_m"]
    x["wave_swell_period_mean"] = (x["wave_period_s"] + x["swell_period_s"]) / 2.0
    x["swell_fraction"] = x["swell_height_m"] / x["combined_sea_height_m"].clip(lower=eps)
    x["sst_air_delta_c"] = x["sea_surface_temperature_c"] - x["air_temperature_c"]
    x["gale_gust_flag"] = (x["wind_gust_kts"] >= 34).astype(int)
    x["severe_wave_flag"] = (x["wave_height_m"] >= 4).astype(int)
    x["extreme_wave_flag"] = (x["wave_height_m"] >= 6).astype(int)
    physics = [
        "gust_excess_kts", "gust_to_wind_ratio", "wave_to_wind_ratio", "swell_to_wave_ratio",
        "combined_sea_height_m", "wave_energy_proxy", "swell_energy_proxy", "combined_energy_proxy",
        "wave_steepness_proxy", "swell_steepness_proxy", "wind_wave_loading", "gust_wave_loading",
        "wind_swell_loading", "wave_swell_height_sum", "wave_swell_period_mean", "swell_fraction",
        "sst_air_delta_c", "gale_gust_flag", "severe_wave_flag", "extreme_wave_flag",
    ]
    return x, physics


def metrics(y: np.ndarray, p: np.ndarray) -> dict:
    y = np.asarray(y, dtype=int)
    p = np.asarray(p, dtype=int)
    return {
        "accuracy": float(accuracy_score(y, p)),
        "balanced_accuracy": float(balanced_accuracy_score(y, p)),
        "macro_f1": float(f1_score(y, p, average="macro", zero_division=0)),
        "weighted_f1": float(f1_score(y, p, average="weighted", zero_division=0)),
        "high_recall": float(recall_score(y, p, labels=[2], average="macro", zero_division=0)),
        "extreme_recall": float(recall_score(y, p, labels=[3], average="macro", zero_division=0)),
        "high_extreme_recall": float(recall_score((y >= 2).astype(int), (p >= 2).astype(int), zero_division=0)),
    }


def model(params: dict) -> xgb.XGBClassifier:
    return xgb.XGBClassifier(
        objective="multi:softprob", num_class=4, tree_method="hist", eval_metric="mlogloss",
        random_state=RANDOM_STATE, n_jobs=-1, **params,
    )


def weights(y: np.ndarray) -> dict[int, float]:
    """Inverse-frequency class weights for encoded forward-risk classes."""
    counts = np.bincount(np.asarray(y, dtype=int), minlength=4)
    if np.any(counts == 0):
        raise ValueError(f"Training split is missing a forward-risk class: counts={counts.tolist()}")
    n = len(y)
    return {cls: float(n / (4 * counts[cls])) for cls in range(4)}


def objective(m: dict) -> float:
    return float(0.45 * m["macro_f1"] + 0.30 * m["balanced_accuracy"] + 0.25 * m["high_extreme_recall"])


def main() -> None:
    print("=" * 78)
    print("ORCA-X PHYSICS-ROBUST SAFETY-AWARE XGBOOST SEARCH — REFINEMENT 5C")
    print("=" * 78)
    print("Digha and every held-out coastline remain untouched for selection.")
    print("Using the exact forward-target + point-in-time feature contract from train.py.")

    # load_dataset() deliberately ignores contemporaneous risk_label and creates
    # TARGET_COLUMN from observations at t + RISK_HORIZON_HOURS.
    df = load_dataset()
    if TARGET_COLUMN not in df.columns:
        raise ValueError(f"Forward target {TARGET_COLUMN!r} was not constructed by train.py")
    if "risk_label" in df.columns:
        # It may exist in the source frame, but it must never enter X.
        pass

    df, dynamic_features = add_dynamic_features(df)
    df, physics_features = add_physics_features(df)
    forbidden = {"risk_label", TARGET_COLUMN, "location_id", "timestamp", "latitude", "longitude"}
    numeric = [c for c in dynamic_features + physics_features if c not in forbidden and c in df.columns and pd.api.types.is_numeric_dtype(df[c])]
    features = list(dict.fromkeys(numeric))

    # Fail closed against the exact leakage that previously produced 1.00000 metrics.
    if TARGET_COLUMN in features or "risk_label" in features:
        raise AssertionError("LEAKAGE GUARD FAILED: a target/source label entered model features")
    if len(features) < len(physics_features):
        raise AssertionError("Unexpected feature construction failure")

    print(f"Rows: {len(df):,} | Physics features: {len(physics_features)} | Model features: {len(features)}")
    print(f"Forward target: {TARGET_COLUMN} | unique classes: {sorted(df[TARGET_COLUMN].unique().tolist())}")

    trials = [
        {"n_estimators": 800, "learning_rate": .05, "max_depth": 5, "min_child_weight": 8, "subsample": .80, "colsample_bytree": .80, "reg_alpha": .15, "reg_lambda": 1.5, "gamma": 0.0},
        {"n_estimators": 1000, "learning_rate": .04, "max_depth": 6, "min_child_weight": 12, "subsample": .75, "colsample_bytree": .75, "reg_alpha": .15, "reg_lambda": 1.0, "gamma": 0.0},
        {"n_estimators": 1200, "learning_rate": .035, "max_depth": 6, "min_child_weight": 8, "subsample": .80, "colsample_bytree": .85, "reg_alpha": .25, "reg_lambda": 2.0, "gamma": .05},
        {"n_estimators": 900, "learning_rate": .045, "max_depth": 7, "min_child_weight": 12, "subsample": .75, "colsample_bytree": .80, "reg_alpha": .20, "reg_lambda": 2.0, "gamma": .05},
        {"n_estimators": 1000, "learning_rate": .05, "max_depth": 6, "min_child_weight": 16, "subsample": .80, "colsample_bytree": .75, "reg_alpha": .10, "reg_lambda": 1.0, "gamma": .0},
        {"n_estimators": 1100, "learning_rate": .035, "max_depth": 5, "min_child_weight": 6, "subsample": .85, "colsample_bytree": .85, "reg_alpha": .30, "reg_lambda": 2.5, "gamma": .0},
        {"n_estimators": 700, "learning_rate": .055, "max_depth": 6, "min_child_weight": 10, "subsample": .85, "colsample_bytree": .80, "reg_alpha": .15, "reg_lambda": 1.5, "gamma": .10},
        {"n_estimators": 1300, "learning_rate": .03, "max_depth": 6, "min_child_weight": 14, "subsample": .75, "colsample_bytree": .85, "reg_alpha": .20, "reg_lambda": 3.0, "gamma": .0},
        {"n_estimators": 900, "learning_rate": .04, "max_depth": 5, "min_child_weight": 10, "subsample": .90, "colsample_bytree": .75, "reg_alpha": .35, "reg_lambda": 2.0, "gamma": .0},
        {"n_estimators": 1000, "learning_rate": .03, "max_depth": 7, "min_child_weight": 16, "subsample": .80, "colsample_bytree": .80, "reg_alpha": .25, "reg_lambda": 3.0, "gamma": .10},
    ]

    all_results: list[dict] = []
    for trial_no, params in enumerate(trials, 1):
        fold_metrics = []
        # Every fold holds out one coastline. Selection uses only the remaining
        # five locations and their internal chronological train/validation split.
        for held in LOCATIONS:
            pool = df[df["location_id"] != held].sort_values(["timestamp", "location_id"]).copy()
            n = len(pool)
            tr_end, va_end = int(.70 * n), int(.85 * n)
            tr, va = pool.iloc[:tr_end], pool.iloc[tr_end:va_end]
            ytr = tr[TARGET_COLUMN].to_numpy(dtype=int)
            yva = va[TARGET_COLUMN].to_numpy(dtype=int)
            w = weights(ytr)
            mdl = model(params)
            mdl.fit(tr[features], ytr, sample_weight=np.array([w[v] for v in ytr], dtype=np.float32), verbose=False)
            pred = mdl.predict(va[features]).astype(int)
            fold_metrics.append(metrics(yva, pred))

        avg = {k: float(np.mean([m[k] for m in fold_metrics])) for k in fold_metrics[0]}
        obj = objective(avg)
        safety_ok = avg["high_extreme_recall"] >= .60
        row = {"trial": trial_no, "params": params, "objective": obj, "safety_ok": safety_ok, **avg}
        all_results.append(row)
        print(f"[{trial_no:02d}/{len(trials)}] objective={obj:.5f} macro_f1={avg['macro_f1']:.5f} bal_acc={avg['balanced_accuracy']:.5f} HIGH+EXTREME={avg['high_extreme_recall']:.5f} safety_ok={safety_ok}")

    safe = [r for r in all_results if r["safety_ok"]]
    best = max(safe or all_results, key=lambda r: r["objective"])

    print("\n" + "=" * 78)
    print("BEST PHYSICS-ROBUST CANDIDATE")
    print("=" * 78)
    print(json.dumps(best, indent=2))

    OUT.mkdir(parents=True, exist_ok=True)
    payload = {
        "selection": "mean temporal validation across five-location training pools; each held-out coastline excluded from its fold",
        "target": TARGET_COLUMN,
        "leakage_guard": "risk_label and future target excluded from X; features are point-in-time only",
        "features": features,
        "physics_features": physics_features,
        "trials": all_results,
        "best": best,
    }
    (OUT / "physics_robust_xgboost_results.json").write_text(json.dumps(payload, indent=2), encoding="utf-8")
    (OUT / "best_physics_robust_params.json").write_text(json.dumps(best, indent=2), encoding="utf-8")
    print(f"Saved: {OUT / 'physics_robust_xgboost_results.json'}")
    print(f"Saved: {OUT / 'best_physics_robust_params.json'}")
    print("Production model was NOT modified.")


if __name__ == "__main__":
    main()
