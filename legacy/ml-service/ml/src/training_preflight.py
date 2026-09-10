"""Run a fail-fast audit before ORCA-X model training.

This checks the canonical historical dataset, forward-target construction,
temporal/spatial data coverage, the point-in-time engineered feature contract,
and the ability to build the same feature vector from a representative live
observation. It does not train or modify a model artifact.
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
ML_SRC = ROOT / "ml" / "src"
if str(ML_SRC) not in sys.path:
    sys.path.insert(0, str(ML_SRC))

from config import FEATURE_COLUMNS, HISTORICAL_END_DATE, HISTORICAL_LOCATIONS, HISTORICAL_START_DATE, RISK_CLASS_NAMES
from predict import build_inference_features
from train import add_dynamic_features, load_dataset

EXPECTED_FEATURE_COUNT = len(FEATURE_COLUMNS) * 2 + 6 + 4
HOLDOUT_LOCATION = "digha_wb"


def main() -> None:
    print("=" * 80)
    print("ORCA-X TRAINING PREFLIGHT")
    print("No model training or artifact promotion is performed by this script.")
    print("=" * 80)

    df = load_dataset()
    if df.empty:
        raise RuntimeError("Canonical dataset is empty.")

    locations = set(df["location_id"].dropna().unique())
    expected_locations = {item["id"] for item in HISTORICAL_LOCATIONS}
    missing_locations = sorted(expected_locations - locations)
    if missing_locations:
        raise RuntimeError(f"Dataset is missing configured locations: {missing_locations}")

    start = df["timestamp"].min()
    end = df["timestamp"].max()
    if start.strftime("%Y-%m-%d") > HISTORICAL_START_DATE:
        raise RuntimeError(f"Dataset starts too late: {start.isoformat()}")
    if end.strftime("%Y-%m-%d") < HISTORICAL_END_DATE:
        raise RuntimeError(f"Dataset ends too early: {end.isoformat()}")

    engineered, feature_columns = add_dynamic_features(df)
    if len(feature_columns) != EXPECTED_FEATURE_COUNT:
        raise RuntimeError(
            f"Unexpected engineered feature count: {len(feature_columns)}; expected {EXPECTED_FEATURE_COUNT}."
        )
    if len(set(feature_columns)) != len(feature_columns):
        raise RuntimeError("Engineered feature contract contains duplicate names.")

    required_base = set(FEATURE_COLUMNS)
    if not required_base.issubset(engineered.columns):
        raise RuntimeError("Canonical dataset is missing one or more base model features.")

    for cls in range(4):
        if cls not in set(engineered["risk_class"].unique().tolist()):
            raise RuntimeError(f"Forward target is missing class {cls} ({RISK_CLASS_NAMES[cls]}).")

    non_holdout = engineered[engineered["location_id"] != HOLDOUT_LOCATION]
    holdout = engineered[engineered["location_id"] == HOLDOUT_LOCATION]
    if non_holdout.empty or holdout.empty:
        raise RuntimeError("Training pool or Digha spatial holdout is empty.")

    for year, frame in [(2020, non_holdout[non_holdout.timestamp.dt.year == 2020]),
                        (2021, non_holdout[non_holdout.timestamp.dt.year == 2021]),
                        (2022, non_holdout[non_holdout.timestamp.dt.year == 2022]),
                        (2023, non_holdout[non_holdout.timestamp.dt.year == 2023]),
                        (2024, non_holdout[non_holdout.timestamp.dt.year == 2024]),
                        (2025, non_holdout[non_holdout.timestamp.dt.year == 2025])]:
        if frame.empty:
            raise RuntimeError(f"No non-Digha observations found for {year}.")

    live = {
        "wind_speed_kts": 20.0,
        "wind_gust_kts": 30.0,
        "wave_height_m": 1.8,
        "wave_period_s": 8.0,
        "swell_height_m": 1.0,
        "swell_period_s": 7.0,
        "wind_direction_deg": 180.0,
        "wave_direction_deg": 190.0,
        "swell_direction_deg": 200.0,
        "air_pressure_hpa": 1010.0,
        "air_temperature_c": 28.0,
        "sea_surface_temperature_c": 27.0,
        "precipitation_mm": 0.0,
        "visibility_km": 10.0,
        "latitude": 21.626,
        "longitude": 87.508,
        "month": 9,
        "season": 2,
        "observed_at": "2026-09-04T06:00:00+00:00",
    }
    vector = build_inference_features(live, feature_columns)
    if list(vector.keys()) != feature_columns:
        raise RuntimeError("Live inference feature order does not match the training contract.")

    finite_or_nan = np.array(list(vector.values()), dtype=float)
    if not np.isfinite(finite_or_nan[~np.isnan(finite_or_nan)]).all():
        raise RuntimeError("Live feature builder produced a non-finite value.")

    print(f"Dataset rows: {len(df):,}")
    print(f"Date range: {start.isoformat()} -> {end.isoformat()}")
    print(f"Locations: {sorted(locations)}")
    print(f"Base features: {len(FEATURE_COLUMNS)}")
    print(f"Engineered features: {len(feature_columns)}")
    print(f"Forward target classes: {sorted(int(v) for v in engineered['risk_class'].unique())}")
    print(f"Non-Digha training pool rows: {len(non_holdout):,}")
    print(f"Digha holdout rows: {len(holdout):,}")
    print("Live feature vector: OK")
    print("PREFLIGHT: PASS")


if __name__ == "__main__":
    main()
