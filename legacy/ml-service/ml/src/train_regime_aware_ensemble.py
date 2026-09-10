"""ORCA-X Refinement 9: regime-aware, coast-generalizing two-stage ensemble.

This is an evaluation-only search. It deliberately does NOT modify production
artifacts. Selection uses leave-one-coast-out evaluation, so the held-out coast
is never used to fit either the regime model or the specialist models.

Architecture:
  1. A 4-class baseline model predicts the complete risk distribution.
  2. A binary severe-weather gate predicts LOW/MODERATE vs HIGH/EXTREME.
  3. Two conditional specialists predict LOW vs MODERATE and HIGH vs EXTREME.
  4. Final probabilities are composed from the gate and specialists.

All features are point-in-time: no future values, stored contemporaneous risk
labels, location ID, latitude, longitude, or hidden historical lag state are
used. The forward +6h target is reconstructed exactly as in train.py.
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
OUT_DIR = Path(__file__).resolve().parents[1] / "models" / "refinement9"

# Never allow geographic identity to become a shortcut.
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
    df = df.dropna(subset=["location_id", "timestamp"]).sort_values(["location_id", "timestamp"]).copy()
    if df.duplicated(["location_id", "timestamp"]).any():
        raise ValueError("Duplicate location/timestamp rows detected")

    # Reconstruct the true operational target at t from observations at t+6h.
    future = df[["location_id", "timestamp", "wind_speed_kts", "wind_gust_kts", "wave_height_m", "swell_height_m"]].copy()
    observable = future[["wind_speed_kts", "wave_height_m", "swell_height_m"]].notna().any(axis=1)
    future["future_risk"] = np.nan
    future.loc[observable, "future_risk"] = future.loc[observable].apply(assign_operational_risk, axis=1)
    future["prediction_timestamp"] = future["timestamp"] - pd.Timedelta(hours=int(RISK_HORIZON_HOURS))
    target = future[["location_id", "prediction_timestamp", "future_risk"]].rename(columns={"prediction_timestamp": "timestamp"})
    df = df.merge(target, on=["location_id", "timestamp"], how="left")
    df[TARGET_COLUMN] = pd.to_numeric(df["future_risk"], errors="coerce")
    df = df.drop(columns=["future_risk"], errors="ignore").dropna(subset=[TARGET_COLUMN]).copy()
    df[TARGET_COLUMN] = df[TARGET_COLUMN].astype(int)
    if df[TARGET_COLUMN].nunique() != 4:
        raise ValueError("Forward target must contain all four risk classes")
    return df


def make_features(df: pd.DataFrame) -> pd.DataFrame:
    x = df[BASE].copy()
    for c in BASE:
        x[f"{c}_missing"] = x[c].isna().astype(np.int8)

    eps = 0.1
    wind = x["wind_speed_kts"]
    gust = x["wind_gust_kts"]
    wave = x["wave_height_m"]
    swell = x["swell_height_m"]

    x["gust_excess_kts"] = gust - wind
    x["gust_to_wind_ratio"] = gust / wind.clip(lower=eps)
    x["gust_above_gale_kts"] = (gust - 34.0).clip(lower=0)
    x["gust_above_extreme_kts"] = (gust - 48.0).clip(lower=0)

    for c, prefix in [("wind_direction_deg", "wind"), ("wave_direction_deg", "wave"), ("swell_direction_deg", "swell")]:
        r = np.deg2rad(x[c])
        x[f"{prefix}_direction_sin"] = np.sin(r)
        x[f"{prefix}_direction_cos"] = np.cos(r)

    # Coast-invariant physical severity coordinates.
    x["wind_caution_fraction"] = wind / 25.0
    x["wind_gale_fraction"] = wind / 34.0
    x["wind_extreme_fraction"] = wind / 48.0
    x["gust_gale_fraction"] = gust / 34.0
    x["gust_extreme_fraction"] = gust / 48.0
    x["wave_rough_fraction"] = wave / 4.0
    x["wave_very_rough_fraction"] = wave / 6.0
    x["swell_heavy_fraction"] = swell / 4.0
    x["wave_swell_ratio"] = wave / swell.clip(lower=eps)
    x["combined_sea_height_m"] = wave + 0.5 * swell
    x["wind_wave_product"] = wind * wave
    x["gust_wave_product"] = gust * wave

    # Regime indicators are thresholds/interactions, not labels.
    x["wind_gale_flag"] = (wind >= 34).astype(np.int8)
    x["wind_extreme_flag"] = (wind >= 48).astype(np.int8)
    x["wave_rough_flag"] = (wave >= 4).astype(np.int8)
    x["wave_very_rough_flag"] = (wave >= 6).astype(np.int8)
    x["swell_heavy_flag"] = (swell >= 4).astype(np.int8)
    x["wind_wave_stress"] = (wind / 34.0) * (wave / 4.0)
    x["gust_wave_stress"] = (gust / 34.0) * (wave / 4.0)
    x["wind_swell_stress"] = (wind / 34.0) * (swell / 4.0)
    x["sea_state_energy_proxy"] = wave.pow(2) + 0.5 * swell.pow(2)
    x["severe_signal_count"] = (
        (wind >= 34).astype(np.int8)
        + (gust >= 34).astype(np.int8)
        + (wave >= 4).astype(np.int8)
        + (swell >= 4).astype(np.int8)
    )
    return x.replace([np.inf, -np.inf], np.nan)


def class_weights(y: pd.Series, classes: list[int]) -> np.ndarray:
    counts = y.value_counts().to_dict()
    n = len(y)
    k = len(classes)
    mapping = {int(c): n / (k * max(1, counts.get(c, 1))) for c in classes}
    return y.map(mapping).to_numpy(dtype=np.float32)


def binary_weights(y: pd.Series) -> np.ndarray:
    return class_weights(y, [0, 1])


def fit_multiclass(Xtr, ytr, params):
    model = xgb.XGBClassifier(
        objective="multi:softprob", num_class=4, eval_metric="mlogloss",
        tree_method="hist", random_state=RANDOM_STATE, n_jobs=-1, **params,
    )
    model.fit(Xtr, ytr, sample_weight=class_weights(ytr, [0, 1, 2, 3]), verbose=False)
    return model


def fit_binary(Xtr, ytr, params):
    model = xgb.XGBClassifier(
        objective="binary:logistic", eval_metric="logloss", tree_method="hist",
        random_state=RANDOM_STATE, n_jobs=-1, **params,
    )
    model.fit(Xtr, ytr, sample_weight=binary_weights(ytr), verbose=False)
    return model


def compose_predictions(Xtr, ytr, Xte, params, gate_bias: float) -> np.ndarray:
    """Train a gate + two specialists and return normalized 4-class probabilities."""
    gate_y = ytr.isin([2, 3]).astype(int)
    gate = fit_binary(Xtr, gate_y, params)
    p_severe = np.clip(gate.predict_proba(Xte)[:, 1] + gate_bias, 1e-5, 1 - 1e-5)

    nonsev = ytr.isin([0, 1])
    sev = ytr.isin([2, 3])
    lowmod = fit_binary(Xtr.loc[nonsev], ytr.loc[nonsev].map({0: 0, 1: 1}), params)
    highex = fit_binary(Xtr.loc[sev], ytr.loc[sev].map({2: 0, 3: 1}), params)

    p_mod = lowmod.predict_proba(Xte)[:, 1]
    p_ext = highex.predict_proba(Xte)[:, 1]
    probs = np.column_stack([
        (1 - p_severe) * (1 - p_mod),
        (1 - p_severe) * p_mod,
        p_severe * (1 - p_ext),
        p_severe * p_ext,
    ])
    return probs / probs.sum(axis=1, keepdims=True)


def metrics(y: pd.Series, pred: np.ndarray) -> dict:
    yt = y.to_numpy()
    severe = np.isin(yt, [2, 3])
    return {
        "accuracy": float(accuracy_score(yt, pred)),
        "balanced_accuracy": float(balanced_accuracy_score(yt, pred)),
        "macro_f1": float(f1_score(yt, pred, average="macro", zero_division=0)),
        "weighted_f1": float(f1_score(yt, pred, average="weighted", zero_division=0)),
        "low_recall": float(((pred == 0) & (yt == 0)).sum() / max(1, (yt == 0).sum())),
        "moderate_recall": float(((pred == 1) & (yt == 1)).sum() / max(1, (yt == 1).sum())),
        "high_recall": float(((pred == 2) & (yt == 2)).sum() / max(1, (yt == 2).sum())),
        "extreme_recall": float(((pred == 3) & (yt == 3)).sum() / max(1, (yt == 3).sum())),
        "high_extreme_recall": float((severe & np.isin(pred, [2, 3])).sum() / max(1, severe.sum())),
    }


def candidate_params() -> list[dict]:
    base = dict(max_depth=6, min_child_weight=10, subsample=.8, colsample_bytree=.8, reg_alpha=.15, reg_lambda=2.0, gamma=0.0)
    return [
        {**base, "n_estimators": 700, "learning_rate": .04},
        {**base, "n_estimators": 900, "learning_rate": .035, "max_depth": 5, "min_child_weight": 8},
        {**base, "n_estimators": 800, "learning_rate": .045, "max_depth": 7, "min_child_weight": 12, "reg_alpha": .2},
    ]


def main() -> None:
    print("=" * 78)
    print("ORCA-X REGIME-AWARE TWO-STAGE ENSEMBLE SEARCH — REFINEMENT 9")
    print("=" * 78)
    print("Selection: mean leave-one-coast-out score | no production changes")
    print("No location ID, latitude, longitude, future values, or stored risk label is used.")
    df = load_forward_dataset()
    X = make_features(df)
    y = df[TARGET_COLUMN]
    print(f"Rows: {len(df):,} | Locations: {df.location_id.nunique()} | Features: {X.shape[1]}")
    print(f"Forward target: {TARGET_COLUMN} | horizon: +{int(RISK_HORIZON_HOURS)}h")

    results = []
    for i, params in enumerate(candidate_params(), 1):
        folds = []
        # A tiny gate bias sweep is performed only inside each training fold's
        # validation data; here we use fixed conservative values to avoid a
        # second selection layer and preserve a clean LOO protocol.
        for loc in LOCATIONS:
            tr = df.location_id != loc
            te = ~tr
            probs = compose_predictions(X.loc[tr], y.loc[tr], X.loc[te], params, gate_bias=0.0)
            pred = probs.argmax(axis=1).astype(int)
            fold = metrics(y.loc[te], pred)
            fold["location"] = loc
            folds.append(fold)

        mean = {k: float(np.mean([f[k] for f in folds])) for k in folds[0] if k != "location"}
        worst = {
            "macro_f1": float(min(f["macro_f1"] for f in folds)),
            "balanced_accuracy": float(min(f["balanced_accuracy"] for f in folds)),
            "high_extreme_recall": float(min(f["high_extreme_recall"] for f in folds)),
        }
        objective = .40 * mean["macro_f1"] + .30 * mean["balanced_accuracy"] + .20 * mean["high_extreme_recall"] + .10 * worst["macro_f1"]
        safety_ok = mean["high_extreme_recall"] >= .60 and mean["extreme_recall"] >= .45 and worst["high_extreme_recall"] >= .35
        row = {"trial": i, "params": params, "objective": objective, "safety_ok": safety_ok, "mean": mean, "worst": worst, "folds": folds}
        results.append(row)
        print(f"[{i:02d}/{len(candidate_params())}] objective={objective:.5f} macro_f1={mean['macro_f1']:.5f} bal_acc={mean['balanced_accuracy']:.5f} HIGH+EXTREME={mean['high_extreme_recall']:.5f} worst_macro={worst['macro_f1']:.5f} safety_ok={safety_ok}")

    valid = [r for r in results if r["safety_ok"]]
    best = max(valid or results, key=lambda r: r["objective"])
    print("\n" + "=" * 78)
    print("BEST REFINEMENT 9 CANDIDATE")
    print("=" * 78)
    print(json.dumps(best, indent=2))

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    payload = {
        "policy": POLICY_VERSION,
        "horizon_hours": int(RISK_HORIZON_HOURS),
        "architecture": "severity_gate + low_moderate specialist + high_extreme specialist",
        "features": list(X.columns),
        "geographic_features_excluded": ["location_id", "latitude", "longitude"],
        "results": results,
        "best": best,
    }
    (OUT_DIR / "refinement9_results.json").write_text(json.dumps(payload, indent=2), encoding="utf-8")
    (OUT_DIR / "best_refinement9_config.json").write_text(json.dumps(best["params"], indent=2), encoding="utf-8")
    print(f"Saved: {OUT_DIR / 'refinement9_results.json'}")
    print(f"Saved: {OUT_DIR / 'best_refinement9_config.json'}")
    print("Production model was NOT modified.")


if __name__ == "__main__":
    main()
