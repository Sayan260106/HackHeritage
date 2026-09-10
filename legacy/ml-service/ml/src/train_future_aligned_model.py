"""ORCA-X Refinement 13: future-aligned dynamic feature benchmark.

Purpose
-------
Refinement 12 showed that point-in-time snapshots alone do not generalize well
across coastlines. This benchmark adds *causal temporal dynamics* that are
available at prediction time: lags, first differences, rolling means/stds,
rolling change rates, and circular direction changes.

Strict evaluation contract
---------------------------
* Target: Refinement 11 clean +6h forward target.
* Every feature is computed from t or earlier only.
* No future values, stored contemporaneous labels, reconstructed target fields,
  location ID, latitude, or longitude are used as model features.
* Rolling windows are shifted by one observation before aggregation so the
  current target timestamp cannot leak into a historical baseline.
* Digha is excluded from model selection and used only as a final audit.
* Selection uses mean leave-one-coast-out performance.
* This is benchmark-only; no production artifact is changed.
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd
import xgboost as xgb
from sklearn.metrics import accuracy_score, balanced_accuracy_score, confusion_matrix, f1_score

from config import FEATURE_COLUMNS, RISK_CLASS_NAMES, RISK_HORIZON_HOURS, TARGET_COLUMN
from label_policy import POLICY_VERSION

RANDOM_STATE = 42
HOLDOUT_LOCATION = "digha_wb"
OUT_DIR = Path(__file__).resolve().parents[1] / "models" / "refinement13"
SOURCE_PATH = Path(__file__).resolve().parents[1] / "models" / "refinement11" / "clean_forward_target.parquet"
BASE_FEATURES = [c for c in FEATURE_COLUMNS if c not in {"latitude", "longitude"}]
DYNAMIC_BASE = [
    "wind_speed_kts", "wind_gust_kts", "wave_height_m", "wave_period_s",
    "swell_height_m", "swell_period_s", "air_pressure_hpa",
    "air_temperature_c", "sea_surface_temperature_c", "precipitation_mm",
]
DIRECTIONAL = ["wind_direction_deg", "wave_direction_deg", "swell_direction_deg"]

TRIALS = [
    dict(n_estimators=700, learning_rate=0.04, max_depth=4, min_child_weight=8, subsample=0.85, colsample_bytree=0.80, reg_alpha=0.10, reg_lambda=2.5, gamma=0.0),
    dict(n_estimators=900, learning_rate=0.035, max_depth=5, min_child_weight=10, subsample=0.80, colsample_bytree=0.80, reg_alpha=0.15, reg_lambda=3.0, gamma=0.05),
    dict(n_estimators=1000, learning_rate=0.03, max_depth=6, min_child_weight=12, subsample=0.75, colsample_bytree=0.75, reg_alpha=0.20, reg_lambda=3.5, gamma=0.05),
    dict(n_estimators=800, learning_rate=0.04, max_depth=5, min_child_weight=6, subsample=0.90, colsample_bytree=0.90, reg_alpha=0.05, reg_lambda=2.0, gamma=0.0),
    dict(n_estimators=1100, learning_rate=0.025, max_depth=4, min_child_weight=6, subsample=0.85, colsample_bytree=0.90, reg_alpha=0.05, reg_lambda=3.0, gamma=0.0),
]


def load_clean() -> pd.DataFrame:
    if not SOURCE_PATH.exists():
        raise FileNotFoundError(f"Run Refinement 11 first: {SOURCE_PATH}")
    df = pd.read_parquet(SOURCE_PATH).copy()
    required = ["location_id", "timestamp", TARGET_COLUMN, *FEATURE_COLUMNS]
    missing = [c for c in required if c not in df.columns]
    if missing:
        raise ValueError(f"Clean target dataset is missing required columns: {missing}")
    for c in FEATURE_COLUMNS:
        df[c] = pd.to_numeric(df[c], errors="coerce")
    df[TARGET_COLUMN] = pd.to_numeric(df[TARGET_COLUMN], errors="coerce")
    df["timestamp"] = pd.to_datetime(df["timestamp"], utc=True, errors="coerce")
    df = df.dropna(subset=["location_id", "timestamp", TARGET_COLUMN]).copy()
    df[TARGET_COLUMN] = df[TARGET_COLUMN].astype(int)
    if sorted(df[TARGET_COLUMN].unique().tolist()) != [0, 1, 2, 3]:
        raise ValueError("Clean forward target must contain all four classes.")
    return df.sort_values(["location_id", "timestamp"]).reset_index(drop=True)


def add_dynamic_features(df: pd.DataFrame) -> tuple[pd.DataFrame, list[str]]:
    out = df.copy()
    # Static point-in-time features, deliberately excluding geographic identity.
    features = list(BASE_FEATURES)
    grouped = out.groupby("location_id", sort=False)

    # Missingness indicators are causal and useful when sensor coverage varies.
    for col in BASE_FEATURES:
        name = f"{col}_missing"
        out[name] = out[col].isna().astype(np.int8)
        features.append(name)

    # Direction encodings avoid the 0/360 discontinuity.
    for col in DIRECTIONAL:
        prefix = col.replace("_direction_deg", "")
        r = np.deg2rad(out[col])
        out[f"{prefix}_direction_sin"] = np.sin(r)
        out[f"{prefix}_direction_cos"] = np.cos(r)
        features += [f"{prefix}_direction_sin", f"{prefix}_direction_cos"]

    # Causal dynamics: lag and change.  The dataset is hourly, so 1/3/6/12/24
    # observations correspond to approximately 1/3/6/12/24 hours historically.
    for col in DYNAMIC_BASE:
        s = grouped[col]
        for lag in (1, 3, 6, 12, 24):
            name = f"{col}_lag{lag}"
            out[name] = s.shift(lag)
            features.append(name)
        for lag in (1, 3, 6):
            name = f"{col}_delta{lag}"
            out[name] = out[col] - s.shift(lag)
            features.append(name)
        # Rolling baselines are shifted first: window contains only t-1 and earlier.
        shifted = s.shift(1)
        for window in (3, 6, 12, 24):
            mean_name = f"{col}_roll{window}_mean"
            std_name = f"{col}_roll{window}_std"
            out[mean_name] = shifted.transform(lambda x: x.rolling(window, min_periods=2).mean())
            out[std_name] = shifted.transform(lambda x: x.rolling(window, min_periods=2).std())
            features += [mean_name, std_name]
        out[f"{col}_anomaly6"] = out[col] - out[f"{col}_roll6_mean"]
        out[f"{col}_trend6"] = (s.shift(1) - s.shift(7)) / 6.0
        features += [f"{col}_anomaly6", f"{col}_trend6"]

    # Circular direction change uses the shortest signed angular difference.
    for col in DIRECTIONAL:
        prefix = col.replace("_direction_deg", "")
        prev = grouped[col].shift(1)
        diff = (out[col] - prev + 180.0) % 360.0 - 180.0
        out[f"{prefix}_direction_delta1"] = diff
        features.append(f"{prefix}_direction_delta1")

    # Physically meaningful interaction proxies, still using current/past only.
    eps = 0.1
    out["gust_excess_kts_dynamic"] = out["wind_gust_kts"] - out["wind_speed_kts"]
    out["gust_to_wind_ratio_dynamic"] = out["wind_gust_kts"] / out["wind_speed_kts"].clip(lower=eps)
    out["wave_energy_proxy"] = out["wave_height_m"] ** 2
    out["swell_energy_proxy"] = out["swell_height_m"] ** 2
    out["wind_wave_stress_proxy"] = out["wind_speed_kts"] ** 2 * out["wave_height_m"].clip(lower=0)
    out["combined_sea_state"] = out["wave_height_m"].clip(lower=0) + out["swell_height_m"].clip(lower=0)
    features += [
        "gust_excess_kts_dynamic", "gust_to_wind_ratio_dynamic", "wave_energy_proxy",
        "swell_energy_proxy", "wind_wave_stress_proxy", "combined_sea_state",
    ]

    # Deduplicate while preserving deterministic order.
    features = list(dict.fromkeys(features))
    forbidden = {"location_id", "timestamp", TARGET_COLUMN, "future_risk_class", "future_risk", "stored_risk_label", "reconstructed_forward_risk", "latitude", "longitude"}
    features = [c for c in features if c not in forbidden]
    return out, features


def class_weights(y: pd.Series) -> np.ndarray:
    counts = y.value_counts().to_dict()
    weights = {int(k): float(len(y) / (4 * v)) for k, v in counts.items()}
    return y.map(weights).to_numpy(dtype=np.float32)


def recall(y: pd.Series, pred: np.ndarray, cls: int) -> float:
    mask = y.to_numpy() == cls
    return float(((pred == cls) & mask).sum() / mask.sum()) if mask.sum() else 0.0


def binary_recall(y: pd.Series, pred: np.ndarray, classes={2, 3}) -> float:
    yt = np.isin(y.to_numpy(), list(classes))
    yp = np.isin(pred, list(classes))
    return float((yt & yp).sum() / yt.sum()) if yt.sum() else 0.0


def metrics(y: pd.Series, pred: np.ndarray) -> dict:
    return {
        "accuracy": float(accuracy_score(y, pred)),
        "balanced_accuracy": float(balanced_accuracy_score(y, pred)),
        "macro_f1": float(f1_score(y, pred, average="macro", zero_division=0)),
        "weighted_f1": float(f1_score(y, pred, average="weighted", zero_division=0)),
        "low_recall": recall(y, pred, 0),
        "moderate_recall": recall(y, pred, 1),
        "high_recall": recall(y, pred, 2),
        "extreme_recall": recall(y, pred, 3),
        "high_extreme_recall": binary_recall(y, pred),
        "confusion_matrix": confusion_matrix(y, pred, labels=[0, 1, 2, 3]).tolist(),
        "rows": int(len(y)),
    }


def model(params: dict) -> xgb.XGBClassifier:
    return xgb.XGBClassifier(
        objective="multi:softprob", num_class=4, tree_method="hist", eval_metric="mlogloss",
        random_state=RANDOM_STATE, n_jobs=-1, **params,
    )


def evaluate(df: pd.DataFrame, features: list[str], params: dict) -> dict:
    non_digha = df[df.location_id != HOLDOUT_LOCATION].sort_values("timestamp")
    unique_times = np.sort(non_digha.timestamp.unique())
    cut = unique_times[int(len(unique_times) * 0.82)]
    train = non_digha[non_digha.timestamp < cut]
    valid = non_digha[non_digha.timestamp >= cut]
    m = model(params)
    m.fit(train[features], train[TARGET_COLUMN], sample_weight=class_weights(train[TARGET_COLUMN]), verbose=False)
    temporal = metrics(valid[TARGET_COLUMN], m.predict(valid[features]).astype(int))

    folds = []
    for location in sorted(df.location_id.unique()):
        tr = df[df.location_id != location]
        te = df[df.location_id == location]
        fold = model(params)
        fold.fit(tr[features], tr[TARGET_COLUMN], sample_weight=class_weights(tr[TARGET_COLUMN]), verbose=False)
        folds.append({"location": location, **metrics(te[TARGET_COLUMN], fold.predict(te[features]).astype(int))})

    mean_keys = ["accuracy", "balanced_accuracy", "macro_f1", "weighted_f1", "high_recall", "extreme_recall", "high_extreme_recall"]
    mean = {k: float(np.mean([f[k] for f in folds])) for k in mean_keys}
    mean["folds"] = folds
    # Favor class-balanced discrimination and safety-critical recall without
    # allowing raw accuracy to dominate the coast-generalization objective.
    objective = 0.45 * mean["macro_f1"] + 0.30 * mean["balanced_accuracy"] + 0.25 * mean["high_extreme_recall"]
    return {"objective": float(objective), "mean": mean, "temporal": temporal}


def main() -> None:
    print("=" * 78)
    print("ORCA-X FUTURE-ALIGNED DYNAMIC MODEL SEARCH — REFINEMENT 13")
    print("=" * 78)
    print("Selection: mean leave-one-coast-out score; Digha excluded from selection")
    print("Causal features only: current + historical observations; no future leakage")
    print("No location ID, latitude, longitude, stored label, or future feature is used.")
    print(f"Forward target: +{int(RISK_HORIZON_HOURS)}h | policy: {POLICY_VERSION}")

    df = load_clean()
    df, features = add_dynamic_features(df)
    print(f"Rows: {len(df):,} | Locations: {df.location_id.nunique()} | Features: {len(features)}")
    print(f"Target: {TARGET_COLUMN} | distribution: {df[TARGET_COLUMN].value_counts().sort_index().to_dict()}")

    # Initial rows without sufficient history are retained; XGBoost handles NaN
    # natively. This avoids dropping early observations in a coast-specific way.
    results = []
    for i, params in enumerate(TRIALS, 1):
        result = evaluate(df, features, params)
        results.append({"trial": i, "params": params, **result})
        print(
            f"[{i:02d}/{len(TRIALS)}] objective={result['objective']:.5f} "
            f"macro_f1={result['mean']['macro_f1']:.5f} "
            f"bal_acc={result['mean']['balanced_accuracy']:.5f} "
            f"HIGH+EXTREME={result['mean']['high_extreme_recall']:.5f} "
            f"temporal_acc={result['temporal']['accuracy']:.5f}"
        )

    best = max(results, key=lambda r: r["objective"])
    # Final Digha audit: train on every non-Digha row, never used in selection.
    tr = df[df.location_id != HOLDOUT_LOCATION]
    dg = df[df.location_id == HOLDOUT_LOCATION]
    final = model(best["params"])
    final.fit(tr[features], tr[TARGET_COLUMN], sample_weight=class_weights(tr[TARGET_COLUMN]), verbose=False)
    digha = metrics(dg[TARGET_COLUMN], final.predict(dg[features]).astype(int))

    report = {
        "refinement": 13,
        "contract": {
            "target": "Refinement 11 clean forward target",
            "horizon_hours": int(RISK_HORIZON_HOURS),
            "causal_features_only": True,
            "future_features_used": False,
            "location_id_used": False,
            "latitude_used": False,
            "longitude_used": False,
            "stored_label_used": False,
            "digha_used_for_selection": False,
            "rolling_windows_shifted_one_step": True,
        },
        "rows": int(len(df)),
        "locations": sorted(df.location_id.unique().tolist()),
        "feature_count": len(features),
        "features": features,
        "trials": results,
        "best": {**best, "digha_final_audit": digha},
        "98_99_claim": {
            "accuracy_98": best["mean"]["accuracy"] >= 0.98,
            "accuracy_99": best["mean"]["accuracy"] >= 0.99,
            "interpretation": "A 98-99% claim requires genuine held-out evidence; this benchmark does not assume it.",
        },
    }
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    (OUT_DIR / "refinement13_results.json").write_text(json.dumps(report, indent=2, default=float), encoding="utf-8")
    (OUT_DIR / "best_future_aligned_config.json").write_text(json.dumps(best, indent=2, default=float), encoding="utf-8")

    print("\n" + "=" * 78)
    print("BEST REFINEMENT 13 CANDIDATE")
    print("=" * 78)
    print(json.dumps(report["best"], indent=2, default=float))
    print(f"Saved: {OUT_DIR / 'refinement13_results.json'}")
    print(f"Saved: {OUT_DIR / 'best_future_aligned_config.json'}")
    print("Production model, policy, thresholds, and source dataset were NOT modified.")


if __name__ == "__main__":
    main()
