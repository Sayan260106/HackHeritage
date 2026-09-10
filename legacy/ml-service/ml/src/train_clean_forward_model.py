"""ORCA-X Refinement 12: clean forward-target model benchmark.

Trains/evaluates XGBoost only against the clean +6h target reconstructed in
Refinement 11. This script is intentionally benchmark-only: it never writes
or modifies production model/policy/threshold artifacts.

Evaluation contract
-------------------
* Features are point-in-time features from t only.
* Target is the reconstructed operational policy at t+6h.
* Stored contemporaneous risk labels are ignored.
* Digha is excluded from model selection and used only as a final audit.
* Cross-coast scores are leave-one-location-out.
* No location ID, latitude, longitude, future feature, or target-derived field
  is admitted as a model feature.
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd
import xgboost as xgb
from sklearn.metrics import accuracy_score, balanced_accuracy_score, confusion_matrix, f1_score

from config import FEATURE_COLUMNS, RISK_CLASS_NAMES, TARGET_COLUMN, RISK_HORIZON_HOURS
from label_policy import POLICY_VERSION

RANDOM_STATE = 42
HOLDOUT_LOCATION = "digha_wb"
OUT_DIR = Path(__file__).resolve().parents[1] / "models" / "refinement12"
SOURCE_PATH = Path(__file__).resolve().parents[1] / "models" / "refinement11" / "clean_forward_target.parquet"
RISK_ORDER = [RISK_CLASS_NAMES[i] for i in range(4)]

TRIALS = [
    dict(n_estimators=700, learning_rate=0.04, max_depth=5, min_child_weight=10, subsample=0.80, colsample_bytree=0.80, reg_alpha=0.15, reg_lambda=2.0, gamma=0.0),
    dict(n_estimators=900, learning_rate=0.035, max_depth=6, min_child_weight=8, subsample=0.85, colsample_bytree=0.85, reg_alpha=0.15, reg_lambda=2.0, gamma=0.05),
    dict(n_estimators=1000, learning_rate=0.03, max_depth=7, min_child_weight=12, subsample=0.75, colsample_bytree=0.75, reg_alpha=0.25, reg_lambda=3.0, gamma=0.05),
    dict(n_estimators=800, learning_rate=0.04, max_depth=4, min_child_weight=8, subsample=0.85, colsample_bytree=0.85, reg_alpha=0.10, reg_lambda=2.5, gamma=0.0),
]


def load_clean() -> pd.DataFrame:
    if not SOURCE_PATH.exists():
        raise FileNotFoundError(f"Run Refinement 11 first: {SOURCE_PATH}")
    df = pd.read_parquet(SOURCE_PATH).copy()
    forbidden = {"location_id", "timestamp", TARGET_COLUMN, "future_risk_class", "future_risk", "stored_risk_label", "reconstructed_forward_risk"}
    missing = [c for c in ["location_id", "timestamp", TARGET_COLUMN, *FEATURE_COLUMNS] if c not in df.columns]
    if missing:
        raise ValueError(f"Clean target dataset is missing required columns: {missing}")
    features = [c for c in FEATURE_COLUMNS if c not in forbidden]
    if len(features) != len(FEATURE_COLUMNS):
        raise ValueError("Target/location fields unexpectedly overlap with FEATURE_COLUMNS.")
    for c in features:
        df[c] = pd.to_numeric(df[c], errors="coerce")
    df[TARGET_COLUMN] = pd.to_numeric(df[TARGET_COLUMN], errors="coerce")
    df["timestamp"] = pd.to_datetime(df["timestamp"], utc=True, errors="coerce")
    df = df.dropna(subset=["location_id", "timestamp", TARGET_COLUMN]).copy()
    df[TARGET_COLUMN] = df[TARGET_COLUMN].astype(int)
    if sorted(df[TARGET_COLUMN].unique().tolist()) != [0, 1, 2, 3]:
        raise ValueError("Clean forward target must contain all four classes.")
    return df.sort_values(["location_id", "timestamp"]).reset_index(drop=True)


def add_features(df: pd.DataFrame) -> tuple[pd.DataFrame, list[str]]:
    out = df.copy()
    features = list(FEATURE_COLUMNS)
    engineered = []
    for col in FEATURE_COLUMNS:
        name = f"{col}_missing"
        out[name] = out[col].isna().astype(np.int8)
        engineered.append(name)
    for col, prefix in [("wind_direction_deg", "wind"), ("wave_direction_deg", "wave"), ("swell_direction_deg", "swell")]:
        radians = np.deg2rad(out[col])
        out[f"{prefix}_direction_sin"] = np.sin(radians)
        out[f"{prefix}_direction_cos"] = np.cos(radians)
        engineered += [f"{prefix}_direction_sin", f"{prefix}_direction_cos"]
    eps = 0.1
    out["gust_excess_kts"] = out["wind_gust_kts"] - out["wind_speed_kts"]
    out["gust_to_wind_ratio"] = out["wind_gust_kts"] / out["wind_speed_kts"].clip(lower=eps)
    out["gust_above_gale_kts"] = (out["wind_gust_kts"] - 34.0).clip(lower=0)
    out["gust_above_extreme_kts"] = (out["wind_gust_kts"] - 48.0).clip(lower=0)
    engineered += ["gust_excess_kts", "gust_to_wind_ratio", "gust_above_gale_kts", "gust_above_extreme_kts"]
    return out, features + engineered


def class_weights(y: pd.Series) -> np.ndarray:
    counts = y.value_counts().to_dict()
    weights = {int(k): float(len(y) / (4 * v)) for k, v in counts.items()}
    return y.map(weights).to_numpy(dtype=np.float32)


def metrics(y: pd.Series, pred: np.ndarray) -> dict:
    return {
        "accuracy": float(accuracy_score(y, pred)),
        "balanced_accuracy": float(balanced_accuracy_score(y, pred)),
        "macro_f1": float(f1_score(y, pred, average="macro", zero_division=0)),
        "weighted_f1": float(f1_score(y, pred, average="weighted", zero_division=0)),
        "low_recall": float(f1_recall(y, pred, 0)),
        "moderate_recall": float(f1_recall(y, pred, 1)),
        "high_recall": float(f1_recall(y, pred, 2)),
        "extreme_recall": float(f1_recall(y, pred, 3)),
        "high_extreme_recall": float(binary_recall(y.to_numpy(), pred, {2, 3})),
        "confusion_matrix": confusion_matrix(y, pred, labels=[0, 1, 2, 3]).tolist(),
        "rows": int(len(y)),
    }


def f1_recall(y: pd.Series, pred: np.ndarray, cls: int) -> float:
    yt = (y.to_numpy() == cls).astype(int)
    yp = (pred == cls).astype(int)
    denom = int(yt.sum())
    return float(((yt & (yp == 1)).sum()) / denom) if denom else 0.0


def binary_recall(y: np.ndarray, pred: np.ndarray, classes: set[int]) -> float:
    yt = np.isin(y, list(classes))
    yp = np.isin(pred, list(classes))
    return float((yt & yp).sum() / yt.sum()) if yt.sum() else 0.0


def make_model(params: dict) -> xgb.XGBClassifier:
    return xgb.XGBClassifier(objective="multi:softprob", num_class=4, tree_method="hist", eval_metric="mlogloss", random_state=RANDOM_STATE, n_jobs=-1, **params)


def evaluate_candidate(df: pd.DataFrame, features: list[str], params: dict) -> tuple[dict, dict, dict]:
    non_digha = df[df.location_id != HOLDOUT_LOCATION].sort_values("timestamp")
    unique_times = np.sort(non_digha["timestamp"].unique())
    cut = unique_times[int(len(unique_times) * 0.82)]
    train = non_digha[non_digha.timestamp < cut]
    validation = non_digha[non_digha.timestamp >= cut]
    digha = df[df.location_id == HOLDOUT_LOCATION]
    model = make_model(params)
    model.fit(train[features], train[TARGET_COLUMN], sample_weight=class_weights(train[TARGET_COLUMN]), verbose=False)
    temporal = metrics(validation[TARGET_COLUMN], model.predict(validation[features]).astype(int))
    digha_metrics = metrics(digha[TARGET_COLUMN], model.predict(digha[features]).astype(int))
    fold_metrics = []
    locations = sorted(df.location_id.unique())
    for location in locations:
        tr = df[df.location_id != location]
        te = df[df.location_id == location]
        fold = make_model(params)
        fold.fit(tr[features], tr[TARGET_COLUMN], sample_weight=class_weights(tr[TARGET_COLUMN]), verbose=False)
        fold_metrics.append({"location": location, **metrics(te[TARGET_COLUMN], fold.predict(te[features]).astype(int))})
    mean = {k: float(np.mean([f[k] for f in fold_metrics])) for k in ["accuracy", "balanced_accuracy", "macro_f1", "weighted_f1", "high_recall", "extreme_recall", "high_extreme_recall"]}
    mean["folds"] = fold_metrics
    objective = 0.45 * mean["macro_f1"] + 0.30 * mean["balanced_accuracy"] + 0.25 * mean["high_extreme_recall"]
    result = {"objective": float(objective), "mean": mean, "temporal": temporal, "digha_final_audit": digha_metrics}
    return result, temporal, digha_metrics


def main() -> None:
    print("=" * 78)
    print("ORCA-X CLEAN FORWARD-TARGET MODEL BENCHMARK — REFINEMENT 12")
    print("=" * 78)
    print("Selection: mean leave-one-coast-out score; Digha excluded from selection")
    print("No production model, policy, thresholds, or source dataset are modified.")
    print(f"Forward horizon: +{int(RISK_HORIZON_HOURS)}h | policy: {POLICY_VERSION}")
    df = load_clean()
    df, features = add_features(df)
    print(f"Rows: {len(df):,} | Locations: {df.location_id.nunique()} | Features: {len(features)}")
    print(f"Target: {TARGET_COLUMN} | distribution: {df[TARGET_COLUMN].value_counts().sort_index().to_dict()}")

    results = []
    for i, params in enumerate(TRIALS, 1):
        result, _, _ = evaluate_candidate(df, features, params)
        results.append({"trial": i, "params": params, **result})
        print(f"[{i:02d}/{len(TRIALS)}] objective={result['objective']:.5f} macro_f1={result['mean']['macro_f1']:.5f} bal_acc={result['mean']['balanced_accuracy']:.5f} HIGH+EXTREME={result['mean']['high_extreme_recall']:.5f} Digha_macro={result['digha_final_audit']['macro_f1']:.5f}")

    best = max(results, key=lambda r: r["objective"])
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    report = {
        "refinement": 12,
        "contract": {"target": "Refinement 11 clean forward target", "horizon_hours": int(RISK_HORIZON_HOURS), "stored_label_used": False, "future_features_used": False, "location_id_used": False, "digha_used_for_selection": False},
        "rows": int(len(df)), "locations": sorted(df.location_id.unique().tolist()), "features": features,
        "trials": results, "best": best,
        "98_99_claim": {"accuracy_98": best["mean"]["accuracy"] >= 0.98, "accuracy_99": best["mean"]["accuracy"] >= 0.99, "interpretation": "Only genuine held-out evidence can support a 98-99% claim."},
    }
    (OUT_DIR / "refinement12_results.json").write_text(json.dumps(report, indent=2, default=float), encoding="utf-8")
    (OUT_DIR / "best_clean_forward_config.json").write_text(json.dumps(best, indent=2, default=float), encoding="utf-8")
    print("\n" + "=" * 78)
    print("BEST REFINEMENT 12 CANDIDATE")
    print("=" * 78)
    print(json.dumps(best, indent=2, default=float))
    print(f"Saved: {OUT_DIR / 'refinement12_results.json'}")
    print(f"Saved: {OUT_DIR / 'best_clean_forward_config.json'}")
    print("Production model, policy, thresholds, and source dataset were NOT modified.")


if __name__ == "__main__":
    main()
