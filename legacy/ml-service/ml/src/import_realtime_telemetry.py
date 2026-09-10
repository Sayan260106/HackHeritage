"""Convert persisted ORCA-X fused telemetry into the ML live-observation store.

The server is the source of truth for live feature fusion. This importer intentionally
copies only the fused 17-feature vector plus provenance into a Parquet store used by the
existing +6h maturation/candidate-training pipeline. It never creates labels and never
changes a production model.
"""
from __future__ import annotations

import json
import os
from pathlib import Path

import pandas as pd

from config import HISTORICAL_LOCATIONS, PROCESSED_DIR

TELEMETRY_PATH = Path(os.environ.get("ORCA_TELEMETRY_PATH", "data/realtime/marine_telemetry.jsonl"))
LIVE_DIR = PROCESSED_DIR / "live"
OBS_PATH = LIVE_DIR / "live_observations.parquet"

VARIABLE_TO_COLUMN = {
    "windSpeedKts": "wind_speed_kts",
    "windGustKts": "wind_gust_kts",
    "waveHeightMeters": "wave_height_m",
    "wavePeriodSec": "wave_period_s",
    "swellHeightMeters": "swell_height_m",
    "swellPeriodSec": "swell_period_s",
    "windDirectionDeg": "wind_direction_deg",
    "waveDirectionDeg": "wave_direction_deg",
    "swellDirectionDeg": "swell_direction_deg",
    "pressureHpa": "air_pressure_hpa",
    "airTemperatureC": "air_temperature_c",
    "seaSurfaceTemperatureC": "sea_surface_temperature_c",
    "precipitationMm": "precipitation_mm",
}


def resolve_location_id(latitude: float, longitude: float) -> str | None:
    candidates = []
    for location in HISTORICAL_LOCATIONS:
        distance = ((float(location["latitude"]) - latitude) ** 2 + (float(location["longitude"]) - longitude) ** 2) ** 0.5
        candidates.append((distance, location["id"]))
    distance, location_id = min(candidates)
    return location_id if distance <= float(os.environ.get("REALTIME_ML_LOCATION_MATCH_DEG", "0.25")) else None


def load_events() -> list[dict]:
    if not TELEMETRY_PATH.exists():
        raise FileNotFoundError(f"Telemetry file not found: {TELEMETRY_PATH}. Start the realtime collector first.")
    events: list[dict] = []
    with TELEMETRY_PATH.open("r", encoding="utf-8") as handle:
        for line_number, line in enumerate(handle, start=1):
            if not line.strip():
                continue
            try:
                item = json.loads(line)
            except json.JSONDecodeError as exc:
                print(f"SKIP telemetry line {line_number}: invalid JSON ({exc})")
                continue
            if isinstance(item, dict):
                events.append(item)
    return events


def event_to_row(event: dict) -> dict | None:
    try:
        latitude = float(event["latitude"])
        longitude = float(event["longitude"])
        timestamp = pd.to_datetime(event["timestamp"], utc=True)
        if pd.isna(timestamp):
            return None
        timestamp = pd.Timestamp(timestamp)
    except (KeyError, TypeError, ValueError):
        return None

    location_id = resolve_location_id(latitude, longitude)
    if not location_id:
        return None

    fused = event.get("fusedValues") or {}
    if not isinstance(fused, dict) or not fused:
        return None

    row = {
        "location_id": location_id,
        "timestamp": timestamp,
        "latitude": latitude,
        "longitude": longitude,
        "month": timestamp.month,
        "season": (timestamp.month % 12) // 3,
        "retrieved_at": event.get("timestamp"),
        "label_status": "PENDING_6H",
        "source_data_quality": event.get("dataQuality", "UNKNOWN"),
        "live_source_count": sum(
            1 for source in event.get("sources", [])
            if isinstance(source, dict) and source.get("availability") == "LIVE"
        ),
        "feature_sources_json": json.dumps(event.get("featureSources") or {}, sort_keys=True),
        "source_scores_json": json.dumps(event.get("sourceScores") or {}, sort_keys=True),
    }

    for variable, column in VARIABLE_TO_COLUMN.items():
        value = fused.get(variable)
        row[column] = float(value) if isinstance(value, (int, float)) and pd.notna(value) else None

    return row


def main() -> None:
    LIVE_DIR.mkdir(parents=True, exist_ok=True)
    rows = [row for event in load_events() if (row := event_to_row(event)) is not None]
    if not rows:
        print("No usable fused telemetry rows found.")
        return

    new = pd.DataFrame(rows)
    if OBS_PATH.exists():
        old = pd.read_parquet(OBS_PATH)
        # Keep older pending/matured rows while replacing duplicate timestamps with
        # the newest server-side fused representation.
        new = pd.concat([old, new], ignore_index=True)

    new["timestamp"] = pd.to_datetime(new["timestamp"], utc=True)
    new = new.drop_duplicates(["location_id", "timestamp"], keep="last")
    new = new.sort_values(["location_id", "timestamp"])
    new.to_parquet(OBS_PATH, index=False)

    quality_counts = new["source_data_quality"].value_counts(dropna=False).to_dict()
    source_counts = new["live_source_count"].value_counts(dropna=False).sort_index().to_dict()
    print(f"Imported {len(rows):,} fused telemetry rows into {OBS_PATH}")
    print(f"Unique ML observations: {len(new):,}")
    print(f"Data-quality distribution: {quality_counts}")
    print(f"Live-source-count distribution: {source_counts}")
    print("No labels or model artifacts were created/modified.")


if __name__ == "__main__":
    main()
