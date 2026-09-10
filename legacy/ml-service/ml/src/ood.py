"""Conservative physical-domain validation for ORCA-X models."""
from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any, Iterable

import numpy as np

from config import FEATURE_COLUMNS

PHYSICAL_RANGES: dict[str, tuple[float, float]] = {
    "wind_speed_kts": (0.0, 150.0), "wind_gust_kts": (0.0, 180.0),
    "wave_height_m": (0.0, 30.0), "wave_period_s": (0.0, 40.0),
    "mean_wave_period_s": (0.0, 40.0), "swell_height_m": (0.0, 30.0),
    "swell_period_s": (0.0, 60.0), "wind_direction_deg": (0.0, 360.0),
    "wave_direction_deg": (0.0, 360.0), "swell_direction_deg": (0.0, 360.0),
    "air_pressure_hpa": (850.0, 1100.0), "air_temperature_c": (-80.0, 60.0),
    "water_temperature_c": (-5.0, 45.0), "sea_surface_temperature_c": (-5.0, 45.0),
    "precipitation_mm": (0.0, 500.0), "visibility_km": (0.0, 100.0),
    "latitude": (-90.0, 90.0), "longitude": (-180.0, 180.0),
    "month": (1.0, 12.0), "hour": (0.0, 23.0), "season": (0.0, 3.0),
}

TRAINING_DATASET = "Open-Meteo historical weather + marine observations at six Indian coastal regions (2020-2025)"
DEPLOYMENT_VALIDATION_STATUS = "INDIAN_COASTAL_HISTORICAL_PROXY_VALIDATED_NOT_A_STATUTORY_WARNING"


@dataclass(frozen=True)
class DomainCheck:
    status: str
    invalid_features: list[str]
    warnings: list[str]
    training_dataset: str
    deployment_validation_status: str

    def as_dict(self) -> dict[str, Any]:
        return {
            "status": self.status,
            "invalid_features": self.invalid_features,
            "warnings": self.warnings,
            "training_dataset": self.training_dataset,
            "deployment_validation_status": self.deployment_validation_status,
        }


def check_input_domain(features: dict[str, Any], feature_names: Iterable[str] | None = None) -> DomainCheck:
    invalid: list[str] = []
    warnings: list[str] = []
    names = list(feature_names or FEATURE_COLUMNS)

    for name in names:
        # Engineered indicators are not physical measurements and therefore do
        # not have independent physical ranges.
        if name.endswith("_missing"):
            continue
        if name.endswith("_direction_sin") or name.endswith("_direction_cos"):
            value = features.get(name)
            if value is not None:
                try:
                    numeric = float(value)
                    if not -1.000001 <= numeric <= 1.000001:
                        invalid.append(name)
                except (TypeError, ValueError):
                    invalid.append(name)
            continue
        if name in {"gust_excess_kts", "gust_to_wind_ratio", "gust_above_gale_kts", "gust_above_extreme_kts"}:
            value = features.get(name)
            if value is None:
                continue
            try:
                numeric = float(value)
                if name == "gust_to_wind_ratio" and numeric < 0:
                    invalid.append(name)
                elif name != "gust_to_wind_ratio" and numeric < 0:
                    invalid.append(name)
            except (TypeError, ValueError):
                invalid.append(name)
            continue

        if name not in PHYSICAL_RANGES:
            invalid.append(name)
            continue

        raw = features.get(name)
        if raw is None:
            warnings.append(f"Missing optional model input: {name}; XGBoost may use its native missing-value path.")
            continue
        try:
            numeric = float(raw)
        except (TypeError, ValueError):
            invalid.append(name)
            continue
        if numeric != numeric:  # NaN
            warnings.append(f"Missing optional model input: {name}; XGBoost may use its native missing-value path.")
            continue
        minimum, maximum = PHYSICAL_RANGES[name]
        if not minimum <= numeric <= maximum:
            invalid.append(name)

    if invalid:
        warnings.append("One or more model inputs are outside conservative physical bounds or malformed.")
    warnings.append("The Refinement 4 target is an operational proxy rather than incident outcomes or statutory warnings.")
    return DomainCheck(
        "INVALID_INPUT" if invalid else "UNVALIDATED_DEPLOYMENT_DOMAIN",
        sorted(set(invalid)),
        list(dict.fromkeys(warnings)),
        TRAINING_DATASET,
        DEPLOYMENT_VALIDATION_STATUS,
    )


def validate_live_coordinates_and_timestamp(features: dict[str, Any]) -> None:
    """Strictly validates that a live inference payload contains required coordinates and timestamps.

    Rejects missing coordinates or timestamps to guarantee zero synthetic feature generation.
    """
    lat = features.get("latitude")
    if lat is None:
        raise ValueError("Missing required live coordinate: 'latitude' is mandatory.")
    try:
        lat_f = float(lat)
        if not (-90.0 <= lat_f <= 90.0) or not np.isfinite(lat_f):
            raise ValueError(f"Invalid latitude: {lat}. Must be a finite number between -90 and 90.")
    except (TypeError, ValueError) as exc:
        raise ValueError(f"Invalid latitude: {lat}. Must be a finite number between -90 and 90.") from exc

    lon = features.get("longitude")
    if lon is None:
        raise ValueError("Missing required live coordinate: 'longitude' is mandatory.")
    try:
        lon_f = float(lon)
        if not (-180.0 <= lon_f <= 180.0) or not np.isfinite(lon_f):
            raise ValueError(f"Invalid longitude: {lon}. Must be a finite number between -180 and 180.")
    except (TypeError, ValueError) as exc:
        raise ValueError(f"Invalid longitude: {lon}. Must be a finite number between -180 and 180.") from exc

    # Timestamp validation: must have observed_at/observedAt or explicit month & hour
    observed_at = features.get("observed_at") or features.get("observedAt")
    has_explicit_time = features.get("month") is not None and features.get("hour") is not None

    if not observed_at and not has_explicit_time:
        raise ValueError(
            "Missing required observation timestamp: payload must provide 'observed_at' (ISO timestamp) "
            "or explicit 'month' and 'hour'."
        )

    if has_explicit_time:
        try:
            m = int(features["month"])
            h = int(features["hour"])
            if not (1 <= m <= 12):
                raise ValueError(f"Invalid month: {m}. Must be between 1 and 12.")
            if not (0 <= h <= 23):
                raise ValueError(f"Invalid hour: {h}. Must be between 0 and 23.")
        except (TypeError, ValueError) as exc:
            raise ValueError(f"Invalid time coordinates: {exc}") from exc


def detect_extreme_ood_anomalies(features: dict[str, Any]) -> dict[str, Any]:
    """Out-Of-Distribution (OOD) detector for extreme marine weather anomalies.

    Identifies unprecedented weather events exceeding the historical Indian coastal training envelope
    (e.g., severe cyclonic storm surges, category-4/5 hurricane winds, rogue breaking waves).
    """
    anomalies: list[str] = []

    wave_height = features.get("wave_height_m")
    if wave_height is not None:
        try:
            wh = float(wave_height)
            if wh > 9.0:
                anomalies.append(f"Unprecedented rogue/cyclonic wave height ({wh:.1f}m > 9.0m historical coastal envelope)")
        except (TypeError, ValueError):
            pass

    wind_gust = features.get("wind_gust_kts")
    if wind_gust is not None:
        try:
            wg = float(wind_gust)
            if wg > 80.0:
                anomalies.append(f"Severe cyclonic wind gust ({wg:.1f} kts > 80.0 kts historical coastal envelope)")
        except (TypeError, ValueError):
            pass

    wind_speed = features.get("wind_speed_kts")
    if wind_speed is not None:
        try:
            ws = float(wind_speed)
            if ws > 64.0:
                anomalies.append(f"Hurricane/super-cyclonic sustained wind speed ({ws:.1f} kts > 64.0 kts)")
        except (TypeError, ValueError):
            pass

    pressure = features.get("air_pressure_hpa")
    if pressure is not None:
        try:
            pr = float(pressure)
            if pr < 950.0:
                anomalies.append(f"Deep cyclonic core pressure depression ({pr:.1f} hPa < 950.0 hPa)")
            elif pr > 1045.0:
                anomalies.append(f"Extreme high pressure anomaly ({pr:.1f} hPa > 1045.0 hPa)")
        except (TypeError, ValueError):
            pass

    sst = features.get("water_temperature_c") or features.get("sea_surface_temperature_c")
    if sst is not None:
        try:
            t = float(sst)
            if t > 35.0:
                anomalies.append(f"Unprecedented marine heatwave SST ({t:.1f}°C > 35.0°C)")
            elif t < 14.0:
                anomalies.append(f"Extreme low ocean temperature anomaly ({t:.1f}°C < 14.0°C for Indian waters)")
        except (TypeError, ValueError):
            pass

    is_ood = len(anomalies) > 0
    severity = "EXTREME_CYCLONIC_ANOMALY" if is_ood else "NORMAL"

    return {
        "is_ood": is_ood,
        "severity": severity,
        "anomalies": anomalies,
        "recommendation": (
            "IMMEDIATE MARITIME EVACUATION: Conditions exceed the statistical training envelope of operational models. "
            "Heed statutory IMD/INCOIS cyclone bulletins and Coast Guard emergency instructions immediately."
            if is_ood
            else "Conditions are within the normal operational distribution envelope."
        ),
    }

