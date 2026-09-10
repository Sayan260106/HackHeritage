"""ORCA-X Refinement 6: leave-one-coast-out generalization search.

Selection is based on average held-out-coast performance. No production files
are modified. The contemporaneous dataset label is ignored; the target is the
same +6h forward operational risk target used by train.py.
"""
from __future__ import annotations

import json
from pathlib import Path
import numpy as np
import pandas as pd
import xgboost as xgb
from sklearn.metrics import accuracy_score, balanced_accuracy_score, f1_score

from config import FEATURE_COLUMNS, PROCESSED_DIR, RISK_CLASS_NAMES, RISK_HORIZON_HOURS, TARGET_COLUMN
from label_policy import assign_operational_risk, POLICY_VERSION

RANDOM_STATE = 42
LOCATIONS = ["digha_wb", "paradip_od", "vizag_ap", "chennai_tn", "goa", "kochi_kl"]
OUT_DIR = Path(__file__).resolve().parents[1] / "models" / "spatial_generalization"

# Deliberately geo-neutral: no location id, latitude or longitude.
BASE = [c for c in FEATURE_COLUMNS if c not in {"latitude", "longitude"}]


def load_forward_dataset() -> pd.DataFrame:
    path = PROCESSED_DIR / "orca_historical_marine_risk.parquet"
    if not path.exists():
        raise FileNotFoundError(f"Dataset not found: {path}")
    df = pd.read_parquet(path).copy()
    required = ["location_id", "timestamp", *FEATURE_COLUMNS, TARGET_COLUMN]
    missing = [c for c in required if c not in df.columns]
    if missing:
        raise ValueError(f"Missing required columns: {missing}")
    df["timestamp"] = pd.to_datetime(df["timestamp"], utc=True, errors="coerce")
    for c in FEATURE_COLUMNS:
        df[c] = pd.to_numeric(df[c], errors="coerce")
    df = df.dropna(subset=["location_id", "timestamp"]).sort_values(["location_id", "timestamp"])
    if df.duplicated(["location_id", "timestamp"]).any():
        raise ValueError("Duplicate location/timestamp rows detected")

    # Target is calculated at t from observations at t+6h, without using the
    # stored contemporaneous risk label.
    future = df[["location_id", "timestamp", "wind_speed_kts", "wind_gust_kts", "wave_height_m", "swell_height_m"]].copy()
    future["future_risk"] = future.apply(assign_operational_risk, axis=1)
    future["timestamp"] = future["timestamp"] - pd.Timedelta(hours=int(RISK_HORIZON_HOURS))
    target = future[["location_id", "timestamp", "future_risk"]]
    df = df.merge(target, on=["location_id", "timestamp"], how="left")
    df[TARGET_COLUMN] = pd.to_numeric(df["future_risk"], errors="coerce")
    df = df.drop(columns=["future_risk"]).dropna(subset=[TARGET_COLUMN]).copy()
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
    # Physics-normalized, location-independent quantities.
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


def weights(y: pd.Series) -> np.ndarray:
    counts = y.value_counts().to_dict()
    return y.map({int(k): len(y) / (4.0 * v) for k, v in counts.items()}).to_numpy(dtype=np.float32)


def metrics(y: pd.Series, pred: np.ndarray) -> dict:
    severe = np.isin(y.to_numpy(), [2, 3])
    severe_pred = np.isin(pred, [2, 3])
    return {
        "accuracy": float(accuracy_score(y, pred)),
        "balanced_accuracy": float(balanced_accuracy_score(y, pred)),
        "macro_f1": float(f1_score(y, pred, average="macro", zero_division=0)),
        "weighted_f1": float(f1_score(y, pred, average="weighted", zero_division=0)),
        "high_recall": float(((pred == 2) & (y.to_numpy() == 2)).sum() / max(1, (y.to_numpy() == 2).sum())),
        "extreme_recall": float(((pred == 3) & (y.to_numpy() == 3)).sum() / max(1, (y.to_numpy() == 3).sum())),
        "high_extreme_recall": float((severe & severe_pred).sum() / max(1, severe.sum())),
    }


def candidate_params() -> list[dict]:
    return [
        {"n_estimators": 700, "learning_rate": .04, "max_depth": 5, "min_child_weight": 8, "subsample": .8, "colsample_bytree": .8, "reg_alpha": .15, "reg_lambda": 2},
        {"n_estimators": 900, "learning_rate": .035, "max_depth": 6, "min_child_weight": 10, "subsample": .8, "colsample_bytree": .8, "reg_alpha": .2, "reg_lambda": 2},
        {"n_estimators": 800, "learning_rate": .045, "max_depth": 6, "min_child_weight": 12, "subsample": .75, "colsample_bytree": .8, "reg_alpha": .2, "reg_lambda": 2},
        {"n_estimators": 1000, "learning_rate": .03, "max_depth": 7, "min_child_weight": 12, "subsample": .75, "colsample_bytree": .75, "reg_alpha": .25, "reg_lambda": 3},
        {"n_estimators": 800, "learning_rate": .05, "max_depth": 5, "min_child_weight": 12, "subsample": .75, "colsample_bytree": .75, "reg_alpha": .15, "reg_lambda": 1.5},
    ]


def main() -> None:
    print("=" * 78)
    print("ORCA-X CROSS-COAST GENERALIZATION SEARCH — REFINEMENT 6")
    print("=" * 78)
    print("Selection: mean leave-one-coast-out score | no production changes")
    df = load_forward_dataset()
    X = make_features(df)
    y = df[TARGET_COLUMN]
    print(f"Rows: {len(df):,} | Locations: {df.location_id.nunique()} | Features: {X.shape[1]}")
    results = []
    for i, params in enumerate(candidate_params(), 1):
        folds = []
        for loc in LOCATIONS:
            train_mask = df.location_id != loc
            test_mask = ~train_mask
            model = xgb.XGBClassifier(objective="multi:softprob", num_class=4, eval_metric="mlogloss", tree_method="hist", random_state=RANDOM_STATE, n_jobs=-1, **params)
            model.fit(X.loc[train_mask], y.loc[train_mask], sample_weight=weights(y.loc[train_mask]), verbose=False)
            fold = metrics(y.loc[test_mask], model.predict(X.loc[test_mask]).astype(int))
            fold["location"] = loc
            folds.append(fold)
        mean = {k: float(np.mean([f[k] for f in folds])) for k in folds[0] if k != "location"}
        # Safety-aware but primarily generalization-focused objective.
        objective = .45 * mean["macro_f1"] + .30 * mean["balanced_accuracy"] + .25 * mean["high_extreme_recall"]
        safety_ok = mean["high_extreme_recall"] >= .60 and mean["extreme_recall"] >= .45
        row = {"trial": i, "params": params, "objective": objective, "safety_ok": safety_ok, "mean": mean, "folds": folds}
        results.append(row)
        print(f"[{i:02d}/{len(candidate_params())}] objective={objective:.5f} macro_f1={mean['macro_f1']:.5f} bal_acc={mean['balanced_accuracy']:.5f} HIGH+EXTREME={mean['high_extreme_recall']:.5f} safety_ok={safety_ok}")
    valid = [r for r in results if r["safety_ok"]]
    best = max(valid or results, key=lambda r: r["objective"])
    print("\n" + "=" * 78)
    print("BEST CROSS-COAST CANDIDATE")
    print("=" * 78)
    print(json.dumps(best, indent=2))
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    (OUT_DIR / "cross_coast_results.json").write_text(json.dumps({"policy": POLICY_VERSION, "horizon_hours": int(RISK_HORIZON_HOURS), "features": list(X.columns), "results": results, "best": best}, indent=2), encoding="utf-8")
    (OUT_DIR / "best_cross_coast_config.json").write_text(json.dumps(best["params"], indent=2), encoding="utf-8")
    print(f"Saved: {OUT_DIR / 'cross_coast_results.json'}")
    print(f"Saved: {OUT_DIR / 'best_cross_coast_config.json'}")
    print("Production model was NOT modified.")


if __name__ == "__main__":
    main()
