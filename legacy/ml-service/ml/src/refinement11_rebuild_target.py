"""ORCA-X Refinement 11: rebuild and audit the six-hour forward risk target.

This script creates a clean, leakage-safe benchmark dataset from the processed
historical observations. The contemporaneous stored risk label is never used
to construct the new target.

Contract
--------
* Prediction features are available at time t only.
* Target is the operational risk policy applied to observations at t + 6h.
* Matching is exact on (location_id, timestamp); no nearest-neighbour matching.
* Rows without an observable future state are excluded from the clean target.
* Digha is not a training holdout here; this script is data reconstruction only.
* Existing parquet, models, policies and thresholds are never modified.

Outputs are written under ml/models/refinement11/ so the existing production
artifacts remain untouched.
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd

from config import FEATURE_COLUMNS, PROCESSED_DIR, RISK_HORIZON_HOURS, RISK_CLASS_NAMES, TARGET_COLUMN
from label_policy import POLICY_VERSION, assign_operational_risk


OUT_DIR = Path(__file__).resolve().parents[1] / "models" / "refinement11"
SOURCE_PATH = PROCESSED_DIR / "orca_historical_marine_risk.parquet"
CLEAN_PATH = OUT_DIR / "clean_forward_target.parquet"
REPORT_PATH = OUT_DIR / "refinement11_target_rebuild.json"
MISMATCH_PATH = OUT_DIR / "target_mismatches.csv"

TARGET_INPUTS = [
    "wind_speed_kts",
    "wind_gust_kts",
    "wave_height_m",
    "swell_height_m",
]


def _label_name(value: object) -> str | None:
    if pd.isna(value):
        return None
    try:
        return RISK_CLASS_NAMES[int(value)]
    except (KeyError, TypeError, ValueError):
        return str(value)


def _distribution(series: pd.Series) -> dict[str, dict[str, float | int]]:
    counts = series.dropna().astype(int).value_counts().sort_index()
    total = int(counts.sum())
    return {
        RISK_CLASS_NAMES[int(k)]: {
            "count": int(v),
            "fraction": float(v / total) if total else 0.0,
        }
        for k, v in counts.items()
    }


def _policy_label(row: pd.Series) -> float:
    try:
        return float(assign_operational_risk(row))
    except Exception:
        return np.nan


def load_source() -> pd.DataFrame:
    if not SOURCE_PATH.exists():
        raise FileNotFoundError(
            f"Processed dataset not found: {SOURCE_PATH}. "
            "Run the historical download + preparation pipeline first."
        )

    df = pd.read_parquet(SOURCE_PATH)
    required = ["location_id", "timestamp", *FEATURE_COLUMNS, TARGET_COLUMN, *TARGET_INPUTS]
    missing = [column for column in required if column not in df.columns]
    if missing:
        raise ValueError(f"Dataset is missing required columns: {missing}")

    df = df.copy()
    df["location_id"] = df["location_id"].astype(str)
    df["timestamp"] = pd.to_datetime(df["timestamp"], utc=True, errors="coerce")
    for column in [*FEATURE_COLUMNS, TARGET_COLUMN, *TARGET_INPUTS]:
        df[column] = pd.to_numeric(df[column], errors="coerce")

    df = df.dropna(subset=["location_id", "timestamp"])
    df = df.sort_values(["location_id", "timestamp"]).reset_index(drop=True)

    duplicate_count = int(df.duplicated(["location_id", "timestamp"]).sum())
    if duplicate_count:
        raise ValueError(
            f"Duplicate (location_id, timestamp) observations detected: {duplicate_count}. "
            "Refusing to construct a forward target from ambiguous timestamps."
        )

    return df


def reconstruct(df: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame]:
    horizon = pd.Timedelta(hours=int(RISK_HORIZON_HOURS))

    future = df[["location_id", "timestamp", *TARGET_INPUTS]].copy()
    observable = future[TARGET_INPUTS].notna().any(axis=1)
    future["future_risk_class"] = np.nan
    if observable.any():
        future.loc[observable, "future_risk_class"] = future.loc[observable].apply(
            _policy_label, axis=1
        )

    future["prediction_timestamp"] = future["timestamp"] - horizon
    target = future[["location_id", "prediction_timestamp", "future_risk_class"]].rename(
        columns={"prediction_timestamp": "timestamp"}
    )

    merged = df.merge(
        target,
        on=["location_id", "timestamp"],
        how="left",
        validate="one_to_one",
        indicator="_target_match",
    )

    merged["stored_risk_label"] = pd.to_numeric(merged[TARGET_COLUMN], errors="coerce")
    merged["reconstructed_forward_risk"] = pd.to_numeric(
        merged["future_risk_class"], errors="coerce"
    )
    merged["target_match"] = merged["reconstructed_forward_risk"].notna()

    # IMPORTANT: never cast nullable columns containing unmatched future rows to
    # int. Compare only rows where both labels are finite numeric values.
    stored_valid = merged["stored_risk_label"].notna()
    reconstructed_valid = merged["reconstructed_forward_risk"].notna()
    merged["label_mismatch"] = (
        stored_valid
        & reconstructed_valid
        & (
            merged["stored_risk_label"].astype(float)
            != merged["reconstructed_forward_risk"].astype(float)
        )
    )

    clean = merged[merged["target_match"]].copy()
    clean[TARGET_COLUMN] = clean["reconstructed_forward_risk"].astype(int)
    clean = clean.drop(
        columns=["future_risk_class", "reconstructed_forward_risk", "_target_match"],
        errors="ignore",
    )
    clean = clean.drop(columns=["stored_risk_label", "label_mismatch"], errors="ignore")

    mismatch_rows = merged[merged["label_mismatch"]].copy()
    if not mismatch_rows.empty:
        mismatch_rows["stored_label_name"] = mismatch_rows["stored_risk_label"].map(_label_name)
        mismatch_rows["reconstructed_label_name"] = mismatch_rows["reconstructed_forward_risk"].map(_label_name)
        mismatch_rows["delta_class"] = (
            mismatch_rows["reconstructed_forward_risk"].astype(float)
            - mismatch_rows["stored_risk_label"].astype(float)
        ).astype(int)
        for column in TARGET_INPUTS:
            mismatch_rows[column] = mismatch_rows[column].astype(float)

    return clean, mismatch_rows


def build_mismatch_summary(mismatch_rows: pd.DataFrame) -> dict:
    if mismatch_rows.empty:
        return {"rows": 0, "by_stored_to_reconstructed": {}, "by_location": {}}

    pair_counts = (
        mismatch_rows.groupby(["stored_label_name", "reconstructed_label_name"])
        .size()
        .sort_values(ascending=False)
    )
    location_counts = mismatch_rows["location_id"].value_counts().sort_index()
    delta_counts = mismatch_rows["delta_class"].value_counts().sort_index()

    return {
        "rows": int(len(mismatch_rows)),
        "by_stored_to_reconstructed": {
            f"{a}->{b}": int(v) for (a, b), v in pair_counts.items()
        },
        "by_location": {str(k): int(v) for k, v in location_counts.items()},
        "delta_class_counts": {str(int(k)): int(v) for k, v in delta_counts.items()},
    }


def main() -> None:
    print("=" * 78)
    print("ORCA-X CLEAN FORWARD TARGET RECONSTRUCTION — REFINEMENT 11")
    print("=" * 78)
    print("Read-only source audit + new benchmark artifact")
    print(f"Policy: {POLICY_VERSION}")
    print(f"Forward horizon: +{int(RISK_HORIZON_HOURS)}h")
    print("Stored contemporaneous risk label: audit-only, never used as the new target")

    df = load_source()
    clean, mismatches = reconstruct(df)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    clean.to_parquet(CLEAN_PATH, index=False)
    if mismatches.empty:
        pd.DataFrame(
            columns=[
                "location_id", "timestamp", "stored_label_name",
                "reconstructed_label_name", "delta_class",
            ]
        ).to_csv(MISMATCH_PATH, index=False)
    else:
        mismatch_columns = [
            "location_id", "timestamp", "stored_risk_label",
            "reconstructed_forward_risk", "stored_label_name",
            "reconstructed_label_name", "delta_class",
            *TARGET_INPUTS,
        ]
        mismatches[mismatch_columns].to_csv(MISMATCH_PATH, index=False)

    matched = int(clean.shape[0])
    missing_future = int(len(df) - matched)
    mismatch_count = int(len(mismatches))
    mismatch_fraction = float(mismatch_count / matched) if matched else 0.0

    per_location = {}
    for location, group in df.groupby("location_id", sort=True):
        source_rows = len(group)
        clean_rows = int((clean["location_id"] == location).sum())
        location_mismatch_rows = int((mismatches["location_id"] == location).sum()) if not mismatches.empty else 0
        per_location[str(location)] = {
            "source_rows": int(source_rows),
            "forward_target_rows": clean_rows,
            "missing_future_rows": int(source_rows - clean_rows),
            "stored_vs_reconstructed_mismatches": location_mismatch_rows,
            "mismatch_rate_among_forward_rows": float(location_mismatch_rows / clean_rows) if clean_rows else 0.0,
        }

    mismatch_summary = build_mismatch_summary(mismatches)
    report = {
        "refinement": "11",
        "policy_version": POLICY_VERSION,
        "risk_horizon_hours": int(RISK_HORIZON_HOURS),
        "source_path": str(SOURCE_PATH),
        "clean_output_path": str(CLEAN_PATH),
        "mismatch_output_path": str(MISMATCH_PATH),
        "rows_source": int(len(df)),
        "rows_forward_target": matched,
        "rows_missing_future": missing_future,
        "stored_vs_reconstructed_mismatch_count": mismatch_count,
        "stored_vs_reconstructed_mismatch_rate": mismatch_fraction,
        "source_locations": sorted(df["location_id"].unique().tolist()),
        "target_distribution": _distribution(clean[TARGET_COLUMN]),
        "stored_distribution": _distribution(df[TARGET_COLUMN]),
        "per_location": per_location,
        "mismatch_summary": mismatch_summary,
        "contract": {
            "join": "exact (location_id, timestamp) after shifting future observation by +6h",
            "future_features_used_for_prediction": False,
            "stored_label_used_for_target": False,
            "location_id_used_as_model_feature": False,
            "nearest_timestamp_matching": False,
            "missing_future_rows_dropped": True,
            "target_policy": "assign_operational_risk at t+6h",
        },
        "interpretation": (
            "This artifact is the authoritative clean benchmark target for subsequent model work. "
            "A stored-label mismatch is a data/label audit finding, not evidence that the model is wrong. "
            "Do not optimize against the old stored label after this point."
        ),
    }

    REPORT_PATH.write_text(json.dumps(report, indent=2, default=float), encoding="utf-8")

    print(f"Rows source: {len(df):,}")
    print(f"Rows with exact +6h target: {matched:,}")
    print(f"Rows without future target: {missing_future:,}")
    print(f"Stored vs reconstructed mismatches: {mismatch_count:,} ({mismatch_fraction:.2%})")
    print("\nClean forward target distribution:")
    print(json.dumps(report["target_distribution"], indent=2))
    print("\nMismatch by coastline:")
    for location, values in per_location.items():
        print(
            f"{location:12s} forward={values['forward_target_rows']:6,d} "
            f"mismatch={values['stored_vs_reconstructed_mismatches']:6,d} "
            f"rate={values['mismatch_rate_among_forward_rows']:.2%}"
        )
    print("\nSaved:")
    print(f"  {CLEAN_PATH}")
    print(f"  {REPORT_PATH}")
    print(f"  {MISMATCH_PATH}")
    print("Production model, risk policy, thresholds, and source dataset were NOT modified.")


if __name__ == "__main__":
    main()
