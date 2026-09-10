"""ORCA-X Refinement 5B: physically informed, spatially robust feature ablation.

Selection/audit only. This script never changes the production model, label
policy, calibration, or safety thresholds.

Compares three feature contracts under leave-one-location-out validation:
  1. full: current point-in-time features including raw latitude/longitude
  2. geo_neutral: current features with raw latitude/longitude removed
  3. physics_robust: geo-neutral features plus point-in-time marine interaction
     features intended to describe sea-state/wind relationships rather than
     coastline identity.

Each location is held out completely. The remaining five locations are sorted
by time and split 70/15/15; only the first 70% is used for fitting and the next
15% is used as an internal temporal validation check. The held-out location is
never used for selection.
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

from config import FEATURE_COLUMNS, PROCESSED_DIR, RISK_CLASS_NAMES, TARGET_COLUMN  # noqa: E402
from train import add_dynamic_features, load_dataset  # noqa: E402

RANDOM_STATE = 42
LOCATIONS = ["digha_wb", "paradip_od", "vizag_ap", "chennai_tn", "goa", "kochi_kl"]
GEO_COLUMNS = {"latitude", "longitude"}


def add_physics_features(df: pd.DataFrame) -> tuple[pd.DataFrame, list[str]]:
    """Add reproducible point-in-time marine relationships; no future/lag data."""
    out = df.copy()
    engineered: list[str] = []
    eps = 0.1

    def add(name: str, value) -> None:
        out[name] = value.replace([np.inf, -np.inf], np.nan) if isinstance(value, pd.Series) else value
        engineered.append(name)

    # Wind/sea-state coupling.
    add("wave_height_sq", out["wave_height_m"].clip(lower=0) ** 2)
    add("swell_height_sq", out["swell_height_m"].clip(lower=0) ** 2)
    add("wave_energy_proxy", out["wave_height_m"].clip(lower=0) ** 2 * out["wave_period_s"].clip(lower=0))
    add("swell_energy_proxy", out["swell_height_m"].clip(lower=0) ** 2 * out["swell_period_s"].clip(lower=0))
    add("combined_sea_height_m", out["wave_height_m"].clip(lower=0) + out["swell_height_m"].clip(lower=0))
    add("swell_fraction", out["swell_height_m"] / out["wave_height_m"].clip(lower=eps))
    add("wave_period_height_ratio", out["wave_period_s"] / out["wave_height_m"].clip(lower=eps))
    add("swell_period_height_ratio", out["swell_period_s"] / out["swell_height_m"].clip(lower=eps))
    add("wind_wave_loading", out["wind_speed_kts"].clip(lower=0) * out["wave_height_m"].clip(lower=0))
    add("gust_wave_loading", out["wind_gust_kts"].clip(lower=0) * out["wave_height_m"].clip(lower=0))

    # Wind intensity and gust structure. Existing dynamic features already add
    # gust excess/ratio/thresholds; these add sea-state coupling only.
    add("gust_excess_wave_loading", out["gust_excess_kts"].clip(lower=0) * out["wave_height_m"].clip(lower=0))
    add("gale_wave_indicator", ((out["wind_speed_kts"] >= 34.0) & (out["wave_height_m"] >= 4.0)).astype(np.int8))
    add("severe_sea_indicator", ((out["wind_speed_kts"] >= 40.0) & (out["wave_height_m"] >= 5.0)).astype(np.int8))
    add("extreme_sea_indicator", ((out["wind_speed_kts"] >= 48.0) | (out["wave_height_m"] >= 6.0)).astype(np.int8))

    # Relative atmospheric/ocean state; bounded ratios avoid raw location use.
    add("pressure_temperature_ratio", out["air_pressure_hpa"] / (out["air_temperature_c"].abs() + 273.15))
    add("sst_air_temp_delta_c", out["sea_surface_temperature_c"] - out["air_temperature_c"])
    add("precipitation_present", (out["precipitation_mm"] > 0).astype(np.int8))

    # Directional alignment: circular angular differences expressed without a
    # discontinuity. These are observation-local and require no location ID.
    def alignment(a: pd.Series, b: pd.Series) -> pd.Series:
        delta = np.deg2rad((a - b + 180.0) % 360.0 - 180.0)
        return np.cos(delta)

    add("wind_wave_alignment", alignment(out["wind_direction_deg"], out["wave_direction_deg"]))
    add("wind_swell_alignment", alignment(out["wind_direction_deg"], out["swell_direction_deg"]))
    add("wave_swell_alignment", alignment(out["wave_direction_deg"], out["swell_direction_deg"]))

    return out, engineered


def metrics(y_true, pred) -> dict:
    y_true = np.asarray(y_true)
    pred = np.asarray(pred)
    return {
        "accuracy": float(accuracy_score(y_true, pred)),
        "balanced_accuracy": float(balanced_accuracy_score(y_true, pred)),
        "macro_f1": float(f1_score(y_true, pred, average="macro", zero_division=0)),
        "weighted_f1": float(f1_score(y_true, pred, average="weighted", zero_division=0)),
        "low_recall": float(recall_score(y_true, pred, labels=[0], average="macro", zero_division=0)),
        "moderate_recall": float(recall_score(y_true, pred, labels=[1], average="macro", zero_division=0)),
        "high_recall": float(recall_score(y_true, pred, labels=[2], average="macro", zero_division=0)),
        "extreme_recall": float(recall_score(y_true, pred, labels=[3], average="macro", zero_division=0)),
        "high_extreme_recall": float(recall_score((y_true >= 2).astype(int), (pred >= 2).astype(int), zero_division=0)),
    }


def make_model() -> xgb.XGBClassifier:
    """Keep the already-selected Trial-12 model fixed to isolate feature effects."""
    return xgb.XGBClassifier(
        objective="multi:softprob", num_class=4, n_estimators=1000,
        learning_rate=0.05, max_depth=6, min_child_weight=12,
        subsample=0.75, colsample_bytree=0.75, reg_alpha=0.15,
        reg_lambda=1.0, gamma=0.0, tree_method="hist", eval_metric="mlogloss",
        random_state=RANDOM_STATE, n_jobs=-1,
    )


def class_weights(y: pd.Series) -> dict[int, float]:
    counts = y.value_counts().sort_index()
    return {int(cls): float(len(y) / (4 * count)) for cls, count in counts.items()}


def run_fold(df: pd.DataFrame, held_out: str, features: list[str]) -> dict:
    pool = df[df.location_id != held_out].sort_values("timestamp").copy()
    holdout = df[df.location_id == held_out].sort_values("timestamp").copy()
    n = len(pool)
    train_end, validation_end = int(n * 0.70), int(n * 0.85)
    train_df = pool.iloc[:train_end]
    validation_df = pool.iloc[train_end:validation_end]

    weights = class_weights(train_df[TARGET_COLUMN])
    model = make_model()
    model.fit(
        train_df[features], train_df[TARGET_COLUMN],
        sample_weight=train_df[TARGET_COLUMN].map(weights).to_numpy(dtype=np.float32),
        verbose=False,
    )
    val_pred = model.predict(validation_df[features]).astype(int)
    hold_pred = model.predict(holdout[features]).astype(int)
    return {
        "held_out_location": held_out,
        "feature_count": len(features),
        "temporal_validation": metrics(validation_df[TARGET_COLUMN], val_pred),
        "held_out_location_audit": metrics(holdout[TARGET_COLUMN], hold_pred),
        "rows": {"train": len(train_df), "validation": len(validation_df), "holdout": len(holdout)},
    }


def main() -> None:
    print("=" * 78)
    print("ORCA-X SPATIALLY ROBUST MARINE FEATURES — REFINEMENT 5B")
    print("=" * 78)
    print("No production model, risk policy, calibration, or thresholds are modified.")

    df = load_dataset()
    df, dynamic_features = add_dynamic_features(df)
    df, physics_features = add_physics_features(df)

    full_features = list(dynamic_features)
    geo_neutral = [c for c in full_features if c not in GEO_COLUMNS]
    physics_robust = geo_neutral + physics_features
    locations = [x for x in LOCATIONS if x in set(df.location_id.unique())]

    print(f"Rows: {len(df):,} | Locations: {len(locations)}")
    print(f"Full features: {len(full_features)} | Geo-neutral: {len(geo_neutral)} | Physics-robust: {len(physics_robust)}")
    print(f"Physics features added: {len(physics_features)}")

    feature_sets = {
        "full_features": full_features,
        "geo_neutral": geo_neutral,
        "physics_robust": physics_robust,
    }
    results: dict[str, list[dict]] = {name: [] for name in feature_sets}

    for name, features in feature_sets.items():
        print(f"\n--- {name} ---")
        for location in locations:
            result = run_fold(df, location, features)
            results[name].append(result)
            tv = result["temporal_validation"]
            ho = result["held_out_location_audit"]
            print(
                f"{location:12s} | temporal macro_f1={tv['macro_f1']:.4f} bal_acc={tv['balanced_accuracy']:.4f} | "
                f"holdout macro_f1={ho['macro_f1']:.4f} bal_acc={ho['balanced_accuracy']:.4f} "
                f"HIGH={ho['high_recall']:.4f} EXTREME={ho['extreme_recall']:.4f} critical={ho['high_extreme_recall']:.4f}"
            )

    summary = {}
    for name, folds in results.items():
        hold = [x["held_out_location_audit"] for x in folds]
        temporal = [x["temporal_validation"] for x in folds]
        summary[name] = {
            "mean_temporal_macro_f1": float(np.mean([x["macro_f1"] for x in temporal])),
            "mean_temporal_balanced_accuracy": float(np.mean([x["balanced_accuracy"] for x in temporal])),
            "mean_holdout_macro_f1": float(np.mean([x["macro_f1"] for x in hold])),
            "mean_holdout_balanced_accuracy": float(np.mean([x["balanced_accuracy"] for x in hold])),
            "mean_holdout_high_extreme_recall": float(np.mean([x["high_extreme_recall"] for x in hold])),
            "mean_holdout_high_recall": float(np.mean([x["high_recall"] for x in hold])),
            "mean_holdout_extreme_recall": float(np.mean([x["extreme_recall"] for x in hold])),
            "worst_holdout_macro_f1": float(np.min([x["macro_f1"] for x in hold])),
            "worst_holdout_balanced_accuracy": float(np.min([x["balanced_accuracy"] for x in hold])),
            "worst_holdout_high_extreme_recall": float(np.min([x["high_extreme_recall"] for x in hold])),
        }

    out_dir = ROOT / "ml" / "models" / "spatial_generalization"
    out_dir.mkdir(parents=True, exist_ok=True)
    payload = {
        "experiment": "refinement_5b_spatially_robust_feature_ablation",
        "locations": locations,
        "feature_sets": {
            "full_features": full_features,
            "geo_neutral": geo_neutral,
            "physics_robust": physics_robust,
            "physics_features_added": physics_features,
            "raw_geography_removed": sorted(GEO_COLUMNS),
        },
        "results": results,
        "summary": summary,
        "selection_rule": "Use cross-location generalization first; no held-out-location result is used to tune a production model. Safety metrics are guardrails, not permission to overfit a location.",
        "model_contract": "Trial-12 XGBoost fixed across all feature sets so the experiment isolates representation effects.",
        "risk_classes": {str(k): v for k, v in RISK_CLASS_NAMES.items()},
    }
    path = out_dir / "spatially_robust_feature_results.json"
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")

    print("\n==============================================================================")
    print("SPATIALLY ROBUST FEATURE SUMMARY")
    print("==============================================================================")
    for name, values in summary.items():
        print(
            f"{name:16s} | mean_holdout_macro_f1={values['mean_holdout_macro_f1']:.4f} "
            f"mean_bal_acc={values['mean_holdout_balanced_accuracy']:.4f} "
            f"mean_critical={values['mean_holdout_high_extreme_recall']:.4f} "
            f"worst_macro_f1={values['worst_holdout_macro_f1']:.4f}"
        )
    print(f"Saved: {path}")
    print("Production model was NOT modified.")


if __name__ == "__main__":
    main()
