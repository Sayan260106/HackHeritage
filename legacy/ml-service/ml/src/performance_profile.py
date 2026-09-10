"""
ORCA-X ML PERFORMANCE PROFILE

Read-only diagnostic for Colab/local execution. Measures the expensive stages used
by the refinement workflow without changing production artifacts.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import time
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "ml/data/processed/orca_historical_marine_risk.parquet"
OUT = ROOT / "ml/models/performance_profile"


def timed(name, fn):
    t0 = time.perf_counter()
    value = fn()
    elapsed = time.perf_counter() - t0
    print(f"{name:<34} {elapsed:8.2f}s")
    return value, elapsed


def main():
    print("=" * 78)
    print("ORCA-X ML PERFORMANCE PROFILE")
    print("=" * 78)
    print(f"Python: {sys.version.split()[0]}")
    print(f"pandas: {pd.__version__}")
    try:
        import xgboost as xgb
        print(f"XGBoost: {xgb.__version__}")
    except Exception as exc:
        print(f"XGBoost: unavailable ({exc})")
    try:
        gpu = subprocess.run(["nvidia-smi", "--query-gpu=name,memory.total,memory.used", "--format=csv,noheader"], capture_output=True, text=True)
        print("GPU:", gpu.stdout.strip() or "not visible")
    except OSError:
        print("GPU: not visible")

    timings = {}
    _, timings["read_parquet_s"] = timed("read_parquet", lambda: pd.read_parquet(DATA))
    df = pd.read_parquet(DATA)
    print(f"Rows: {len(df):,} | columns: {len(df.columns)}")

    loc = next(c for c in ["location", "location_name", "station", "station_id", "site"] if c in df.columns)
    ts = next(c for c in ["timestamp", "time", "datetime", "date_time"] if c in df.columns)
    targets = ["wind_speed_kts", "wind_gust_kts", "wave_height_m", "swell_height_m", "wave_period_s"]
    t0 = time.perf_counter()
    d = df.copy()
    d[ts] = pd.to_datetime(d[ts], utc=True, errors="coerce")
    d = d.dropna(subset=[ts]).sort_values([loc, ts])
    f = d[[loc, ts] + targets].copy()
    f[ts] = f[ts] - pd.Timedelta(hours=6)
    f = f.rename(columns={c: "future_" + c for c in targets})
    q = d.merge(f, on=[loc, ts], how="inner")
    valid = np.isfinite(q[["future_" + c for c in targets]].to_numpy(float)).all(axis=1)
    q = q.loc[valid].reset_index(drop=True)
    timings["pair_build_s"] = time.perf_counter() - t0
    print(f"pair_build{'':<24} {timings['pair_build_s']:8.2f}s")

    features = [
        "wind_speed_kts", "wind_gust_kts", "wind_direction_deg",
        "wave_height_m", "wave_period_s", "wave_direction_deg",
        "swell_height_m", "swell_period_s", "swell_direction_deg",
        "air_pressure_hpa", "air_temperature_c", "sea_surface_temperature_c",
        "precipitation_mm", "month", "season",
    ]
    t0 = time.perf_counter()
    X = q[[c for c in features if c in q.columns]].apply(pd.to_numeric, errors="coerce")
    timings["feature_build_s"] = time.perf_counter() - t0
    print(f"feature_build{'':<21} {timings['feature_build_s']:8.2f}s")

    report = {
        "rows_source": int(len(df)),
        "supervised_pairs": int(len(q)),
        "locations": int(q[loc].nunique()),
        "feature_count": int(X.shape[1]),
        "timings_seconds": timings,
        "recommended_strategy": "cache features/folds, train each location-fold ensemble once, cache clean/degraded predictions, evaluate all gate configurations without refitting",
        "production_modified": False,
    }
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "performance_profile.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(f"Saved: {OUT / 'performance_profile.json'}")


if __name__ == "__main__":
    main()
