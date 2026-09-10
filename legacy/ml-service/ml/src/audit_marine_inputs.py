"""Audit historical marine inputs before risk-policy/model training.

The audit is intentionally diagnostic: it does not silently clip, winsorize,
or rewrite observations. Suspicious source values must remain visible so the
team can investigate the upstream provider or variable semantics.
"""
from __future__ import annotations

import json
from pathlib import Path
import pandas as pd

from config import PROCESSED_DIR

REQUIRED = [
    "wind_speed_kts", "wind_gust_kts", "wave_height_m", "wave_period_s",
    "swell_height_m", "swell_period_s", "wind_direction_deg",
    "wave_direction_deg", "swell_direction_deg", "air_pressure_hpa",
    "air_temperature_c", "sea_surface_temperature_c", "precipitation_mm",
    "latitude", "longitude", "month", "season",
]

# Conservative diagnostic bounds. Values outside these ranges are flagged, not
# automatically deleted, because provider/model-specific extremes can be real.
BOUNDS = {
    "wind_speed_kts": (0.0, 120.0),
    "wind_gust_kts": (0.0, 160.0),
    "wave_height_m": (0.0, 20.0),
    "wave_period_s": (0.0, 30.0),
    "swell_height_m": (0.0, 20.0),
    "swell_period_s": (0.0, 30.0),
    "wind_direction_deg": (0.0, 360.0),
    "wave_direction_deg": (0.0, 360.0),
    "swell_direction_deg": (0.0, 360.0),
    "air_pressure_hpa": (850.0, 1100.0),
    "air_temperature_c": (-20.0, 55.0),
    "sea_surface_temperature_c": (-5.0, 40.0),
    "precipitation_mm": (0.0, 500.0),
}


def pct(mask: pd.Series) -> float:
    return round(float(mask.mean() * 100), 3)


def main() -> None:
    path = PROCESSED_DIR / "orca_historical_marine_risk.parquet"
    if not path.exists():
        raise FileNotFoundError(f"Missing processed dataset: {path}")
    df = pd.read_parquet(path)

    missing_columns = [c for c in REQUIRED if c not in df.columns]
    if missing_columns:
        raise ValueError(f"Missing required model inputs: {missing_columns}")

    for column in REQUIRED:
        df[column] = pd.to_numeric(df[column], errors="coerce")

    wind = df["wind_speed_kts"]
    gust = df["wind_gust_kts"]
    gust_ratio = gust / wind.replace(0, pd.NA)

    range_flags = {}
    for column, (lower, upper) in BOUNDS.items():
        values = df[column]
        mask = values.notna() & ((values < lower) | (values > upper))
        range_flags[column] = {
            "lower": lower,
            "upper": upper,
            "count": int(mask.sum()),
            "percent": pct(mask),
        }

    report = {
        "rows": int(len(df)),
        "locations": int(df["location_id"].nunique()) if "location_id" in df else None,
        "time_min": str(df["timestamp"].min()) if "timestamp" in df else None,
        "time_max": str(df["timestamp"].max()) if "timestamp" in df else None,
        "missing_percent": {c: round(float(df[c].isna().mean() * 100), 3) for c in REQUIRED},
        "wind_summary_kts": {
            "median": round(float(wind.median()), 3),
            "p95": round(float(wind.quantile(.95)), 3),
            "p99": round(float(wind.quantile(.99)), 3),
            "max": round(float(wind.max()), 3),
            "ge_48_percent": pct(wind >= 48),
        },
        "gust_summary_kts": {
            "median": round(float(gust.median()), 3),
            "p95": round(float(gust.quantile(.95)), 3),
            "p99": round(float(gust.quantile(.99)), 3),
            "max": round(float(gust.max()), 3),
            "ge_48_percent": pct(gust >= 48),
        },
        "gust_vs_sustained": {
            "median_ratio": round(float(gust_ratio.dropna().median()), 3),
            "p95_ratio": round(float(gust_ratio.dropna().quantile(.95)), 3),
            "count_gust_lt_wind": int((gust < wind).sum()),
            "percent_gust_lt_wind": pct(gust < wind),
            "count_ratio_ge_3": int((gust_ratio >= 3).sum()),
            "percent_ratio_ge_3": pct(gust_ratio >= 3),
            "count_ratio_ge_5": int((gust_ratio >= 5).sum()),
            "percent_ratio_ge_5": pct(gust_ratio >= 5),
        },
        "range_flags": range_flags,
        "interpretation": (
            "This report is diagnostic only. It does not clip or remove observations. "
            "Open-Meteo wind speed/gust are converted from m/s to knots in prepare_dataset.py. "
            "A large gust distribution is not automatically treated as an error; it is why the "
            "ORCA-X policy uses sustained wind as the primary severity signal and gust as a secondary modifier."
        ),
    }

    out = Path(__file__).resolve().parents[1] / "models" / "marine_input_audit.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report, indent=2))
    print(f"Saved marine input audit: {out}")


if __name__ == "__main__":
    main()
