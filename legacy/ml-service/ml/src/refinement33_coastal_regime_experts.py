"""Refinement 33 — Coastal Regime / Expert Model Optimization.

Read-only benchmark for ORCA-X's six operational coastal regimes.

Strategies compared:
  A. global: one global multi-output regression ensemble.
  B. expert: one independently trained model per known coast.
  C. global_residual: global model plus a per-coast residual correction learned
     only from a temporally earlier calibration split.

Validation is deliberately strict: +6h forward targets, chronological 2024
fit/calibration versus 2025 test, ten degradation scenarios, and six-coast
spatial holdouts for the global strategy. No production artifact is modified.

Run from the repository root (or ml/src). Colab T4/L4 is recommended.
"""
from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path

import numpy as np
import pandas as pd
import xgboost as xgb
from sklearn.metrics import accuracy_score, balanced_accuracy_score, f1_score, mean_absolute_error, r2_score

HERE = Path(__file__).resolve()
ML_ROOT = HERE.parents[1]
if str(HERE.parent) not in sys.path:
    sys.path.insert(0, str(HERE.parent))

from config import FEATURE_COLUMNS, PROCESSED_DIR, RISK_HORIZON_HOURS

RANDOM_STATE = 42
LOCATION_COLUMN = "location_id"
TIMESTAMP_COLUMN = "timestamp"
TARGET_COLUMNS = [
    "wind_speed_kts", "wind_gust_kts", "wave_height_m", "swell_height_m", "wave_period_s",
]
OUTPUT_DIR = ML_ROOT / "models" / "refinement33"
SCENARIOS = [
    "clean", "random_missing_10", "random_missing_25", "random_missing_40",
    "wind_outage", "sea_state_outage", "atmospheric_outage",
    "stale_wind", "stale_sea_state", "mixed_degradation",
]
FEATURES = list(FEATURE_COLUMNS)


def device_name() -> str:
    value = os.getenv("ORCA_X_DEVICE", "cpu").strip().lower()
    if value in {"gpu", "cuda", "cuda:0"}:
        return "cuda"
    if value == "cpu":
        return "cpu"
    raise ValueError("ORCA_X_DEVICE must be one of: cpu, cuda, gpu, cuda:0")


def n_jobs() -> int:
    return int(os.getenv("ORCA_X_N_JOBS", "2"))


def make_model(seed: int) -> xgb.XGBRegressor:
    params = dict(
        objective="reg:squarederror",
        n_estimators=int(os.getenv("ORCA_X_R33_ESTIMATORS", "450")),
        max_depth=int(os.getenv("ORCA_X_R33_MAX_DEPTH", "5")),
        learning_rate=float(os.getenv("ORCA_X_R33_LEARNING_RATE", "0.04")),
        min_child_weight=int(os.getenv("ORCA_X_R33_MIN_CHILD_WEIGHT", "6")),
        subsample=0.90,
        colsample_bytree=0.90,
        reg_alpha=0.10,
        reg_lambda=2.50,
        gamma=0.03,
        tree_method="hist",
        random_state=seed,
        n_jobs=n_jobs(),
    )
    if device_name() == "cuda":
        params["device"] = "cuda"
    return xgb.XGBRegressor(**params)


def risk_class(values: np.ndarray) -> np.ndarray:
    y = np.asarray(values, dtype=float)
    w, g, wh, sh, _ = y.T
    score = np.maximum.reduce([w / 25.0, g / 35.0, wh / 3.0, sh / 2.0])
    return np.select([score >= 1.0, score >= 0.72, score >= 0.45], [3, 2, 1], default=0).astype(int)


def load_pairs() -> pd.DataFrame:
    path = PROCESSED_DIR / "orca_historical_marine_risk.parquet"
    if not path.exists():
        raise FileNotFoundError(f"Missing processed dataset: {path}")
    df = pd.read_parquet(path).copy()
    required = [LOCATION_COLUMN, TIMESTAMP_COLUMN, *FEATURES, *TARGET_COLUMNS]
    missing = [c for c in required if c not in df.columns]
    if missing:
        raise ValueError(f"Dataset is missing required columns: {missing}")
    df[TIMESTAMP_COLUMN] = pd.to_datetime(df[TIMESTAMP_COLUMN], utc=True, errors="coerce")
    for c in FEATURES + TARGET_COLUMNS:
        df[c] = pd.to_numeric(df[c], errors="coerce")
    df = df.dropna(subset=[LOCATION_COLUMN, TIMESTAMP_COLUMN]).sort_values([LOCATION_COLUMN, TIMESTAMP_COLUMN]).reset_index(drop=True)
    if df.duplicated([LOCATION_COLUMN, TIMESTAMP_COLUMN]).any():
        raise ValueError("Duplicate location/timestamp rows detected.")

    # Build the +6h target from the observation six hours in the future.
    # The contemporaneous stored risk label is never used.
    future = df[[LOCATION_COLUMN, TIMESTAMP_COLUMN, *TARGET_COLUMNS]].copy()
    future[TIMESTAMP_COLUMN] = future[TIMESTAMP_COLUMN] - pd.Timedelta(hours=int(RISK_HORIZON_HOURS))
    future = future.rename(columns={c: f"target_{c}" for c in TARGET_COLUMNS})
    out = df.merge(future, on=[LOCATION_COLUMN, TIMESTAMP_COLUMN], how="inner")
    out = out.dropna(subset=[f"target_{c}" for c in TARGET_COLUMNS]).reset_index(drop=True)
    if out.empty:
        raise ValueError("No complete +6h pairs remain. Check dataset timestamp spacing.")
    return out


def chronological_splits(df: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    work = df.sort_values(TIMESTAMP_COLUMN).copy()
    train2024 = work[work[TIMESTAMP_COLUMN].dt.year == 2024].reset_index(drop=True)
    test2025 = work[work[TIMESTAMP_COLUMN].dt.year == 2025].reset_index(drop=True)
    if train2024.empty or test2025.empty:
        raise ValueError("Temporal benchmark requires both 2024 and 2025 data.")
    cut = int(len(train2024) * 0.80)
    fit = train2024.iloc[:cut].reset_index(drop=True)
    calibration = train2024.iloc[cut:].reset_index(drop=True)
    return fit, calibration, test2025


def feature_frame(frame: pd.DataFrame) -> pd.DataFrame:
    return frame[FEATURES].copy().apply(pd.to_numeric, errors="coerce")


def fit_multioutput(frame: pd.DataFrame, seed_offset: int = 0) -> list[xgb.XGBRegressor]:
    X = feature_frame(frame)
    models = []
    for j, target in enumerate(TARGET_COLUMNS):
        model = make_model(RANDOM_STATE + seed_offset + j)
        model.fit(X, frame[f"target_{target}"].to_numpy(float), verbose=False)
        models.append(model)
    return models


def predict_multioutput(models: list[xgb.XGBRegressor], frame: pd.DataFrame) -> np.ndarray:
    X = feature_frame(frame)
    return np.column_stack([m.predict(X) for m in models])


def degrade(frame: pd.DataFrame, scenario: str, seed: int) -> pd.DataFrame:
    out = frame.copy()
    if scenario == "clean":
        return out
    rng = np.random.default_rng(seed)
    wind = ["wind_speed_kts", "wind_gust_kts", "wind_direction_deg"]
    sea = ["wave_height_m", "wave_period_s", "wave_direction_deg", "swell_height_m", "swell_period_s", "swell_direction_deg"]
    atm = ["air_pressure_hpa", "air_temperature_c", "precipitation_mm"]
    if scenario.startswith("random_missing_"):
        rate = int(scenario.rsplit("_", 1)[1]) / 100.0
        for col in FEATURES:
            out.loc[rng.random(len(out)) < rate, col] = np.nan
    elif scenario == "wind_outage":
        out[wind] = np.nan
    elif scenario == "sea_state_outage":
        out[sea] = np.nan
    elif scenario == "atmospheric_outage":
        out[atm] = np.nan
    elif scenario == "stale_wind":
        out[wind] = out.groupby(LOCATION_COLUMN)[wind].shift(1)
    elif scenario == "stale_sea_state":
        out[sea] = out.groupby(LOCATION_COLUMN)[sea].shift(1)
    elif scenario == "mixed_degradation":
        for col in wind:
            out.loc[rng.random(len(out)) < 0.25, col] = np.nan
        for col in sea:
            out.loc[rng.random(len(out)) < 0.25, col] = np.nan
        for col in atm:
            out.loc[rng.random(len(out)) < 0.15, col] = np.nan
    else:
        raise ValueError(f"Unknown scenario: {scenario}")
    return out


def regression_metrics(actual: np.ndarray, pred: np.ndarray) -> dict:
    return {
        "mean_mae": float(mean_absolute_error(actual, pred)),
        "mean_r2": float(r2_score(actual, pred, multioutput="uniform_average")),
        **{f"{t}_mae": float(mean_absolute_error(actual[:, i], pred[:, i])) for i, t in enumerate(TARGET_COLUMNS)},
        **{f"{t}_r2": float(r2_score(actual[:, i], pred[:, i])) for i, t in enumerate(TARGET_COLUMNS)},
    }


def metric_row(strategy: str, scope: str, location: str, scenario: str, actual: np.ndarray, pred: np.ndarray) -> dict:
    y = risk_class(actual)
    p = risk_class(pred)
    critical = y >= 2
    over = p > y
    row = {
        "strategy": strategy, "scope": scope, "location": location, "scenario": scenario,
        "accuracy": float(accuracy_score(y, p)),
        "balanced_accuracy": float(balanced_accuracy_score(y, p)),
        "macro_f1": float(f1_score(y, p, average="macro", zero_division=0)),
        "critical_recall": float((p[critical] >= 2).mean()) if critical.any() else 0.0,
        "critical_miss_rate": float((critical & (p < 2)).mean()),
        "false_escalation_rate": float(over.mean()),
        "rows": int(len(y)),
    }
    row.update(regression_metrics(actual, pred))
    return row


def fit_experts(fit: pd.DataFrame) -> dict[str, list[xgb.XGBRegressor]]:
    experts = {}
    for i, location in enumerate(sorted(fit[LOCATION_COLUMN].astype(str).unique())):
        local = fit[fit[LOCATION_COLUMN].astype(str) == location].reset_index(drop=True)
        if len(local) < 500:
            raise ValueError(f"Not enough rows for expert {location}: {len(local)}")
        print(f"      expert {location}: rows={len(local):,}")
        experts[location] = fit_multioutput(local, 1000 * (i + 1))
    return experts


def predict_experts(experts: dict[str, list[xgb.XGBRegressor]], frame: pd.DataFrame) -> tuple[np.ndarray, np.ndarray]:
    pred = np.full((len(frame), len(TARGET_COLUMNS)), np.nan, dtype=float)
    known = np.zeros(len(frame), dtype=bool)
    for location, group in frame.groupby(LOCATION_COLUMN, sort=True):
        key = str(location)
        if key not in experts:
            continue
        pos = group.index.to_numpy()
        pred[pos] = predict_multioutput(experts[key], group)
        known[pos] = True
    return pred, known


def residual_corrections(global_models: list[xgb.XGBRegressor], calibration: pd.DataFrame) -> dict[str, np.ndarray]:
    base = predict_multioutput(global_models, calibration)
    residual = target_values(calibration) - base
    result = {}
    for location, idx in calibration.groupby(LOCATION_COLUMN).groups.items():
        positions = np.asarray(list(idx), dtype=int)
        result[str(location)] = np.nanmedian(residual[positions], axis=0)
    return result


def target_values(frame: pd.DataFrame) -> np.ndarray:
    return frame[[f"target_{c}" for c in TARGET_COLUMNS]].to_numpy(dtype=float)


def apply_residual(pred: np.ndarray, locations: pd.Series, corrections: dict[str, np.ndarray]) -> np.ndarray:
    out = pred.copy()
    for i, location in enumerate(locations.astype(str).to_numpy()):
        if location in corrections:
            out[i] += corrections[location]
    return out


def run_temporal(fit: pd.DataFrame, calibration: pd.DataFrame, test: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame]:
    print("\n[1/3] Training global model...")
    global_models = fit_multioutput(fit, 0)
    print("[2/3] Training one expert per known coast...")
    experts = fit_experts(fit)
    print("[3/3] Learning frozen per-coast residual corrections from late 2024...")
    corrections = residual_corrections(global_models, calibration)

    rows = []
    actual = target_values(test)
    for si, scenario in enumerate(SCENARIOS):
        frame = degrade(test, scenario, 42000 + si)
        global_pred = predict_multioutput(global_models, frame)
        expert_pred, expert_known = predict_experts(experts, frame)
        residual_pred = apply_residual(global_pred, frame[LOCATION_COLUMN], corrections)
        rows.append(metric_row("global", "temporal_2025", "ALL", scenario, actual, global_pred))
        if expert_known.all():
            rows.append(metric_row("expert", "temporal_2025", "ALL", scenario, actual, expert_pred))
        rows.append(metric_row("global_residual", "temporal_2025", "ALL", scenario, actual, residual_pred))

    # Per-location clean comparison is especially important for expert routing.
    for location in sorted(test[LOCATION_COLUMN].astype(str).unique()):
        mask = test[LOCATION_COLUMN].astype(str).to_numpy() == location
        frame = test.loc[mask].copy().reset_index(drop=True)
        loc_actual = target_values(frame)
        g = predict_multioutput(global_models, frame)
        e, _ = predict_experts(experts, frame)
        r = apply_residual(g, frame[LOCATION_COLUMN], corrections)
        rows.extend([
            metric_row("global", "temporal_2025_by_location", location, "clean", loc_actual, g),
            metric_row("expert", "temporal_2025_by_location", location, "clean", loc_actual, e),
            metric_row("global_residual", "temporal_2025_by_location", location, "clean", loc_actual, r),
        ])
    return pd.DataFrame(rows), pd.DataFrame([{"location": k, **{TARGET_COLUMNS[i]: float(v[i]) for i in range(len(TARGET_COLUMNS))}} for k, v in corrections.items()])


def run_spatial(df: pd.DataFrame) -> pd.DataFrame:
    rows = []
    locations = sorted(df[LOCATION_COLUMN].astype(str).unique())
    print("\nSpatial global holdouts (clean):")
    for i, holdout in enumerate(locations):
        train = df[df[LOCATION_COLUMN].astype(str) != holdout].reset_index(drop=True)
        test = df[df[LOCATION_COLUMN].astype(str) == holdout].reset_index(drop=True)
        print(f"  [{i + 1}/{len(locations)}] holdout={holdout} train={len(train):,} test={len(test):,}")
        models = fit_multioutput(train, 5000 + i * 100)
        pred = predict_multioutput(models, test)
        rows.append(metric_row("global_spatial_holdout", "spatial_6_coast", holdout, "clean", target_values(test), pred))
    return pd.DataFrame(rows)


def summarize_temporal(results: pd.DataFrame) -> pd.DataFrame:
    stress = results[(results.scope == "temporal_2025") & (results.scenario != "clean")]
    clean = results[(results.scope == "temporal_2025") & (results.scenario == "clean")]
    rows = []
    for strategy in ["global", "expert", "global_residual"]:
        s, c = stress[stress.strategy == strategy], clean[clean.strategy == strategy]
        if s.empty or c.empty:
            continue
        score = (
            0.45 * s.critical_recall.mean()
            + 0.25 * c.accuracy.mean()
            + 0.15 * s.balanced_accuracy.mean()
            + 0.10 * s.mean_r2.mean()
            - 0.05 * s.false_escalation_rate.mean()
        )
        rows.append({
            "strategy": strategy,
            "clean_accuracy": float(c.accuracy.mean()),
            "clean_critical_recall": float(c.critical_recall.mean()),
            "clean_mean_mae": float(c.mean_mae.mean()),
            "stress_accuracy": float(s.accuracy.mean()),
            "stress_balanced_accuracy": float(s.balanced_accuracy.mean()),
            "stress_macro_f1": float(s.macro_f1.mean()),
            "stress_critical_recall": float(s.critical_recall.mean()),
            "stress_critical_miss_rate": float(s.critical_miss_rate.mean()),
            "stress_false_escalation_rate": float(s.false_escalation_rate.mean()),
            "stress_mean_mae": float(s.mean_mae.mean()),
            "stress_mean_r2": float(s.mean_r2.mean()),
            "stress_wind_mae": float(s.wind_speed_kts_mae.mean()),
            "stress_gust_mae": float(s.wind_gust_kts_mae.mean()),
            "benchmark_score": float(score),
        })
    return pd.DataFrame(rows).sort_values("benchmark_score", ascending=False).reset_index(drop=True)


def main() -> None:
    started = time.perf_counter()
    print("=" * 92)
    print("ORCA-X REFINEMENT 33 — COASTAL REGIME / EXPERT MODEL OPTIMIZATION")
    print("=" * 92)
    print("Read-only benchmark: production artifacts, risk policy and thresholds untouched")
    print(f"XGBoost device={device_name()} n_jobs={n_jobs()} version={xgb.__version__}")

    df = load_pairs()
    fit, calibration, test = chronological_splits(df)
    print(f"Source rows={len(df):,} | complete +6h pairs={len(df):,} | locations={df[LOCATION_COLUMN].nunique()}")
    print(f"2024 fit={len(fit):,} | 2024 calibration={len(calibration):,} | 2025 test={len(test):,}")
    print(f"Locations={sorted(df[LOCATION_COLUMN].astype(str).unique().tolist())}")
    print(f"Features={len(FEATURES)} | targets={len(TARGET_COLUMNS)} | scenarios={len(SCENARIOS)}")

    temporal, corrections = run_temporal(fit, calibration, test)
    spatial = run_spatial(df)
    summary = summarize_temporal(temporal)

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    temporal.to_csv(OUTPUT_DIR / "temporal_2025_scenarios_and_location_results.csv", index=False)
    spatial.to_csv(OUTPUT_DIR / "spatial_global_holdouts.csv", index=False)
    corrections.to_csv(OUTPUT_DIR / "coastal_residual_corrections.csv", index=False)
    summary.to_csv(OUTPUT_DIR / "strategy_summary.csv", index=False)
    metadata = {
        "strategies": ["global", "expert", "global_residual"],
        "features": FEATURES,
        "targets": TARGET_COLUMNS,
        "scenarios": SCENARIOS,
        "source_rows": int(len(df)),
        "complete_pairs": int(len(df)),
        "fit_2024_rows": int(len(fit)),
        "calibration_2024_rows": int(len(calibration)),
        "test_2025_rows": int(len(test)),
        "locations": sorted(df[LOCATION_COLUMN].astype(str).unique().tolist()),
        "prediction_horizon_hours": int(RISK_HORIZON_HOURS),
        "device": device_name(),
        "n_jobs": n_jobs(),
        "production_modified": False,
        "selection_rule": "safety recall first, with clean accuracy, balanced accuracy, regression quality and false-escalation penalty",
        "runtime_seconds": time.perf_counter() - started,
    }
    (OUTPUT_DIR / "benchmark_metadata.json").write_text(json.dumps(metadata, indent=2), encoding="utf-8")

    print("\n" + "=" * 92)
    print("REFINEMENT 33 COMPLETE")
    print("=" * 92)
    print(summary.to_string(index=False, float_format=lambda x: f"{x:.6f}"))
    print("\nPer-location temporal clean results:")
    loc = temporal[temporal.scope == "temporal_2025_by_location"]
    print(loc[["strategy", "location", "accuracy", "critical_recall", "mean_mae", "wind_speed_kts_mae", "wind_gust_kts_mae"]].to_string(index=False, float_format=lambda x: f"{x:.6f}"))
    print("\nSpatial global holdout results:")
    print(spatial[["location", "accuracy", "critical_recall", "mean_mae", "wind_speed_kts_mae", "wind_gust_kts_mae"]].to_string(index=False, float_format=lambda x: f"{x:.6f}"))
    winner = summary.iloc[0]["strategy"] if not summary.empty else "none"
    print(f"\nBenchmark winner: {winner}")
    print("Winner is a benchmark candidate only; production model/risk policy was NOT changed.")
    print(f"Artifacts: {OUTPUT_DIR}")
    print(f"Elapsed: {(time.perf_counter() - started) / 60:.2f} minutes")


if __name__ == "__main__":
    main()
