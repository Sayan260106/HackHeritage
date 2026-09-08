"""ORCA-X production XGBoost inference with explicit feature-contract compatibility."""
from __future__ import annotations

import json
from datetime import datetime, timezone
import sys

from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
# pyrefly: ignore [missing-import]
import xgboost as xgb

ML_SRC = Path(__file__).resolve().parent
if str(ML_SRC) not in sys.path:
    sys.path.insert(0, str(ML_SRC))

try:
    from ml.src.config import FEATURE_COLUMNS, MODELS_DIR, RISK_CLASS_NAMES
    from ml.src.ood import check_input_domain
except ImportError:
    try:
        from config import FEATURE_COLUMNS, MODELS_DIR, RISK_CLASS_NAMES
        from ood import check_input_domain
    except ImportError:
        from .config import FEATURE_COLUMNS, MODELS_DIR, RISK_CLASS_NAMES  # type: ignore
        from .ood import check_input_domain  # type: ignore


MODEL_PATH = MODELS_DIR / "orca_xgb_risk.json"
METADATA_PATH = MODELS_DIR / "orca_xgb_risk_metadata.json"
MODEL_VERSION = "orca-xgb-risk-v2"

LEGACY_FEATURE_COLUMNS = [
    "wind_speed_kts", "wind_gust_kts", "wave_height_m", "wave_period_s",
    "mean_wave_period_s", "wind_direction_deg", "wave_direction_deg",
    "air_pressure_hpa", "air_temperature_c", "water_temperature_c",
    "latitude", "longitude", "month", "hour",
]



def _as_float(value: Any) -> float | None:
    if value is None or value == "":
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if np.isfinite(number) else None


def _observed_hour(features: dict[str, Any]) -> int:
    explicit_hour = features.get("hour")
    if explicit_hour is not None:
        try:
            h = int(explicit_hour)
            if 0 <= h <= 23:
                return h
        except (ValueError, TypeError):
            pass

    observed_at = features.get("observed_at") or features.get("observedAt")
    if observed_at:
        try:
            text = str(observed_at).strip()
            # If naive ISO string (e.g. 2026-09-08T14:00) without timezone indicator, extract hour directly
            if "T" in text and len(text) >= 13 and not text.endswith("Z") and "+" not in text[10:] and "-" not in text[10:]:
                hour_str = text.split("T")[1][:2]
                if hour_str.isdigit():
                    h = int(hour_str)
                    if 0 <= h <= 23:
                        return h
            iso_text = text.replace("Z", "+00:00")
            dt = datetime.fromisoformat(iso_text)
            if dt.tzinfo is not None:
                return dt.astimezone(timezone.utc).hour
            return dt.hour
        except ValueError:
            pass
    return datetime.now(timezone.utc).hour



def build_inference_features(features: dict[str, Any], feature_columns: list[str]) -> dict[str, float]:
    """Build exactly the features required by the loaded model.

    Point-in-time features only are supported. Lag/trend features are intentionally
    not synthesized from a single live observation because doing so would create
    an undocumented and potentially misleading inference contract.
    """
    values = dict(features)
    if values.get("mean_wave_period_s") is None:
        values["mean_wave_period_s"] = values.get("wave_period_s")
    if values.get("water_temperature_c") is None:
        values["water_temperature_c"] = values.get("sea_surface_temperature_c")
    if values.get("hour") is None:
        values["hour"] = _observed_hour(values)

    for column in FEATURE_COLUMNS:
        if values.get(column) is None:
            values[column] = np.nan

    for column in FEATURE_COLUMNS:
        values[f"{column}_missing"] = 1.0 if pd.isna(values.get(column)) else 0.0

    for column, prefix in (("wind_direction_deg", "wind"), ("wave_direction_deg", "wave"), ("swell_direction_deg", "swell")):
        direction = _as_float(values.get(column))
        radians = np.deg2rad(direction) if direction is not None else np.nan
        values[f"{prefix}_direction_sin"] = float(np.sin(radians)) if np.isfinite(radians) else np.nan
        values[f"{prefix}_direction_cos"] = float(np.cos(radians)) if np.isfinite(radians) else np.nan

    wind = _as_float(values.get("wind_speed_kts"))
    gust = _as_float(values.get("wind_gust_kts"))
    if wind is not None and gust is not None:
        values["gust_excess_kts"] = gust - wind
        values["gust_to_wind_ratio"] = gust / max(wind, 0.1)
    else:
        values["gust_excess_kts"] = np.nan
        values["gust_to_wind_ratio"] = np.nan
    values["gust_above_gale_kts"] = max((gust or 0.0) - 34.0, 0.0) if gust is not None else np.nan
    values["gust_above_extreme_kts"] = max((gust or 0.0) - 48.0, 0.0) if gust is not None else np.nan

    unsupported = [name for name in feature_columns if name not in values]
    if unsupported:
        raise ValueError(
            "The committed model requires features that cannot be derived from one live observation: "
            + ", ".join(unsupported)
        )

    result: dict[str, float] = {}
    for name in feature_columns:
        value = values[name]
        numeric = _as_float(value)
        result[name] = numeric if numeric is not None else np.nan
    return result


class OrcaXRiskPredictor:
    def __init__(self, model_path: Path = MODEL_PATH, metadata_path: Path = METADATA_PATH) -> None:
        self.model = xgb.XGBClassifier()
        self.model.load_model(str(model_path))
        self.metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
        self.feature_columns = list(self.metadata.get("features", FEATURE_COLUMNS))

        # Fail closed if the JSON metadata and the actual XGBoost artifact drift
        # apart. This prevents the application from silently feeding a model the
        # wrong columns after a future retraining or artifact replacement.
        artifact_feature_columns = list(self.model.get_booster().feature_names or [])
        if artifact_feature_columns and artifact_feature_columns != self.feature_columns:
            raise RuntimeError(
                "Model artifact feature contract does not match metadata. "
                f"artifact={artifact_feature_columns}, metadata={self.feature_columns}"
            )
        if not artifact_feature_columns:
            raise RuntimeError("Loaded XGBoost artifact does not expose feature names; refusing unverified inference.")

        supported_engineered = {
            name for name in FEATURE_COLUMNS
        } | {
            f"{name}_missing" for name in FEATURE_COLUMNS
        } | {
            "wind_direction_sin", "wind_direction_cos", "wave_direction_sin",
            "wave_direction_cos", "swell_direction_sin", "swell_direction_cos",
            "gust_excess_kts", "gust_to_wind_ratio", "gust_above_gale_kts",
            "gust_above_extreme_kts",
        }
        if self.feature_columns not in (FEATURE_COLUMNS, LEGACY_FEATURE_COLUMNS):
            unsupported = [name for name in self.feature_columns if name not in supported_engineered]
            if unsupported:
                raise RuntimeError(
                    "Model feature contract requires unsupported live features: " + ", ".join(unsupported)
                )
        if self.metadata.get("feature_count") != len(self.feature_columns):
            raise RuntimeError("Model metadata feature_count does not match the feature list.")
        expected_classes = {str(key): value for key, value in RISK_CLASS_NAMES.items()}
        if self.metadata.get("classes") != expected_classes:
            raise RuntimeError("Model class contract mismatch between metadata and inference service.")
        self.model_version = self.metadata.get(
            "model_version",
            "orca-xgb-risk-v1" if self.feature_columns == LEGACY_FEATURE_COLUMNS else MODEL_VERSION,
        )
        self.allows_native_missing = any(name.endswith("_missing") for name in self.feature_columns)

    def predict_batch(self, features_list: list[dict[str, Any]]) -> list[dict]:
        if not features_list:
            return []

        model_features_list = []
        domain_validations = []
        for features in features_list:
            model_features = build_inference_features(features, self.feature_columns)
            domain = check_input_domain(model_features, self.feature_columns)
            if domain.invalid_features:
                raise ValueError(f"Invalid model inputs: {', '.join(domain.invalid_features)}")
            model_features_list.append(model_features)
            domain_validations.append(domain.as_dict())

        df = pd.DataFrame(model_features_list, columns=self.feature_columns).apply(pd.to_numeric, errors="coerce")
        if df.isna().any().any() and not self.allows_native_missing:
            missing = df.columns[df.isna().any()].tolist()
            raise ValueError(f"Model inputs became non-numeric: {', '.join(missing)}")
        if self.allows_native_missing:
            finite_values = df.to_numpy(dtype=float)
            if not np.isfinite(finite_values[~np.isnan(finite_values)]).all():
                raise ValueError("Model inputs contain non-finite values.")
        elif not np.isfinite(df.to_numpy(dtype=float)).all():
            raise ValueError("Model inputs contain non-finite values.")

        probabilities_all = np.asarray(self.model.predict_proba(df), dtype=float)
        results = []
        for idx, probabilities in enumerate(probabilities_all):
            if len(probabilities) != 4 or not np.isfinite(probabilities).all() or (probabilities < 0).any():
                raise RuntimeError(f"Model returned invalid class probabilities at index {idx}.")
            if not np.isclose(float(probabilities.sum()), 1.0, atol=1e-6):
                raise RuntimeError(f"Model returned probabilities that do not sum to 1 at index {idx}.")

            predicted_class = int(np.argmax(probabilities))
            probability_map = {RISK_CLASS_NAMES[i]: round(float(probabilities[i]), 6) for i in range(4)}
            results.append({
                "risk_class": predicted_class,
                "risk_label": RISK_CLASS_NAMES[predicted_class],
                "confidence": max(probability_map.values()),
                "probabilities": probability_map,
                "domain_validation": domain_validations[idx],
                "model_version": self.model_version,
                "feature_contract": self.feature_columns,
            })
        return results

    def predict_one(self, features: dict[str, Any]) -> dict:
        return self.predict_batch([features])[0]

