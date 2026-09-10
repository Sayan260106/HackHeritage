"""ORCA-X Refinement 18: future physical-state forecasting benchmark.

Goal
----
Move the prediction problem one level closer to the physics.  Instead of
predicting the +6h operational risk class directly, forecast the continuous
physical variables that drive the operational policy and then apply the
existing policy to the forecasted state.

Strict contract
---------------
* Prediction features are available at t or earlier only.
* Continuous targets are observations at exactly t + 6h.
* Stored contemporaneous risk_class is never a feature or training target.
* Location ID, latitude and longitude are never model features.
* Digha is excluded from model selection and used only for final audit.
* Selection is mean leave-one-coast-out performance.
* Existing production models, policy and source dataset are never modified.

This is benchmark-only.  It deliberately does not claim 98-99% accuracy.
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd
import xgboost as xgb
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score

from config import (
    FEATURE_COLUMNS,
    PROCESSED_DIR,
    RISK_CLASS_NAMES,
    RISK_HORIZON_HOURS,
    TARGET_COLUMN,
)
from label_policy import POLICY_VERSION, assign_operational_risk
from train_future_aligned_model import add_dynamic_features


RANDOM_STATE = 42
HOLDOUT_LOCATION = "digha_wb"
OUT_DIR = Path(__file__).resolve().parents[1] / "models" / "refinement18"
SOURCE_PATH = PROCESSED_DIR / "orca_historical_marine_risk.parquet"

# These are the variables directly used by the current operational risk policy.
# wave_period is included as an additional physical-state diagnostic, even
# though the present policy does not directly threshold it.
FORECAST_TARGETS = [
    "wind_speed_kts",
    "wind_gust_kts",
    "wave_height_m",
    "swell_height_m",
    "wave_period_s",
]

TRIALS = [
    dict(n_estimators=700, learning_rate=0.04, max_depth=4, min_child_weight=8,
         subsample=0.85, colsample_bytree=0.80, reg_alpha=0.10, reg_lambda=2.5),
    dict(n_estimators=900, learning_rate=0.035, max_depth=5, min_child_weight=10,
         subsample=0.80, colsample_bytree=0.80, reg_alpha=0.15, reg_lambda=3.0),
    dict(n_estimators=1000, learning_rate=0.03, max_depth=6, min_child_weight=12,
         subsample=0.75, colsample_bytree=0.75, reg_alpha=0.20, reg_lambda=3.5),
]


def load_source() -> pd.DataFrame:
    if not SOURCE_PATH.exists():
        raise FileNotFoundError(f"Processed dataset not found: {SOURCE_PATH}")
    df = pd.read_parquet(SOURCE_PATH).copy()
    required = ["location_id", "timestamp", *FEATURE_COLUMNS, TARGET_COLUMN, *FORECAST_TARGETS]
    missing = [c for c in required if c not in df.columns]
    if missing:
        raise ValueError(f"Dataset is missing required columns: {missing}")
    df["location_id"] = df["location_id"].astype(str)
    df["timestamp"] = pd.to_datetime(df["timestamp"], utc=True, errors="coerce")
    for c in FEATURE_COLUMNS:
        df[c] = pd.to_numeric(df[c], errors="coerce")
    df = df.dropna(subset=["location_id", "timestamp"])
    if df.duplicated(["location_id", "timestamp"]).any():
        raise ValueError("Duplicate (location_id, timestamp) observations detected.")
    return df.sort_values(["location_id", "timestamp"]).reset_index(drop=True)


def build_forward_pairs(df: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Attach exact t+6h continuous observations to each prediction timestamp."""
    horizon = pd.Timedelta(hours=int(RISK_HORIZON_HOURS))
    future = df[["location_id", "timestamp", *FORECAST_TARGETS]].copy()
    future["timestamp"] = future["timestamp"] - horizon
    future = future.rename(columns={c: f"target_{c}" for c in FORECAST_TARGETS})
    paired = df.merge(future, on=["location_id", "timestamp"], how="left", validate="one_to_one")
    target_ok = paired[[f"target_{c}" for c in FORECAST_TARGETS]].notna().all(axis=1)
    paired = paired[target_ok].copy()
    return paired.reset_index(drop=True), target_ok


def build_features(df: pd.DataFrame) -> tuple[pd.DataFrame, list[str]]:
    """Reuse the leakage-safe Ref13 causal dynamic feature construction."""
    # Remove stored risk target from the feature frame before dynamic construction
    # so it cannot accidentally become a feature if the upstream config changes.
    work = df.drop(columns=[TARGET_COLUMN], errors="ignore").copy()
    work, features = add_dynamic_features(work)
    forbidden = {
        "location_id", "timestamp", TARGET_COLUMN, "future_risk_class",
        "future_risk", "stored_risk_label", "reconstructed_forward_risk",
        "latitude", "longitude",
    }
    features = [c for c in features if c not in forbidden and not c.startswith("target_")]
    return work, list(dict.fromkeys(features))


def regressor(params: dict) -> xgb.XGBRegressor:
    return xgb.XGBRegressor(
        objective="reg:squarederror",
        tree_method="hist",
        eval_metric="rmse",
        random_state=RANDOM_STATE,
        n_jobs=-1,
        **params,
    )


def fit_predict(train: pd.DataFrame, test: pd.DataFrame, features: list[str], params: dict):
    predictions = {}
    models = {}
    for target in FORECAST_TARGETS:
        target_col = f"target_{target}"
        valid = train[target_col].notna()
        model = regressor(params)
        model.fit(train.loc[valid, features], train.loc[valid, target_col], verbose=False)
        predictions[target] = model.predict(test[features])
        models[target] = model
    return predictions, models


def continuous_metrics(test: pd.DataFrame, predictions: dict) -> dict:
    result = {}
    for target in FORECAST_TARGETS:
        y = test[f"target_{target}"].to_numpy(dtype=float)
        p = np.asarray(predictions[target], dtype=float)
        result[target] = {
            "mae": float(mean_absolute_error(y, p)),
            "rmse": float(np.sqrt(mean_squared_error(y, p))),
            "r2": float(r2_score(y, p)) if np.unique(y).size > 1 else 0.0,
        }
    return result


def policy_from_state(row: dict) -> int:
    try:
        return int(assign_operational_risk(pd.Series(row)))
    except Exception:
        return -1


def policy_metrics(test: pd.DataFrame, predictions: dict) -> dict:
    actual = []
    predicted = []
    for i in range(len(test)):
        actual_state = {c: float(test.iloc[i][f"target_{c}"]) for c in FORECAST_TARGETS}
        predicted_state = {c: float(predictions[c][i]) for c in FORECAST_TARGETS}
        a = policy_from_state(actual_state)
        p = policy_from_state(predicted_state)
        if a >= 0 and p >= 0:
            actual.append(a)
            predicted.append(p)
    y = np.asarray(actual, dtype=int)
    p = np.asarray(predicted, dtype=int)
    if len(y) == 0:
        return {"rows": 0}
    cm = np.zeros((4, 4), dtype=int)
    for a, b in zip(y, p):
        cm[a, b] += 1
    recalls = {}
    for cls in range(4):
        denom = cm[cls].sum()
        recalls[RISK_CLASS_NAMES[cls].lower() + "_recall"] = float(cm[cls, cls] / denom) if denom else 0.0
    critical_mask = np.isin(y, [2, 3])
    critical_pred = np.isin(p, [2, 3])
    critical_recall = float((critical_mask & critical_pred).sum() / critical_mask.sum()) if critical_mask.sum() else 0.0
    return {
        "accuracy": float((y == p).mean()),
        "critical_recall": critical_recall,
        **recalls,
        "confusion_matrix": cm.tolist(),
        "rows": int(len(y)),
    }


def evaluate_trial(df: pd.DataFrame, features: list[str], params: dict) -> dict:
    non_digha = df[df.location_id != HOLDOUT_LOCATION].copy().sort_values("timestamp")
    locations = sorted(non_digha.location_id.unique())
    folds = []
    for location in locations:
        train = non_digha[non_digha.location_id != location]
        test = non_digha[non_digha.location_id == location]
        pred, _ = fit_predict(train, test, features, params)
        cm = continuous_metrics(test, pred)
        pm = policy_metrics(test, pred)
        folds.append({"location": location, "continuous": cm, "policy": pm})

    target_keys = ["wind_speed_kts", "wind_gust_kts", "wave_height_m", "swell_height_m", "wave_period_s"]
    mean_mae = float(np.mean([f["continuous"][k]["mae"] for f in folds for k in target_keys]))
    mean_r2 = float(np.mean([f["continuous"][k]["r2"] for f in folds for k in target_keys]))
    mean_acc = float(np.mean([f["policy"]["accuracy"] for f in folds]))
    mean_critical = float(np.mean([f["policy"]["critical_recall"] for f in folds]))
    # Higher is better.  The scale keeps policy quality important while still
    # rewarding genuinely useful continuous forecasts.
    objective = 0.40 * mean_acc + 0.35 * mean_critical + 0.25 * max(-1.0, min(1.0, mean_r2))
    return {
        "objective": float(objective),
        "mean_policy_accuracy": mean_acc,
        "mean_critical_recall": mean_critical,
        "mean_mae": mean_mae,
        "mean_r2": mean_r2,
        "folds": folds,
    }


def temporal_audit(df: pd.DataFrame, features: list[str], params: dict) -> dict:
    """Chronological 82/18 test on all non-Digha coasts."""
    data = df[df.location_id != HOLDOUT_LOCATION].sort_values("timestamp")
    times = np.sort(data.timestamp.unique())
    cut = times[int(len(times) * 0.82)]
    train = data[data.timestamp < cut]
    test = data[data.timestamp >= cut]
    pred, _ = fit_predict(train, test, features, params)
    return {"cutoff": str(cut), "continuous": continuous_metrics(test, pred), "policy": policy_metrics(test, pred)}


def main() -> None:
    print("=" * 78)
    print("ORCA-X FUTURE PHYSICAL-STATE FORECASTING — REFINEMENT 18")
    print("=" * 78)
    print("Selection: mean leave-one-coast-out; Digha excluded from selection")
    print("Targets: exact +6h continuous physical state; risk class reconstructed by policy")
    print("No stored risk label, location ID, latitude, longitude, or future feature is used.")
    print(f"Forward horizon: +{int(RISK_HORIZON_HOURS)}h | policy: {POLICY_VERSION}")

    source = load_source()
    paired, _ = build_forward_pairs(source)
    featured, features = build_features(paired)
    # Keep target columns from the paired frame after feature construction.
    for c in paired.columns:
        if c.startswith("target_"):
            featured[c] = paired[c].to_numpy()
    featured["location_id"] = paired["location_id"].to_numpy()
    featured["timestamp"] = paired["timestamp"].to_numpy()

    print(f"Rows source: {len(source):,} | exact +6h pairs: {len(featured):,}")
    print(f"Locations: {featured.location_id.nunique()} | Features: {len(features)}")
    print(f"Continuous targets: {FORECAST_TARGETS}")

    results = []
    for i, params in enumerate(TRIALS, 1):
        result = evaluate_trial(featured, features, params)
        results.append({"trial": i, "params": params, **result})
        print(
            f"[{i:02d}/{len(TRIALS)}] objective={result['objective']:.5f} "
            f"policy_acc={result['mean_policy_accuracy']:.5f} "
            f"critical_recall={result['mean_critical_recall']:.5f} "
            f"mean_MAE={result['mean_mae']:.5f} mean_R2={result['mean_r2']:.5f}"
        )

    best = max(results, key=lambda x: x["objective"])
    temporal = temporal_audit(featured, features, best["params"])

    train = featured[featured.location_id != HOLDOUT_LOCATION]
    digha = featured[featured.location_id == HOLDOUT_LOCATION]
    digha_pred, _ = fit_predict(train, digha, features, best["params"])
    digha_audit = {
        "continuous": continuous_metrics(digha, digha_pred),
        "policy": policy_metrics(digha, digha_pred),
    }

    report = {
        "refinement": 18,
        "contract": {
            "prediction_time": "t",
            "target_time": f"t+{int(RISK_HORIZON_HOURS)}h",
            "continuous_targets": FORECAST_TARGETS,
            "risk_class_is_reconstructed_after_forecast": True,
            "stored_risk_label_used": False,
            "future_features_used": False,
            "location_id_used_as_feature": False,
            "latitude_used_as_feature": False,
            "longitude_used_as_feature": False,
            "digha_used_for_selection": False,
            "production_modified": False,
        },
        "rows": int(len(featured)),
        "features": features,
        "trials": results,
        "best": best,
        "temporal": temporal,
        "digha_final_audit": digha_audit,
        "interpretation": {
            "purpose": "Test whether forecasting future physical state is more informative than directly classifying future risk.",
            "98_99_accuracy_claim": "Not assumed. Any such claim requires genuine held-out evidence.",
        },
    }

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    (OUT_DIR / "refinement18_results.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    (OUT_DIR / "best_physical_state_config.json").write_text(json.dumps(best["params"], indent=2), encoding="utf-8")

    print("=" * 78)
    print("REFINEMENT 18 COMPLETE")
    print("=" * 78)
    print(json.dumps({
        "best_trial": best["trial"],
        "mean_policy_accuracy": best["mean_policy_accuracy"],
        "mean_critical_recall": best["mean_critical_recall"],
        "mean_mae": best["mean_mae"],
        "mean_r2": best["mean_r2"],
        "temporal_policy_accuracy": temporal["policy"]["accuracy"],
        "temporal_critical_recall": temporal["policy"]["critical_recall"],
        "digha_policy_accuracy": digha_audit["policy"]["accuracy"],
        "digha_critical_recall": digha_audit["policy"]["critical_recall"],
    }, indent=2))
    print(f"Saved: {OUT_DIR / 'refinement18_results.json'}")
    print(f"Saved: {OUT_DIR / 'best_physical_state_config.json'}")
    print("Production model, risk policy, thresholds, and source dataset were NOT modified.")


if __name__ == "__main__":
    main()
