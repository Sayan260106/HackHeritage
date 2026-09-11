"""ORCA-X Marine Multi-Source Real-Time Data Auditor & Precision Fusion Engine (Model 1).

Audits live environmental telemetry across concurrent observation sources:
- Open-Meteo (High-resolution atmospheric and wave forecast models)
- INCOIS ERDDAP (In-situ Indian Argo floats and moored coastal buoys)
- MOSDAC / ISRO (Oceansat / INSAT satellite scatterometer, altimeter, and SST)
- Copernicus STAC (Sentinel Synthetic Aperture Radar and Ocean Color)

Auditing steps:
1. Physical Plausibility: strict climatological & hydrodynamic bounds checking.
2. Cross-Sensor Consistency: physical correlation checks (e.g. wind vs wave state).
3. Spatio-Temporal Weighting: decay based on observation age and spatial distance.
4. Source Reliability Prioritization: in-situ buoys > satellite observations > numerical model.
5. Precision Fusion: produces a canonical, unified precision vector + audit trace.
"""
from __future__ import annotations

from datetime import datetime, timezone
import math
from typing import Any, Dict, List, Optional, Tuple


# Climatological & physical validity ranges for Indian coastal waters
PHYSICAL_BOUNDS: Dict[str, Tuple[float, float]] = {
    "wind_speed_kts": (0.0, 150.0),
    "wind_gust_kts": (0.0, 180.0),
    "wave_height_m": (0.0, 25.0),
    "wave_period_s": (1.0, 30.0),
    "mean_wave_period_s": (1.0, 30.0),
    "swell_height_m": (0.0, 20.0),
    "swell_period_s": (1.0, 30.0),
    "wind_direction_deg": (0.0, 360.0),
    "wave_direction_deg": (0.0, 360.0),
    "swell_direction_deg": (0.0, 360.0),
    "air_pressure_hpa": (870.0, 1085.0),
    "air_temperature_c": (-5.0, 55.0),
    "water_temperature_c": (10.0, 42.0),
    "sea_surface_temperature_c": (10.0, 42.0),
    "precipitation_mm": (0.0, 400.0),
    "visibility_km": (0.0, 100.0),
    "current_speed_kts": (0.0, 15.0),
    "current_direction_deg": (0.0, 360.0),
}

# Base source authority weights (higher = greater ground-truth reliability)
SOURCE_BASE_PRIORITY: Dict[str, float] = {
    "INCOIS": 1.0,      # Ground-truth moored buoys & Argo floats
    "MOSDAC": 0.85,     # Satellite remote sensing (ISRO Oceansat / INSAT)
    "COPERNICUS": 0.85, # Satellite SAR / Sentinel data
    "OPEN_METEO": 0.70, # High-resolution ECMWF / GFS numerical models
}

DEFAULT_MAX_STALENESS_HOURS = 12.0
DEFAULT_MAX_DISTANCE_KM = 300.0


def _haversine_distance_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6371.0
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    delta_phi = math.radians(lat2 - lat1)
    delta_lambda = math.radians(lon2 - lon1)
    a = math.sin(delta_phi / 2.0) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(delta_lambda / 2.0) ** 2
    c = 2.0 * math.atan2(math.sqrt(a), math.sqrt(1.0 - a))
    return r * c


def _parse_timestamp(ts: Any) -> Optional[datetime]:
    if isinstance(ts, datetime):
        return ts if ts.tzinfo else ts.replace(tzinfo=timezone.utc)
    if isinstance(ts, str):
        try:
            clean_ts = ts.replace("Z", "+00:00")
            dt = datetime.fromisoformat(clean_ts)
            return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
        except Exception:
            return None
    return None


class MarineSourceAuditor:
    """Audits multi-source marine telemetry and synthesizes the optimal precision vector."""

    def __init__(
        self,
        max_staleness_hours: float = DEFAULT_MAX_STALENESS_HOURS,
        max_distance_km: float = DEFAULT_MAX_DISTANCE_KM,
    ):
        self.max_staleness_hours = max_staleness_hours
        self.max_distance_km = max_distance_km

    def audit_single_value(self, variable: str, value: Any) -> Tuple[Optional[float], Optional[str]]:
        """Validate whether a measurement is numeric and physically plausible."""
        if value is None:
            return None, None
        try:
            val_float = float(value)
        except (ValueError, TypeError):
            return None, f"Non-numeric value for {variable}: {value}"

        if not math.isfinite(val_float):
            return None, f"Non-finite value for {variable}: {value}"

        bounds = PHYSICAL_BOUNDS.get(variable)
        if bounds:
            low, high = bounds
            if val_float < low or val_float > high:
                return None, f"Physical bounds violation for {variable}: {val_float} not in [{low}, {high}]"

        return val_float, None

    def calculate_source_weight(
        self,
        source_name: str,
        observed_at: Optional[datetime],
        target_lat: float,
        target_lon: float,
        source_lat: Optional[float] = None,
        source_lon: Optional[float] = None,
        now: Optional[datetime] = None,
    ) -> Tuple[float, Dict[str, Any]]:
        """Calculate dynamic weight based on authority, freshness decay, and spatial proximity."""
        now_dt = now or datetime.now(timezone.utc)
        base_priority = SOURCE_BASE_PRIORITY.get(source_name.upper(), 0.5)

        # 1. Freshness decay
        age_hours = 0.0
        freshness_factor = 1.0
        if observed_at:
            age_hours = max(0.0, (now_dt - observed_at).total_seconds() / 3600.0)
            if age_hours > self.max_staleness_hours:
                # Exponential decay penalty for stale telemetry
                freshness_factor = math.exp(-0.35 * (age_hours - self.max_staleness_hours))
            else:
                freshness_factor = 1.0 - 0.02 * age_hours
            freshness_factor = max(0.05, freshness_factor)

        # 2. Spatial proximity decay
        dist_km = 0.0
        distance_factor = 1.0
        if source_lat is not None and source_lon is not None:
            dist_km = _haversine_distance_km(target_lat, target_lon, source_lat, source_lon)
            if dist_km > self.max_distance_km:
                distance_factor = math.exp(-0.01 * (dist_km - self.max_distance_km))
            else:
                distance_factor = 1.0 - 0.001 * dist_km
            distance_factor = max(0.05, distance_factor)

        effective_weight = base_priority * freshness_factor * distance_factor

        diagnostics = {
            "source": source_name,
            "base_priority": round(base_priority, 3),
            "age_hours": round(age_hours, 2),
            "freshness_factor": round(freshness_factor, 3),
            "distance_km": round(dist_km, 2),
            "distance_factor": round(distance_factor, 3),
            "effective_weight": round(effective_weight, 4),
        }
        return effective_weight, diagnostics

    def audit_and_fuse(
        self,
        sources_payload: Dict[str, Any],
        target_lat: float,
        target_lon: float,
        now: Optional[datetime] = None,
    ) -> Dict[str, Any]:
        """Audit all provided sources and produce one consensus precision feature vector.

        sources_payload structure:
        {
          "OPEN_METEO": { "observed_at": "...", "lat": ..., "lon": ..., "values": { ... } },
          "INCOIS": { "observed_at": "...", "lat": ..., "lon": ..., "values": { ... } },
          "MOSDAC": { ... },
          "COPERNICUS": { ... }
        }
        """
        now_dt = now or datetime.now(timezone.utc)
        audit_warnings: List[str] = []
        source_diagnostics: Dict[str, Any] = {}
        variable_candidates: Dict[str, List[Dict[str, Any]]] = {}

        # Parse and audit each individual source feed
        for source_name, source_data in sources_payload.items():
            if not isinstance(source_data, dict):
                continue

            values = source_data.get("values") or {}
            observed_ts = _parse_timestamp(source_data.get("observed_at") or source_data.get("observedAt"))
            src_lat = source_data.get("lat") or source_data.get("latitude")
            src_lon = source_data.get("lon") or source_data.get("longitude")

            weight, diag = self.calculate_source_weight(
                source_name=source_name,
                observed_at=observed_ts,
                target_lat=target_lat,
                target_lon=target_lon,
                source_lat=float(src_lat) if src_lat is not None else None,
                source_lon=float(src_lon) if src_lon is not None else None,
                now=now_dt,
            )
            source_diagnostics[source_name] = diag

            for var_key, raw_val in values.items():
                clean_val, err = self.audit_single_value(var_key, raw_val)
                if err:
                    audit_warnings.append(f"[{source_name}] {err}")
                    continue
                if clean_val is None:
                    continue

                if var_key not in variable_candidates:
                    variable_candidates[var_key] = []

                variable_candidates[var_key].append({
                    "source": source_name,
                    "value": clean_val,
                    "weight": weight,
                })

        # Reliability-Aware Weighted Precision Fusion
        fused_vector: Dict[str, float] = {}
        provenance_per_variable: Dict[str, Any] = {}

        for var_name, candidates in variable_candidates.items():
            if not candidates:
                continue

            total_weight = sum(c["weight"] for c in candidates)
            if total_weight <= 0:
                fused_vector[var_name] = candidates[0]["value"]
                continue

            # Check for high variance / sensor disagreement across sources
            vals = [c["value"] for c in candidates]
            if len(vals) > 1:
                spread = max(vals) - min(vals)
                # Flag extreme disagreement in critical wave or wind variables
                if var_name in ("wave_height_m", "wind_speed_kts") and spread > 3.0:
                    audit_warnings.append(
                        f"High sensor disagreement on {var_name}: spread of {spread:.2f} across sources"
                    )

            # Circular mean for directional angles (0-360 degrees)
            if var_name.endswith("_deg"):
                sin_sum = sum(c["weight"] * math.sin(math.radians(c["value"])) for c in candidates)
                cos_sum = sum(c["weight"] * math.cos(math.radians(c["value"])) for c in candidates)
                fused_deg = math.degrees(math.atan2(sin_sum, cos_sum)) % 360.0
                fused_vector[var_name] = round(fused_deg, 1)
            else:
                weighted_val = sum(c["weight"] * c["value"] for c in candidates) / total_weight
                fused_vector[var_name] = round(weighted_val, 2)

            provenance_per_variable[var_name] = {
                "fused_value": fused_vector[var_name],
                "sources_used": [c["source"] for c in candidates],
                "candidate_count": len(candidates),
                "weights": {c["source"]: round(c["weight"] / total_weight, 3) for c in candidates},
            }

        # 2. Physics Cross-Consistency Checks on Fused Vector
        wave_h = fused_vector.get("wave_height_m")
        wind_spd = fused_vector.get("wind_speed_kts")
        if wave_h is not None and wind_spd is not None:
            # Physical impossible: hurricane wind (>64 kts) with flat sea (<0.3m)
            if wind_spd > 50.0 and wave_h < 0.5:
                audit_warnings.append(
                    f"Physical anomaly: Sustained wind of {wind_spd} kts contradicts wave height of {wave_h}m"
                )

        # Ensure spatial & temporal coordinates are present in fused vector
        fused_vector["latitude"] = target_lat
        fused_vector["longitude"] = target_lon
        fused_vector["month"] = now_dt.month
        fused_vector["hour"] = now_dt.hour

        # Physical Hydrodynamic Imputation for downstream legacy models if partially unobserved
        if "wind_speed_kts" in fused_vector and "wind_gust_kts" not in fused_vector:
            # Gust is typically 1.25x - 1.35x sustained wind over open marine waters
            fused_vector["wind_gust_kts"] = round(fused_vector["wind_speed_kts"] * 1.3, 2)

        if "wave_height_m" in fused_vector and "wave_period_s" not in fused_vector:
            # Fully developed sea state: T ≈ 3.5 * sqrt(Hs)
            fused_vector["wave_period_s"] = round(max(3.0, 3.8 * math.sqrt(max(0.1, fused_vector["wave_height_m"]))), 2)

        if "wave_period_s" in fused_vector and "mean_wave_period_s" not in fused_vector:
            fused_vector["mean_wave_period_s"] = fused_vector["wave_period_s"]

        if "wind_direction_deg" not in fused_vector:
            fused_vector["wind_direction_deg"] = 180.0  # Prevailing southerly marine wind

        if "wave_direction_deg" not in fused_vector:
            fused_vector["wave_direction_deg"] = fused_vector.get("wind_direction_deg", 180.0)

        if "air_pressure_hpa" not in fused_vector:
            fused_vector["air_pressure_hpa"] = 1013.25  # Standard sea level pressure

        if "air_temperature_c" not in fused_vector and "sea_surface_temperature_c" in fused_vector:
            fused_vector["air_temperature_c"] = fused_vector["sea_surface_temperature_c"]
        elif "air_temperature_c" in fused_vector and "water_temperature_c" not in fused_vector:
            fused_vector["water_temperature_c"] = fused_vector.get("sea_surface_temperature_c", fused_vector["air_temperature_c"])
        elif "water_temperature_c" not in fused_vector and "sea_surface_temperature_c" in fused_vector:
            fused_vector["water_temperature_c"] = fused_vector["sea_surface_temperature_c"]

        # Overall precision quality score
        active_sources_count = len([d for d in source_diagnostics.values() if d.get("effective_weight", 0) > 0.1])
        quality_score = min(1.0, 0.4 + 0.2 * active_sources_count)
        if audit_warnings:
            quality_score = max(0.2, quality_score - 0.1 * min(len(audit_warnings), 4))

        return {
            "audited_vector": fused_vector,
            "quality_score": round(quality_score, 3),
            "active_sources": list(source_diagnostics.keys()),
            "source_diagnostics": source_diagnostics,
            "provenance_per_variable": provenance_per_variable,
            "audit_warnings": audit_warnings,
            "audited_at": now_dt.isoformat(),
            "model_version": "orca-source-auditor-v1",
        }
