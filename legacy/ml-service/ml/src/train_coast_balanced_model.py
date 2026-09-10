"""ORCA-X Refinement 8: coast-balanced robust XGBoost search.

The goal is genuine cross-coast generalization, not a better score on one
coast. Each leave-one-coast-out fold trains without the held-out coastline.
Within the training pool, coast weights prevent large/label-heavy coastlines
from dominating, while a tunable class component protects HIGH/EXTREME.

No production model, policy, calibration, or thresholds are modified.
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd
import xgboost as xgb
from sklearn.metrics import accuracy_score, balanced_accuracy_score, f1_score

from config import FEATURE_COLUMNS, PROCESSED_DIR, RISK_CLASS_NAMES, RISK_HORIZON_HOURS, TARGET_COLUMN
from label_policy import POLICY_VERSION, assign_operational_risk

RANDOM_STATE = 42
LOCATIONS = ["digha_wb", "paradip_od", "vizag_ap", "chennai_tn", "goa", "kochi_kl"]
OUT_DIR = Path(__file__).resolve().parents[1] / "models" / "spatial_generalization" / "coast_balanced"
BASE = [c for c in FEATURE_COLUMNS if c not in {"latitude", "longitude"}]


def load_forward_dataset() -> pd.DataFrame:
    path = PROCESSED_DIR / "orca_historical_marine_risk.parquet"
    if not path.exists():
        raise FileNotFoundError(f"Dataset not found: {path}\nRun prepare_dataset.py first.")
    df = pd.read_parquet(path).copy()
    required = ["location_id", "timestamp", *FEATURE_COLUMNS]
    missing = [c for c in required if c not in df.columns]
    if missing:
        raise ValueError(f"Missing required columns: {missing}")
    df["timestamp"] = pd.to_datetime(df["timestamp"], utc=True, errors="coerce")
    for c in FEATURE_COLUMNS:
        df[c] = pd.to_numeric(df[c], errors="coerce")
    df = df.dropna(subset=["location_id", "timestamp"]).sort_values(["location_id", "timestamp"])
    if df.duplicated(["location_id", "timestamp"]).any():
        raise ValueError("Duplicate location/timestamp rows detected")

    future = df[["location_id", "timestamp", "wind_speed_kts", "wind_gust_kts", "wave_height_m", "swell_height_m"]].copy()
    future[TARGET_COLUMN] = future.apply(assign_operational_risk, axis=1)
    future["timestamp"] = future["timestamp"] - pd.to_timedelta(RISK_HORIZON_HOURS, unit="h")
    target = future[["location_id", "timestamp", TARGET_COLUMN]]
    df = df.merge(target, on=["location_id", "timestamp"], how="left", suffixes=("", "_future"))
    df[TARGET_COLUMN] = pd.to_numeric(df[f"{TARGET_COLUMN}_future"], errors="coerce")
    df = df.drop(columns=[f"{TARGET_COLUMN}_future"]).dropna(subset=[TARGET_COLUMN]).copy()
    df[TARGET_COLUMN] = df[TARGET_COLUMN].astype(int)
    return df


def make_features(df: pd.DataFrame) -> pd.DataFrame:
    x = df[BASE].copy()
    for c in BASE:
        x[f"{c}_missing"] = x[c].isna().astype(np.int8)
    eps = 0.1
    x["gust_excess_kts"] = x["wind_gust_kts"] - x["wind_speed_kts"]
    x["gust_to_wind_ratio"] = x["wind_gust_kts"] / x["wind_speed_kts"].clip(lower=eps)
    x["gust_above_gale_kts"] = (x["wind_gust_kts"] - 34).clip(lower=0)
    x["gust_above_extreme_kts"] = (x["wind_gust_kts"] - 48).clip(lower=0)
    for c, p in [("wind_direction_deg", "wind"), ("wave_direction_deg", "wave"), ("swell_direction_deg", "swell")]:
        r = np.deg2rad(x[c])
        x[f"{p}_direction_sin"] = np.sin(r)
        x[f"{p}_direction_cos"] = np.cos(r)
    x["wind_caution_fraction"] = x["wind_speed_kts"] / 25.0
    x["wind_gale_fraction"] = x["wind_speed_kts"] / 34.0
    x["wind_extreme_fraction"] = x["wind_speed_kts"] / 48.0
    x["wave_rough_fraction"] = x["wave_height_m"] / 4.0
    x["wave_very_rough_fraction"] = x["wave_height_m"] / 6.0
    x["swell_heavy_fraction"] = x["swell_height_m"] / 4.0
    x["wave_swell_ratio"] = x["wave_height_m"] / x["swell_height_m"].clip(lower=0.1)
    x["combined_sea_height_m"] = x["wave_height_m"] + 0.5 * x["swell_height_m"]
    x["wind_wave_product"] = x["wind_speed_kts"] * x["wave_height_m"]
    x["gust_wave_product"] = x["wind_gust_kts"] * x["wave_height_m"]
    return x


def sample_weights(train: pd.DataFrame, class_power: float, coast_power: float) -> np.ndarray:
    """Blend coast balancing and class balancing with a controlled exponent.

    Coast weights make each coastline contribute approximately equally.
    Class weights are computed globally within the training pool and softened
    by class_power, avoiding the extreme amplification of naive inverse class
    frequency. The final vector is normalized to mean 1 for stable XGBoost.
    """
    coast_counts = train["location_id"].value_counts()
    coast_w = train["location_id"].map({k: (1.0 / v) ** coast_power for k, v in coast_counts.items()})
    class_counts = train[TARGET_COLUMN].value_counts()
    class_w = train[TARGET_COLUMN].map({k: (1.0 / v) ** class_power for k, v in class_counts.items()})
    w = (coast_w * class_w).to_numpy(dtype=np.float64)
    w /= np.mean(w)
    return w.astype(np.float32)


def metrics(y: pd.Series, pred: np.ndarray) -> dict:
    yt = y.to_numpy(dtype=int)
    severe = np.isin(yt, [2, 3])
    severe_pred = np.isin(pred, [2, 3])
    return {
        "accuracy": float(accuracy_score(yt, pred)),
        "balanced_accuracy": float(balanced_accuracy_score(yt, pred)),
        "macro_f1": float(f1_score(yt, pred, average="macro", zero_division=0)),
        "weighted_f1": float(f1_score(yt, pred, average="weighted", zero_division=0)),
        "low_recall": float(((pred == 0) & (yt == 0)).sum() / max(1, (yt == 0).sum())),
        "moderate_recall": float(((pred == 1) & (yt == 1)).sum() / max(1, (yt == 1).sum())),
        "high_recall": float(((pred == 2) & (yt == 2)).sum() / max(1, (yt == 2).sum())),
        "extreme_recall": float(((pred == 3) & (yt == 3)).sum() / max(1, (yt == 3).sum())),
        "high_extreme_recall": float((severe & severe_pred).sum() / max(1, severe.sum())),
    }


def candidate_configs() -> list[dict]:
    return [
        {"n_estimators": 700, "learning_rate": .04, "max_depth": 5, "min_child_weight": 10, "subsample": .8, "colsample_bytree": .8, "reg_alpha": .15, "reg_lambda": 2.0, "gamma": 0.0, "class_power": .50, "coast_power": 1.00},
        {"n_estimators": 850, "learning_rate": .035, "max_depth": 6, "min_child_weight": 12, "subsample": .8, "colsample_bytree": .8, "reg_alpha": .20, "reg_lambda": 2.5, "gamma": 0.05, "class_power": .50, "coast_power": 1.00},
        {"n_estimators": 900, "learning_rate": .035, "max_depth": 6, "min_child_weight": 12, "subsample": .75, "colsample_bytree": .8, "reg_alpha": .20, "reg_lambda": 3.0, "gamma": 0.05, "class_power": .35, "coast_power": 1.00},
        {"n_estimators": 900, "learning_rate": .03, "max_depth": 7, "min_child_weight": 14, "subsample": .75, "colsample_bytree": .75, "reg_alpha": .25, "reg_lambda": 3.0, "gamma": 0.05, "class_power": .35, "coast_power": .85},
        {"n_estimators": 1000, "learning_rate": .03, "max_depth": 6, "min_child_weight": 15, "subsample": .8, "colsample_bytree": .75, "reg_alpha": .30, "reg_lambda": 3.5, "gamma": 0.10, "class_power": .25, "coast_power": .85},
        {"n_estimators": 800, "learning_rate": .045, "max_depth": 5, "min_child_weight": 12, "subsample": .75, "colsample_bytree": .8, "reg_alpha": .20, "reg_lambda": 2.5, "gamma": 0.0, "class_power": .35, "coast_power": .70},
    ]


def main() -> None:
    print("=" * 78)
    print("ORCA-X COAST-BALANCED ROBUST XGBOOST SEARCH — REFINEMENT 8")
    print("=" * 78)
    print("Selection: mean leave-one-coast-out score | all held-out coasts untouched")
    print("No production model, risk policy, calibration, or thresholds are modified.")
    df = load_forward_dataset()
    X = make_features(df)
    y = df[TARGET_COLUMN]
    print(f"Rows: {len(df):,} | Locations: {df.location_id.nunique()} | Features: {X.shape[1]}")
    results = []
    configs = candidate_configs()
    for i, cfg in enumerate(configs, 1):
        model_params = {k: v for k, v in cfg.items() if k not in {"class_power", "coast_power"}}
        folds = []
        for loc in LOCATIONS:
            train_mask = df.location_id != loc
            test_mask = ~train_mask
            train = df.loc[train_mask]
            model = xgb.XGBClassifier(
                objective="multi:softprob", num_class=4, eval_metric="mlogloss",
                tree_method="hist", random_state=RANDOM_STATE, n_jobs=-1,
                **model_params,
            )
            model.fit(X.loc[train_mask], y.loc[train_mask], sample_weight=sample_weights(train, cfg["class_power"], cfg["coast_power"]), verbose=False)
            fold = metrics(y.loc[test_mask], model.predict(X.loc[test_mask]).astype(int))
            fold["location"] = loc
            folds.append(fold)
        mean = {k: float(np.mean([f[k] for f in folds])) for k in folds[0] if k != "location"}
        worst = {"macro_f1": float(min(f["macro_f1"] for f in folds)), "balanced_accuracy": float(min(f["balanced_accuracy"] for f in folds)), "high_extreme_recall": float(min(f["high_extreme_recall"] for f in folds))}
        # Generalization-first objective: mean performance dominates, with
        # explicit penalties for a weak coastline and unsafe severe recall.
        objective = (0.35 * mean["macro_f1"] + 0.25 * mean["balanced_accuracy"] + 0.20 * mean["high_extreme_recall"] + 0.10 * worst["macro_f1"] + 0.10 * worst["balanced_accuracy"])
        safety_ok = mean["high_extreme_recall"] >= 0.60 and mean["extreme_recall"] >= 0.45 and worst["high_extreme_recall"] >= 0.35
        result = {"trial": i, "config": cfg, "objective": objective, "safety_ok": safety_ok, "mean": mean, "worst": worst, "folds": folds}
        results.append(result)
        print(f"[{i:02d}/{len(configs)}] objective={objective:.5f} macro_f1={mean['macro_f1']:.5f} bal_acc={mean['balanced_accuracy']:.5f} HIGH+EXTREME={mean['high_extreme_recall']:.5f} worst_macro={worst['macro_f1']:.5f} safety_ok={safety_ok}")

    valid = [r for r in results if r["safety_ok"]]
    best = max(valid or results, key=lambda r: r["objective"])
    print("\n" + "=" * 78)
    print("BEST COAST-BALANCED CANDIDATE")
    print("=" * 78)
    print(json.dumps(best, indent=2))
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    payload = {"policy_version": POLICY_VERSION, "horizon_hours": int(RISK_HORIZON_HOURS), "features": list(X.columns), "risk_classes": RISK_CLASS_NAMES, "results": results, "best": best}
    (OUT_DIR / "coast_balanced_results.json").write_text(json.dumps(payload, indent=2), encoding="utf-8")
    (OUT_DIR / "best_coast_balanced_config.json").write_text(json.dumps(best["config"], indent=2), encoding="utf-8")
    print(f"Saved: {OUT_DIR / 'coast_balanced_results.json'}")
    print(f"Saved: {OUT_DIR / 'best_coast_balanced_config.json'}")
    print("Production model was NOT modified.")


if __name__ == "__main__":
    main()
