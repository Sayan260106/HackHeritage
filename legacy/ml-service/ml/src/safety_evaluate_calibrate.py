"""Safety-oriented evaluation and probability calibration for Refinement 4."""
from __future__ import annotations

import json
from pathlib import Path
import numpy as np
import pandas as pd
from sklearn.calibration import CalibratedClassifierCV
from sklearn.frozen import FrozenEstimator
from sklearn.metrics import accuracy_score, balanced_accuracy_score, brier_score_loss, classification_report, confusion_matrix, f1_score, recall_score, log_loss
from sklearn.preprocessing import label_binarize
from xgboost import XGBClassifier

from config import PROCESSED_DIR, MODELS_DIR, FEATURE_COLUMNS, RISK_HORIZON_HOURS, RISK_CLASS_NAMES
from train import add_dynamic_features

RISK_ORDER = [RISK_CLASS_NAMES[i] for i in range(4)]
HOLDOUT_LOCATION = "digha_wb"
RANDOM_STATE = 42


def severity(row: pd.Series) -> tuple[int, int]:
    wind = pd.to_numeric(row.get("wind_speed_kts"), errors="coerce")
    gust = pd.to_numeric(row.get("wind_gust_kts"), errors="coerce")
    wave = pd.to_numeric(row.get("wave_height_m"), errors="coerce")
    swell = pd.to_numeric(row.get("swell_height_m"), errors="coerce")
    sustained = float(wind) if pd.notna(wind) else 0.0
    gust_value = float(gust) if pd.notna(gust) else 0.0
    sea = max([float(x) for x in (wave, swell) if pd.notna(x)] or [0.0])
    wind_level = 3 if sustained >= 48 else 2 if sustained >= 34 else 1 if sustained >= 25 else 0
    sea_level = 3 if sea >= 6 else 2 if sea >= 4 else 1 if sea >= 1.25 else 0
    if wind_level == 1 and gust_value >= 34:
        wind_level = 2
    return wind_level, sea_level


def small_craft_policy(row: pd.Series) -> int:
    w, s = severity(row)
    if w >= 3 or s >= 3:
        return 3
    if (w >= 2 and s >= 1) or (s >= 2 and w >= 1):
        return 3
    if w >= 2 or s >= 2:
        return 2
    return max(w, s)


def build_target(df: pd.DataFrame) -> pd.DataFrame:
    future = df[["location_id", "timestamp", "wind_speed_kts", "wind_gust_kts", "wave_height_m", "swell_height_m"]].copy()
    observable = future[["wind_speed_kts", "wave_height_m", "swell_height_m"]].notna().any(axis=1)
    future["risk"] = np.nan
    future.loc[observable, "risk"] = future.loc[observable].apply(small_craft_policy, axis=1)
    future["timestamp"] = future["timestamp"] - pd.to_timedelta(int(RISK_HORIZON_HOURS), unit="h")
    target = future[["location_id", "timestamp", "risk"]]
    return df.merge(target, on=["location_id", "timestamp"], how="left").dropna(subset=["risk"]).copy()


def metrics(y, pred, proba=None) -> dict:
    y_arr = np.asarray(y)
    pred_arr = np.asarray(pred)
    high_extreme_true = (y_arr >= 2).astype(int)
    high_extreme_pred = (pred_arr >= 2).astype(int)
    result = {
        "accuracy": float(accuracy_score(y_arr, pred_arr)),
        "balanced_accuracy": float(balanced_accuracy_score(y_arr, pred_arr)),
        "macro_f1": float(f1_score(y_arr, pred_arr, average="macro", zero_division=0)),
        "weighted_f1": float(f1_score(y_arr, pred_arr, average="weighted", zero_division=0)),
        "classification_report": classification_report(y_arr, pred_arr, labels=[0, 1, 2, 3], target_names=RISK_ORDER, output_dict=True, zero_division=0),
        "confusion_matrix": confusion_matrix(y_arr, pred_arr, labels=[0, 1, 2, 3]).tolist(),
        "high_extreme_recall": float(recall_score(high_extreme_true, high_extreme_pred, zero_division=0)),
        "high_extreme_f1": float(f1_score(high_extreme_true, high_extreme_pred, zero_division=0)),
        "rows": int(len(y_arr)),
    }
    if proba is not None:
        y_bin = label_binarize(y_arr, classes=[0, 1, 2, 3])
        result["multiclass_log_loss"] = float(log_loss(y_arr, proba, labels=[0, 1, 2, 3]))
        result["brier_mean"] = float(np.mean([brier_score_loss(y_bin[:, i], proba[:, i]) for i in range(4)]))
    return result


def main() -> None:
    path = PROCESSED_DIR / "orca_historical_marine_risk.parquet"
    df = pd.read_parquet(path)
    df["timestamp"] = pd.to_datetime(df["timestamp"], utc=True)
    df = df.sort_values(["location_id", "timestamp"]).copy()
    df, features = add_dynamic_features(df)
    data = build_target(df)
    data["risk"] = data["risk"].astype(int)
    pool = data[data.location_id != HOLDOUT_LOCATION].sort_values("timestamp")
    digha = data[data.location_id == HOLDOUT_LOCATION]
    n = len(pool)
    a, b = int(n * .70), int(n * .85)
    train, val = pool.iloc[:a], pool.iloc[a:b]
    counts = train.risk.value_counts().sort_index()
    weights = {int(k): float(len(train) / (4 * v)) for k, v in counts.items()}

    base = XGBClassifier(
        objective="multi:softprob", num_class=4, n_estimators=900, learning_rate=.035,
        max_depth=6, min_child_weight=8, subsample=.85, colsample_bytree=.85,
        reg_alpha=.15, reg_lambda=2, gamma=.05, tree_method="hist",
        eval_metric="mlogloss", random_state=RANDOM_STATE, n_jobs=-1,
    )
    base.fit(train[features], train.risk, sample_weight=train.risk.map(weights).to_numpy(dtype=np.float32), verbose=False)

    # Calibration uses the first half of the temporal validation block only.
    cal_cut = int(len(val) * 0.50)
    calibration_df, test_df = val.iloc[:cal_cut], val.iloc[cal_cut:]
    raw_test_proba = base.predict_proba(test_df[features])
    raw_test_pred = raw_test_proba.argmax(axis=1)

    calibrator = CalibratedClassifierCV(FrozenEstimator(base), method="sigmoid")
    calibrator.fit(calibration_df[features], calibration_df.risk)
    cal_proba = calibrator.predict_proba(test_df[features])
    cal_pred = cal_proba.argmax(axis=1)
    digha_proba = calibrator.predict_proba(digha[features])
    digha_pred = digha_proba.argmax(axis=1)

    raw_metrics = metrics(test_df.risk, raw_test_pred, raw_test_proba)
    calibrated_metrics = metrics(test_df.risk, cal_pred, cal_proba)
    digha_metrics = metrics(digha.risk, digha_pred, digha_proba)
    result = {
        "model": "XGBoost + sigmoid probability calibration",
        "risk_policy": "small_craft_conservative",
        "prediction_horizon_hours": int(RISK_HORIZON_HOURS),
        "base_features": FEATURE_COLUMNS,
        "raw_temporal_test": raw_metrics,
        "calibrated_temporal_test": calibrated_metrics,
        "calibrated_digha_holdout": digha_metrics,
        "note": "Calibration is fit only on the first half of the temporal validation block; Digha remains completely unseen during fitting and calibration.",
    }
    out = MODELS_DIR / "safety_calibration_results.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(result, indent=2, default=float), encoding="utf-8")
    print("RAW TEMPORAL TEST:", {k: v for k, v in raw_metrics.items() if k not in {"classification_report", "confusion_matrix"}})
    print("CALIBRATED TEMPORAL TEST:", {k: v for k, v in calibrated_metrics.items() if k not in {"classification_report", "confusion_matrix"}})
    print("CALIBRATED DIGHA HOLDOUT:", {k: v for k, v in digha_metrics.items() if k not in {"classification_report", "confusion_matrix"}})
    print(f"Saved safety/calibration results: {out}")


if __name__ == "__main__":
    main()
