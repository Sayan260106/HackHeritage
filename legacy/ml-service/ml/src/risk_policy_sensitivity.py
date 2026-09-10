"""Compare defensible ORCA-X operational risk policies on the same data contract."""
from __future__ import annotations

import json
from pathlib import Path
import numpy as np
import pandas as pd
from sklearn.metrics import balanced_accuracy_score, f1_score, classification_report
from xgboost import XGBClassifier

from config import PROCESSED_DIR, MODELS_DIR, FEATURE_COLUMNS, RISK_HORIZON_HOURS, RISK_CLASS_NAMES
from train import add_dynamic_features

RISK_ORDER = [RISK_CLASS_NAMES[i] for i in range(4)]
HOLDOUT_LOCATION = "digha_wb"


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


def policy_a(row: pd.Series) -> int:
    w, s = severity(row)
    if w >= 3 or s >= 3:
        return 3
    if w >= 2 or s >= 2:
        return 2
    return max(w, s)


def policy_b(row: pd.Series) -> int:
    """Compound-hazard policy: EXTREME requires an extreme single factor or two high factors."""
    w, s = severity(row)
    if w >= 3 or s >= 3:
        return 3
    if w >= 2 and s >= 2:
        return 3
    if w >= 2 or s >= 2:
        return 2
    return max(w, s)


def policy_c(row: pd.Series) -> int:
    """Small-craft conservative policy used for the Refinement 4 review."""
    w, s = severity(row)
    if w >= 3 or s >= 3:
        return 3
    if (w >= 2 and s >= 1) or (s >= 2 and w >= 1):
        return 3
    if w >= 2 or s >= 2:
        return 2
    return max(w, s)


POLICIES = {"current_operational": policy_a, "compound_extreme": policy_b, "small_craft_conservative": policy_c}


def forward_target(df: pd.DataFrame, policy) -> pd.DataFrame:
    future = df[["location_id", "timestamp", "wind_speed_kts", "wind_gust_kts", "wave_height_m", "swell_height_m"]].copy()
    observable = future[["wind_speed_kts", "wave_height_m", "swell_height_m"]].notna().any(axis=1)
    future["risk"] = np.nan
    future.loc[observable, "risk"] = future.loc[observable].apply(policy, axis=1)
    future["timestamp"] = future["timestamp"] - pd.Timedelta(hours=int(RISK_HORIZON_HOURS))
    target = future[["location_id", "timestamp", "risk"]]
    return df.merge(target, on=["location_id", "timestamp"], how="left").dropna(subset=["risk"]).copy()


def score(y, pred) -> dict:
    return {
        "balanced_accuracy": float(balanced_accuracy_score(y, pred)),
        "macro_f1": float(f1_score(y, pred, average="macro", zero_division=0)),
        "weighted_f1": float(f1_score(y, pred, average="weighted", zero_division=0)),
        "classification_report": classification_report(y, pred, labels=[0, 1, 2, 3], target_names=RISK_ORDER, output_dict=True, zero_division=0),
    }


def main() -> None:
    path = PROCESSED_DIR / "orca_historical_marine_risk.parquet"
    df = pd.read_parquet(path)
    df["timestamp"] = pd.to_datetime(df["timestamp"], utc=True)
    df = df.sort_values(["location_id", "timestamp"]).copy()
    df, feature_cols = add_dynamic_features(df)
    results = {}

    for name, policy in POLICIES.items():
        data = forward_target(df, policy)
        data["risk"] = data["risk"].astype(int)
        pool = data[data.location_id != HOLDOUT_LOCATION].sort_values("timestamp")
        digha = data[data.location_id == HOLDOUT_LOCATION]
        n = len(pool)
        train_end, val_end = int(n * 0.70), int(n * 0.85)
        train, val = pool.iloc[:train_end], pool.iloc[train_end:val_end]
        counts = train["risk"].value_counts().sort_index()
        weights = {int(k): float(len(train) / (4 * v)) for k, v in counts.items()}
        model = XGBClassifier(
            objective="multi:softprob", num_class=4, n_estimators=700, learning_rate=.035,
            max_depth=6, min_child_weight=8, subsample=.85, colsample_bytree=.85,
            reg_alpha=.15, reg_lambda=2, gamma=.05, tree_method="hist",
            eval_metric="mlogloss", random_state=42, n_jobs=-1,
        )
        model.fit(train[feature_cols], train.risk, sample_weight=train.risk.map(weights).to_numpy(dtype=np.float32), verbose=False)
        val_pred = model.predict(val[feature_cols])
        digha_pred = model.predict(digha[feature_cols])
        results[name] = {
            "class_counts": {RISK_ORDER[i]: int((data.risk == i).sum()) for i in range(4)},
            "class_percent": {RISK_ORDER[i]: round(float((data.risk == i).mean() * 100), 3) for i in range(4)},
            "temporal": score(val.risk, val_pred),
            "digha": score(digha.risk, digha_pred),
        }
        print(f"\n=== {name} ===")
        print("Distribution:", results[name]["class_percent"])
        print("Temporal:", {k: v for k, v in results[name]["temporal"].items() if k not in {"classification_report", "confusion_matrix"}})
        print("Digha:", {k: v for k, v in results[name]["digha"].items() if k not in {"classification_report", "confusion_matrix"}})

    out = MODELS_DIR / "risk_policy_sensitivity.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps({"prediction_horizon_hours": RISK_HORIZON_HOURS, "base_features": FEATURE_COLUMNS, "policies": results}, indent=2, default=float), encoding="utf-8")
    print(f"\nSaved policy sensitivity: {out}")


if __name__ == "__main__":
    main()
