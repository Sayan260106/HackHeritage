"""Constrained safety threshold selection for calibrated ORCA-X probabilities."""
from __future__ import annotations

import json
import numpy as np
import pandas as pd
from sklearn.calibration import CalibratedClassifierCV
from sklearn.frozen import FrozenEstimator
from sklearn.metrics import precision_score, recall_score, f1_score, balanced_accuracy_score
from xgboost import XGBClassifier

from config import PROCESSED_DIR, MODELS_DIR, FEATURE_COLUMNS, RISK_HORIZON_HOURS
from train import add_dynamic_features

HOLDOUT_LOCATION = "digha_wb"
RANDOM_STATE = 42
GRID = np.arange(0.30, 0.951, 0.025)
MIN_RECALL = 0.90
MIN_PRECISION = 0.70
MAX_ESCALATION = 0.60


def small_craft_policy(row: pd.Series) -> int:
    wind = float(row["wind_speed_kts"]) if pd.notna(row.get("wind_speed_kts")) else 0.0
    gust = float(row["wind_gust_kts"]) if pd.notna(row.get("wind_gust_kts")) else 0.0
    wave = float(row["wave_height_m"]) if pd.notna(row.get("wave_height_m")) else 0.0
    swell = float(row["swell_height_m"]) if pd.notna(row.get("swell_height_m")) else 0.0
    wind_level = 3 if wind >= 48 else 2 if wind >= 34 else 1 if wind >= 25 else 0
    sea_level = 3 if wave >= 6 else 2 if wave >= 4 else 1 if max(wave, swell) >= 1.25 else 0
    if wind_level == 1 and gust >= 34:
        wind_level = 2
    if wind_level >= 3 or sea_level >= 3:
        return 3
    if (wind_level >= 2 and sea_level >= 1) or (sea_level >= 2 and wind_level >= 1):
        return 3
    if wind_level >= 2 or sea_level >= 2:
        return 2
    return max(wind_level, sea_level)


def build_target(df: pd.DataFrame) -> pd.DataFrame:
    future = df[["location_id", "timestamp", "wind_speed_kts", "wind_gust_kts", "wave_height_m", "swell_height_m"]].copy()
    observable = future[["wind_speed_kts", "wave_height_m", "swell_height_m"]].notna().any(axis=1)
    future["risk"] = np.nan
    future.loc[observable, "risk"] = future.loc[observable].apply(small_craft_policy, axis=1)
    future["timestamp"] = future["timestamp"] - pd.to_timedelta(int(RISK_HORIZON_HOURS), unit="h")
    return df.merge(future[["location_id", "timestamp", "risk"]], on=["location_id", "timestamp"], how="left").dropna(subset=["risk"]).copy()


def decide(proba, high_threshold, extreme_threshold):
    pred = np.argmax(proba, axis=1)
    elevated = (proba[:, 2] + proba[:, 3]) >= high_threshold
    extreme = proba[:, 3] >= extreme_threshold
    pred[elevated] = np.maximum(pred[elevated], 2)
    pred[extreme] = 3
    return pred


def metrics(y, pred):
    y = np.asarray(y)
    pred = np.asarray(pred)
    actual = (y >= 2).astype(int)
    predicted = (pred >= 2).astype(int)
    return {
        "balanced_accuracy": float(balanced_accuracy_score(y, pred)),
        "macro_f1": float(f1_score(y, pred, average="macro", zero_division=0)),
        "high_extreme_recall": float(recall_score(actual, predicted, zero_division=0)),
        "high_extreme_precision": float(precision_score(actual, predicted, zero_division=0)),
        "high_extreme_f1": float(f1_score(actual, predicted, zero_division=0)),
        "escalation_rate": float(predicted.mean()),
    }


def main():
    df = pd.read_parquet(PROCESSED_DIR / "orca_historical_marine_risk.parquet")
    df["timestamp"] = pd.to_datetime(df["timestamp"], utc=True)
    df = df.sort_values(["location_id", "timestamp"]).copy()
    df, feature_columns = add_dynamic_features(df)
    data = build_target(df)
    data["risk"] = data["risk"].astype(int)

    pool = data[data.location_id != HOLDOUT_LOCATION].sort_values("timestamp")
    digha = data[data.location_id == HOLDOUT_LOCATION]
    n = len(pool)
    train_end, val_end = int(n * .70), int(n * .85)
    train, val = pool.iloc[:train_end], pool.iloc[train_end:val_end]
    cal_end = len(val) // 2
    calibration_df, test_df = val.iloc[:cal_end], val.iloc[cal_end:]

    counts = train.risk.value_counts().sort_index()
    weights = {int(k): float(len(train) / (4 * v)) for k, v in counts.items()}
    model = XGBClassifier(
        objective="multi:softprob", num_class=4, n_estimators=900, learning_rate=.035,
        max_depth=6, min_child_weight=8, subsample=.85, colsample_bytree=.85,
        reg_alpha=.15, reg_lambda=2, gamma=.05, tree_method="hist",
        eval_metric="mlogloss", random_state=RANDOM_STATE, n_jobs=-1,
    )
    model.fit(train[feature_columns], train.risk, sample_weight=train.risk.map(weights).to_numpy(dtype=np.float32), verbose=False)

    calibrated = CalibratedClassifierCV(FrozenEstimator(model), method="sigmoid")
    calibrated.fit(calibration_df[feature_columns], calibration_df.risk)
    p_cal = calibrated.predict_proba(calibration_df[feature_columns])
    p_test = calibrated.predict_proba(test_df[feature_columns])
    p_digha = calibrated.predict_proba(digha[feature_columns])

    candidates = []
    for high_threshold in GRID:
        for extreme_threshold in GRID:
            if extreme_threshold < high_threshold:
                continue
            candidate_metrics = metrics(calibration_df.risk.to_numpy(), decide(p_cal, high_threshold, extreme_threshold))
            feasible = (
                candidate_metrics["high_extreme_recall"] >= MIN_RECALL
                and candidate_metrics["high_extreme_precision"] >= MIN_PRECISION
                and candidate_metrics["escalation_rate"] <= MAX_ESCALATION
            )
            distance = (
                max(0, MIN_RECALL - candidate_metrics["high_extreme_recall"])
                + max(0, MIN_PRECISION - candidate_metrics["high_extreme_precision"])
                + max(0, candidate_metrics["escalation_rate"] - MAX_ESCALATION)
            )
            candidates.append({
                "high_threshold": float(high_threshold),
                "extreme_threshold": float(extreme_threshold),
                "feasible": feasible,
                "constraint_distance": float(distance),
                **candidate_metrics,
            })

    feasible = [x for x in candidates if x["feasible"]]
    if feasible:
        best = max(feasible, key=lambda x: (x["macro_f1"], x["high_extreme_f1"], -x["escalation_rate"], x["high_extreme_recall"]))
        selection_mode = "constrained_feasible"
    else:
        best = min(candidates, key=lambda x: (x["constraint_distance"], -x["macro_f1"], -x["high_extreme_f1"], x["escalation_rate"]))
        selection_mode = "closest_to_constraints_no_fully_feasible_point"

    high_threshold, extreme_threshold = best["high_threshold"], best["extreme_threshold"]
    result = {
        "risk_policy": "small_craft_conservative",
        "prediction_horizon_hours": int(RISK_HORIZON_HOURS),
        "base_features": FEATURE_COLUMNS,
        "constraints": {"minimum_high_extreme_recall": MIN_RECALL, "minimum_high_extreme_precision": MIN_PRECISION, "maximum_escalation_rate": MAX_ESCALATION},
        "selection_mode": selection_mode,
        "selected_thresholds": {"high_plus_extreme_probability": high_threshold, "extreme_probability": extreme_threshold},
        "calibration_block_metrics": best,
        "temporal_test_metrics": metrics(test_df.risk.to_numpy(), decide(p_test, high_threshold, extreme_threshold)),
        "digha_holdout_metrics": metrics(digha.risk.to_numpy(), decide(p_digha, high_threshold, extreme_threshold)),
        "feasible_candidate_count": len(feasible),
        "note": "Thresholds were selected only on the temporal calibration block. Digha was reserved for final spatial evaluation and did not influence selection.",
    }
    out = MODELS_DIR / "safety_threshold_optimization.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(result, indent=2, default=float), encoding="utf-8")
    print("Selection mode:", selection_mode)
    print("Selected thresholds:", result["selected_thresholds"])
    print("Calibration block:", result["calibration_block_metrics"])
    print("Temporal test:", result["temporal_test_metrics"])
    print("Digha:", result["digha_holdout_metrics"])
    print(f"Saved threshold optimization: {out}")


if __name__ == "__main__":
    main()
