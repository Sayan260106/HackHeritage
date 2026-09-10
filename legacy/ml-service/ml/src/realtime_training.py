"""ORCA-X live-data training pipeline.

This pipeline separates three concerns:
  1. collect point-in-time live observations from the same Open-Meteo family used by
     the application;
  2. after the +6h horizon has matured, fetch the observed future conditions and
     create a training label with the existing operational policy;
  3. train a *candidate* model using historical production-training data plus the
     matured live rows. The candidate is never promoted automatically.

Important: real-time data is not trained at the instant it arrives because its
+6h target does not exist yet. This is deliberate target-horizon discipline.
"""
from __future__ import annotations

import argparse
import json
import os
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen

import numpy as np
import pandas as pd
import xgboost as xgb

from config import (
    FEATURE_COLUMNS,
    HISTORICAL_LOCATIONS,
    MODELS_DIR,
    PROCESSED_DIR,
    RISK_CLASS_NAMES,
    RISK_HORIZON_HOURS,
)
from label_policy import assign_operational_risk
from train import _training_device, _training_n_jobs, add_dynamic_features, class_weights, load_dataset

WEATHER_ENDPOINT = "https://api.open-meteo.com/v1/forecast"
MARINE_ENDPOINT = "https://marine-api.open-meteo.com/v1/marine"
LIVE_DIR = PROCESSED_DIR / "live"
OBS_PATH = LIVE_DIR / "live_observations.parquet"
LABELED_PATH = LIVE_DIR / "live_matured_training.parquet"
CANDIDATE_PATH = MODELS_DIR / "orca_xgb_risk_live_candidate.json"
CANDIDATE_METADATA_PATH = MODELS_DIR / "orca_xgb_risk_live_candidate_metadata.json"
EVIDENCE_REPORT_PATH = Path(os.getenv("REALTIME_EVIDENCE_REPORT_PATH", "ml/evaluations/realtime_source_evidence_gate.json"))


def _get_json(endpoint: str, params: dict) -> dict:
    url = f"{endpoint}?{urlencode(params)}"
    request = Request(url, headers={"User-Agent": "ORCA-X/2.6 live-training collector"})
    with urlopen(request, timeout=30) as response:
        return json.loads(response.read().decode("utf-8"))


def _hourly_current(endpoint: str, lat: float, lon: float, variables: str) -> dict:
    return _get_json(
        endpoint,
        {
            "latitude": lat,
            "longitude": lon,
            "hourly": variables,
            "forecast_days": 1,
            "timezone": "UTC",
            "wind_speed_unit": "kn",
        },
    )


def collect_once() -> None:
    LIVE_DIR.mkdir(parents=True, exist_ok=True)
    rows: list[dict] = []
    retrieved_at = datetime.now(timezone.utc).isoformat()
    weather_vars = "wind_speed_10m,wind_gusts_10m,wind_direction_10m,temperature_2m,precipitation,visibility,surface_pressure"
    marine_vars = "wave_height,wave_direction,wave_period,swell_wave_height,swell_wave_direction,swell_wave_period,sea_surface_temperature"

    for location in HISTORICAL_LOCATIONS:
        weather = _hourly_current(WEATHER_ENDPOINT, location["latitude"], location["longitude"], weather_vars)
        marine = _hourly_current(MARINE_ENDPOINT, location["latitude"], location["longitude"], marine_vars)
        wt = weather.get("hourly", {}).get("time", [])
        mt = marine.get("hourly", {}).get("time", [])
        if not wt or not mt:
            raise RuntimeError(f"No hourly live data returned for {location['id']}")
        common = sorted(set(wt) & set(mt))
        now_hour = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0).strftime("%Y-%m-%dT%H:00")
        eligible = [t for t in common if t <= now_hour]
        if not eligible:
            raise RuntimeError(f"No current common hourly observation for {location['id']}")
        timestamp = eligible[-1]
        wi = wt.index(timestamp)
        mi = mt.index(timestamp)
        w = weather["hourly"]
        m = marine["hourly"]

        def value(source: dict, key: str, index: int):
            values = source.get(key, [])
            return values[index] if index < len(values) else None

        rows.append({
            "location_id": location["id"],
            "timestamp": pd.Timestamp(timestamp, tz="UTC"),
            "wind_speed_kts": value(w, "wind_speed_10m", wi),
            "wind_gust_kts": value(w, "wind_gusts_10m", wi),
            "wave_height_m": value(m, "wave_height", mi),
            "wave_period_s": value(m, "wave_period", mi),
            "swell_height_m": value(m, "swell_wave_height", mi),
            "swell_period_s": value(m, "swell_wave_period", mi),
            "wind_direction_deg": value(w, "wind_direction_10m", wi),
            "wave_direction_deg": value(m, "wave_direction", mi),
            "swell_direction_deg": value(m, "swell_wave_direction", mi),
            "air_pressure_hpa": value(w, "surface_pressure", wi),
            "air_temperature_c": value(w, "temperature_2m", wi),
            "sea_surface_temperature_c": value(m, "sea_surface_temperature", mi),
            "precipitation_mm": value(w, "precipitation", wi),
            "latitude": location["latitude"],
            "longitude": location["longitude"],
            "month": pd.Timestamp(timestamp, tz="UTC").month,
            "season": (pd.Timestamp(timestamp, tz="UTC").month % 12) // 3,
            "retrieved_at": retrieved_at,
            "label_status": "PENDING_6H",
        })

    new = pd.DataFrame(rows)
    if OBS_PATH.exists():
        old = pd.read_parquet(OBS_PATH)
        new = pd.concat([old, new], ignore_index=True)
    new["timestamp"] = pd.to_datetime(new["timestamp"], utc=True)
    new = new.drop_duplicates(["location_id", "timestamp"], keep="last").sort_values(["location_id", "timestamp"])
    new.to_parquet(OBS_PATH, index=False)
    print(f"Collected {len(rows)} live observations across {len(HISTORICAL_LOCATIONS)} locations.")
    print(f"Live store: {OBS_PATH}")


def _fetch_future_label(location: dict, target_time: pd.Timestamp) -> int:
    date = target_time.strftime("%Y-%m-%d")
    weather = _get_json(
        "https://archive-api.open-meteo.com/v1/archive",
        {
            "latitude": location["latitude"], "longitude": location["longitude"],
            "start_date": date, "end_date": date, "hourly": "wind_speed_10m,wind_gusts_10m",
            "timezone": "UTC", "wind_speed_unit": "kn",
        },
    )
    marine = _get_json(
        "https://marine-api.open-meteo.com/v1/marine",
        {
            "latitude": location["latitude"], "longitude": location["longitude"],
            "start_date": date, "end_date": date, "hourly": "wave_height,swell_wave_height",
            "timezone": "UTC",
        },
    )
    wt = weather.get("hourly", {}).get("time", [])
    mt = marine.get("hourly", {}).get("time", [])
    key = target_time.strftime("%Y-%m-%dT%H:00")
    if key not in wt or key not in mt:
        raise RuntimeError(f"Future +{RISK_HORIZON_HOURS}h observation unavailable for {location['id']} {key}")
    wi, mi = wt.index(key), mt.index(key)
    w = weather["hourly"]
    m = marine["hourly"]
    row = pd.Series({
        "wind_speed_kts": w["wind_speed_10m"][wi],
        "wind_gust_kts": w["wind_gusts_10m"][wi],
        "wave_height_m": m["wave_height"][mi],
        "swell_height_m": m["swell_wave_height"][mi],
    })
    return int(assign_operational_risk(row))


def mature_labels() -> None:
    if not OBS_PATH.exists():
        raise FileNotFoundError(f"No live observations found at {OBS_PATH}. Run collect first.")
    df = pd.read_parquet(OBS_PATH)
    df["timestamp"] = pd.to_datetime(df["timestamp"], utc=True)
    cutoff = pd.Timestamp.now(tz="UTC") - pd.Timedelta(hours=int(RISK_HORIZON_HOURS))
    locations = {item["id"]: item for item in HISTORICAL_LOCATIONS}
    changed = 0
    for idx, row in df.iterrows():
        if row.get("label_status") == "LABELED" or row["timestamp"] > cutoff:
            continue
        try:
            future_time = row["timestamp"] + pd.Timedelta(hours=int(RISK_HORIZON_HOURS))
            label = _fetch_future_label(locations[row["location_id"]], future_time)
        except Exception as exc:
            print(f"PENDING {row['location_id']} {row['timestamp']}: {exc}")
            continue
        df.at[idx, "future_risk_class"] = label
        df.at[idx, "label_status"] = "LABELED"
        df.at[idx, "label_observed_at"] = future_time
        changed += 1

    df.to_parquet(OBS_PATH, index=False)
    labeled = df[df["label_status"] == "LABELED"].copy()
    if labeled.empty:
        print("No matured live rows available yet.")
        print(f"Training remains WAITING_FOR_6H_LABELS. Re-run collect+mature after at least {RISK_HORIZON_HOURS} hours.")
        return
    labeled = labeled.drop(columns=["retrieved_at", "label_status", "label_observed_at"], errors="ignore")
    labeled["risk_class"] = labeled["future_risk_class"].astype(int)
    labeled = labeled.drop(columns=["future_risk_class"])
    labeled.to_parquet(LABELED_PATH, index=False)
    print(f"Matured {changed} rows; total labeled live training rows: {len(labeled):,}.")
    print(f"Matured store: {LABELED_PATH}")


def require_realtime_evidence_gate() -> dict:
    if not EVIDENCE_REPORT_PATH.exists():
        raise RuntimeError(
            f"V2.7 training blocked: evidence report not found at {EVIDENCE_REPORT_PATH}. "
            "Run `npm run analyze:realtime` after collecting parallel source telemetry."
        )
    try:
        report = json.loads(EVIDENCE_REPORT_PATH.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"V2.7 training blocked: evidence report is invalid JSON: {exc}") from exc

    gate = report.get("gate", {})
    criteria = gate.get("criteria", {})
    required_checks = ("minimum_events", "minimum_live_sources", "source_live_rate", "pairwise_evidence")
    failed = [name for name in required_checks if not bool(criteria.get(name, {}).get("pass"))]
    approval = os.getenv("ORCA_V27_DISTRIBUTION_SHIFT_APPROVED", "false").strip().lower() == "true"
    if failed or not approval:
        reasons = []
        if failed:
            reasons.append(f"evidence criteria failed: {', '.join(failed)}")
        if not approval:
            reasons.append("explicit distribution-shift approval is missing")
        raise RuntimeError(
            "V2.7 training BLOCKED — " + "; ".join(reasons) + ". "
            "Review `ml/evaluations/realtime_source_evidence_gate.json` and set "
            "ORCA_V27_DISTRIBUTION_SHIFT_APPROVED=true only after engineering/domain review."
        )
    return report


def train_live_candidate() -> None:
    if not LABELED_PATH.exists():
        print("LIVE CANDIDATE: WAITING — no matured +6h live labels are available yet.")
        print(f"Run `python ml/src/realtime_training.py collect` hourly, then `python ml/src/realtime_training.py mature` after the {RISK_HORIZON_HOURS}h horizon matures.")
        print("No model artifact was created or modified.")
        return

    evidence_report = require_realtime_evidence_gate()
    historical = load_dataset()
    live = pd.read_parquet(LABELED_PATH)
    required = {"location_id", "timestamp", *FEATURE_COLUMNS, "risk_class"}
    missing = sorted(required - set(live.columns))
    if missing:
        raise ValueError(f"Matured live dataset missing columns: {missing}")
    live["timestamp"] = pd.to_datetime(live["timestamp"], utc=True)
    live = live[live["location_id"] != "digha_wb"].copy()
    live = live[live["timestamp"] >= pd.Timestamp("2026-01-01", tz="UTC")].copy()
    if live.empty:
        print("LIVE CANDIDATE: WAITING — no eligible non-Digha 2026+ live rows available.")
        print("No model artifact was created or modified.")
        return
    live = live.drop_duplicates(["location_id", "timestamp"])

    historical, feature_columns = add_dynamic_features(historical)
    live, live_features = add_dynamic_features(live)
    if live_features != feature_columns:
        raise RuntimeError("Historical and live feature contracts differ.")

    production = historical[
        (historical["location_id"] != "digha_wb") &
        (historical["timestamp"] < pd.Timestamp("2025-01-01", tz="UTC"))
    ].copy()
    historical_2024 = historical[
        (historical["location_id"] != "digha_wb") &
        (historical["timestamp"] >= pd.Timestamp("2024-01-01", tz="UTC")) &
        (historical["timestamp"] < pd.Timestamp("2025-01-01", tz="UTC"))
    ].copy()
    production = pd.concat([production, historical_2024, live], ignore_index=True)
    if production["risk_class"].nunique() < 4:
        raise ValueError("Candidate training data does not contain all four classes.")

    weights = class_weights(production["risk_class"])
    device = _training_device()
    jobs = _training_n_jobs()
    params = dict(
        objective="multi:softprob", num_class=4, n_estimators=896,
        learning_rate=0.035, max_depth=6, min_child_weight=8,
        subsample=0.85, colsample_bytree=0.85, reg_alpha=0.15,
        reg_lambda=2.0, gamma=0.05, tree_method="hist", eval_metric="mlogloss",
        random_state=42, n_jobs=jobs,
    )
    if device == "cuda":
        params["device"] = "cuda"
    model = xgb.XGBClassifier(**params)
    model.fit(
        production[feature_columns], production["risk_class"],
        sample_weight=production["risk_class"].map(weights).to_numpy(dtype=np.float32),
        verbose=100,
    )
    MODELS_DIR.mkdir(parents=True, exist_ok=True)
    model.save_model(CANDIDATE_PATH)
    importance = sorted(zip(feature_columns, model.feature_importances_), key=lambda x: x[1], reverse=True)
    metadata = {
        "model": "XGBoost",
        "model_version": "orca-xgb-risk-v2.6-live-candidate",
        "base_model_version": "orca-xgb-risk-v2.6",
        "prediction_horizon_hours": int(RISK_HORIZON_HOURS),
        "features": feature_columns,
        "feature_count": len(feature_columns),
        "classes": {str(i): name for i, name in RISK_CLASS_NAMES.items()},
        "historical_training_period": "2020-01-01 through 2024-12-31 17:00 UTC",
        "live_training_period": f"2026-01-01 through {live['timestamp'].max().isoformat()}",
        "live_rows": int(len(live)),
        "training_rows": int(len(production)),
        "digha_excluded_from_training": True,
        "label_source": "Open-Meteo observed +6h conditions transformed by ORCA operational risk policy",
        "realtime_evidence_report": str(EVIDENCE_REPORT_PATH),
        "realtime_evidence_event_count": int(evidence_report.get("event_count", 0)),
        "distribution_shift_approval": True,
        "device": device,
        "n_jobs": jobs,
        "feature_importance": {name: float(value) for name, value in importance},
        "promotion": "MANUAL_REVIEW_ONLY",
    }
    CANDIDATE_METADATA_PATH.write_text(json.dumps(metadata, indent=2), encoding="utf-8")
    print(f"Live candidate trained: {CANDIDATE_PATH}")
    print(f"Candidate metadata: {CANDIDATE_METADATA_PATH}")
    print("PROMOTION: BLOCKED — evaluate candidate before replacing production artifact.")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["collect", "mature", "train-candidate"])
    args = parser.parse_args()
    {"collect": collect_once, "mature": mature_labels, "train-candidate": train_live_candidate}[args.command]()


if __name__ == "__main__":
    main()
