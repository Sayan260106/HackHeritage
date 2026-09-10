"""ORCA-X Refinement 5: spatial-generalization ablation and LOLO validation.

This script is diagnostic/selection-only. It never modifies the production model.

For each of the six locations, that location is held out completely, while the
remaining locations are split chronologically into 70% train / 15% validation.
Two feature sets are compared:
  A) full point-in-time feature set (including latitude/longitude)
  B) geographic-neutral feature set with raw latitude/longitude removed

The primary selection metrics are temporal macro-F1/balanced accuracy. The
held-out-location result is an audit of cross-coastal generalization.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import xgboost as xgb
from sklearn.metrics import accuracy_score, balanced_accuracy_score, f1_score, recall_score

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "ml" / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

from config import FEATURE_COLUMNS, PROCESSED_DIR, TARGET_COLUMN, RISK_CLASS_NAMES  # noqa: E402
from train import add_dynamic_features, load_dataset  # noqa: E402

RANDOM_STATE = 42
LOCATIONS = ["digha_wb", "paradip_od", "vizag_ap", "chennai_tn", "goa", "kochi_kl"]
DROP_GEO = {"latitude", "longitude"}


def metrics(y, pred) -> dict:
    return {
        "accuracy": float(accuracy_score(y, pred)),
        "balanced_accuracy": float(balanced_accuracy_score(y, pred)),
        "macro_f1": float(f1_score(y, pred, average="macro", zero_division=0)),
        "weighted_f1": float(f1_score(y, pred, average="weighted", zero_division=0)),
        "high_recall": float(recall_score(y, pred, labels=[2], average="macro", zero_division=0)),
        "extreme_recall": float(recall_score(y, pred, labels=[3], average="macro", zero_division=0)),
        "high_extreme_recall": float(recall_score((np.asarray(y) >= 2).astype(int), (np.asarray(pred) >= 2).astype(int), zero_division=0)),
    }


def class_weights(y: pd.Series) -> dict[int, float]:
    counts = y.value_counts().sort_index()
    return {int(c): float(len(y) / (4 * n)) for c, n in counts.items()}


def make_model() -> xgb.XGBClassifier:
    # Use the currently selected Trial-12 structure so this experiment isolates
    # the effect of geographic representation rather than retuning everything.
    return xgb.XGBClassifier(
        objective="multi:softprob", num_class=4, n_estimators=1000,
        learning_rate=0.05, max_depth=6, min_child_weight=12,
        subsample=0.75, colsample_bytree=0.75, reg_alpha=0.15,
        reg_lambda=1.0, gamma=0.0, tree_method="hist", eval_metric="mlogloss",
        random_state=RANDOM_STATE, n_jobs=-1,
    )


def run_fold(df: pd.DataFrame, held_out: str, feature_columns: list[str]) -> dict:
    pool = df[df.location_id != held_out].sort_values("timestamp").copy()
    holdout = df[df.location_id == held_out].sort_values("timestamp").copy()
    n = len(pool)
    train_end, val_end = int(n * 0.70), int(n * 0.85)
    train_df = pool.iloc[:train_end]
    val_df = pool.iloc[train_end:val_end]
    weights = class_weights(train_df[TARGET_COLUMN])
    model = make_model()
    model.fit(train_df[feature_columns], train_df[TARGET_COLUMN], sample_weight=train_df[TARGET_COLUMN].map(weights).to_numpy(dtype=np.float32), verbose=False)
    val_pred = model.predict(val_df[feature_columns]).astype(int)
    hold_pred = model.predict(holdout[feature_columns]).astype(int)
    return {
        "held_out_location": held_out,
        "feature_count": len(feature_columns),
        "temporal_validation": metrics(val_df[TARGET_COLUMN], val_pred),
        "held_out_location_audit": metrics(holdout[TARGET_COLUMN], hold_pred),
        "rows": {"train": len(train_df), "validation": len(val_df), "holdout": len(holdout)},
    }


def main() -> None:
    print("=" * 78)
    print("ORCA-X SPATIAL GENERALIZATION + LEAVE-ONE-LOCATION-OUT — REFINEMENT 5")
    print("=" * 78)
    print("No production model, risk policy, or thresholds are modified.")
    df = load_dataset()
    df, features = add_dynamic_features(df)
    full_features = list(features)
    geo_neutral_features = [c for c in full_features if c not in DROP_GEO]
    locations = [x for x in LOCATIONS if x in set(df.location_id.unique())]
    print(f"Rows: {len(df):,} | Locations: {len(locations)} | Full features: {len(full_features)} | Geo-neutral features: {len(geo_neutral_features)}")

    results = {"full_features": [], "geo_neutral": []}
    for feature_name, feature_set in [("full_features", full_features), ("geo_neutral", geo_neutral_features)]:
        print(f"\n--- {feature_name} ---")
        for location in locations:
            result = run_fold(df, location, feature_set)
            results[feature_name].append(result)
            tv = result["temporal_validation"]
            ho = result["held_out_location_audit"]
            print(
                f"{location:12s} | temporal macro_f1={tv['macro_f1']:.4f} bal_acc={tv['balanced_accuracy']:.4f} | "
                f"holdout macro_f1={ho['macro_f1']:.4f} bal_acc={ho['balanced_accuracy']:.4f} "
                f"critical_recall={ho['high_extreme_recall']:.4f}"
            )

    summary = {}
    for key, folds in results.items():
        summary[key] = {
            "mean_holdout_macro_f1": float(np.mean([x["held_out_location_audit"]["macro_f1"] for x in folds])),
            "mean_holdout_balanced_accuracy": float(np.mean([x["held_out_location_audit"]["balanced_accuracy"] for x in folds])),
            "mean_holdout_high_extreme_recall": float(np.mean([x["held_out_location_audit"]["high_extreme_recall"] for x in folds])),
            "worst_holdout_macro_f1": float(np.min([x["held_out_location_audit"]["macro_f1"] for x in folds])),
            "worst_holdout_balanced_accuracy": float(np.min([x["held_out_location_audit"]["balanced_accuracy"] for x in folds])),
        }

    out_dir = ROOT / "ml" / "models" / "spatial_generalization"
    out_dir.mkdir(parents=True, exist_ok=True)
    payload = {
        "experiment": "leave_one_location_out",
        "locations": locations,
        "full_features": full_features,
        "geo_neutral_removed": sorted(DROP_GEO),
        "results": results,
        "summary": summary,
        "selection_note": "No held-out-location result is used to tune or modify a production model; this experiment diagnoses spatial generalization and geographic dependence.",
    }
    path = out_dir / "spatial_generalization_results.json"
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    print("\n==============================================================================")
    print("SPATIAL GENERALIZATION SUMMARY")
    print("==============================================================================")
    for key, value in summary.items():
        print(f"{key}: mean_holdout_macro_f1={value['mean_holdout_macro_f1']:.4f} mean_holdout_bal_acc={value['mean_holdout_balanced_accuracy']:.4f} mean_critical_recall={value['mean_holdout_high_extreme_recall']:.4f} worst_macro_f1={value['worst_holdout_macro_f1']:.4f}")
    print(f"Saved: {path}")
    print("Production model was NOT modified.")


if __name__ == "__main__":
    main()
