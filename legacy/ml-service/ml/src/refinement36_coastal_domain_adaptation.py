"""ORCA-X Refinement 36 — Coastal Domain Adaptation.

Benchmark-only experiment for the remaining spatial generalization problem.

R33/R34 showed that coast-specific experts and routing were close to the
pooled global model, while leave-one-coast-out evaluation exposed substantial
domain shift at some coasts. R35 showed that uncertainty inflation improves
critical recall but is too conservative. R36 therefore tests a different
question: can a global source-coast model be adapted to a previously unseen
coast using a small, strictly pre-test sample from that coast?

Protocol
--------
* Leave one coast out at a time.
* All source coasts use 2024 data for fitting; the held-out coast is excluded.
* The held-out coast contributes only a fixed 2024 adaptation subset.
* Adaptation budgets are 1%, 5%, 10%, and 20% of the held-out coast's 2024
  rows. Budgets are deterministic and selected before seeing 2025 outcomes.
* Adaptation is a residual correction layer trained against frozen global
  predictions. This isolates domain correction from a second full model.
* A local expert trained only on the held-out coast's 2024 data is included as
  a stronger-data baseline.
* Every strategy is frozen before the held-out coast's 2025 test is touched.
* The same ten observation-degradation scenarios used by R34/R35 are tested.
* No test-period observations are used for adaptation, calibration, routing,
  alpha selection, or model selection.

This is intentionally benchmark-only. Production models, thresholds, risk
policy, inference code, and production artifacts are not modified.
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
TARGET_COLUMNS = ["wind_speed_kts", "wind_gust_kts", "wave_height_m", "swell_height_m", "wave_period_s"]
FEATURES = list(FEATURE_COLUMNS)
SCENARIOS = [
    "clean", "random_missing_10", "random_missing_25", "random_missing_40",
    "wind_outage", "sea_state_outage", "atmospheric_outage",
    "stale_wind", "stale_sea_state", "mixed_degradation",
]
ADAPTATION_BUDGETS = [0.01, 0.05, 0.10, 0.20]
OUTPUT_DIR = ML_ROOT / "models" / "refinement36"


def device_name() -> str:
    value = os.getenv("ORCA_X_DEVICE", "cpu").strip().lower()
    if value in {"gpu", "cuda", "cuda:0"}:
        return "cuda"
    if value == "cpu":
        return "cpu"
    raise ValueError("ORCA_X_DEVICE must be one of: cpu, cuda, gpu, cuda:0")


def n_jobs() -> int:
    return int(os.getenv("ORCA_X_N_JOBS", "2"))


def make_model(seed: int, *, residual: bool = False) -> xgb.XGBRegressor:
    if residual:
        params = dict(
            objective="reg:squarederror",
            n_estimators=int(os.getenv("ORCA_X_R36_ADAPTER_ESTIMATORS", "120")),
            max_depth=3,
            learning_rate=0.05,
            min_child_weight=8,
            subsample=0.90,
            colsample_bytree=0.90,
            reg_alpha=0.10,
            reg_lambda=4.0,
            gamma=0.05,
        )
    else:
        params = dict(
            objective="reg:squarederror",
            n_estimators=int(os.getenv("ORCA_X_R36_ESTIMATORS", "450")),
            max_depth=5,
            learning_rate=0.04,
            min_child_weight=6,
            subsample=0.90,
            colsample_bytree=0.90,
            reg_alpha=0.10,
            reg_lambda=2.50,
            gamma=0.03,
        )
    params.update(tree_method="hist", random_state=seed, n_jobs=n_jobs())
    if device_name() == "cuda":
        params["device"] = "cuda"
    return xgb.XGBRegressor(**params)


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
    for col in FEATURES + TARGET_COLUMNS:
        df[col] = pd.to_numeric(df[col], errors="coerce")
    df = df.dropna(subset=[LOCATION_COLUMN, TIMESTAMP_COLUMN]).sort_values(
        [LOCATION_COLUMN, TIMESTAMP_COLUMN]
    ).reset_index(drop=True)
    if df.duplicated([LOCATION_COLUMN, TIMESTAMP_COLUMN]).any():
        raise ValueError("Duplicate location/timestamp rows detected.")

    future = df[[LOCATION_COLUMN, TIMESTAMP_COLUMN, *TARGET_COLUMNS]].copy()
    future[TIMESTAMP_COLUMN] = future[TIMESTAMP_COLUMN] - pd.Timedelta(hours=int(RISK_HORIZON_HOURS))
    future = future.rename(columns={c: f"target_{c}" for c in TARGET_COLUMNS})
    out = df.merge(future, on=[LOCATION_COLUMN, TIMESTAMP_COLUMN], how="inner")
    out = out.dropna(subset=[f"target_{c}" for c in TARGET_COLUMNS]).reset_index(drop=True)
    if out.empty:
        raise ValueError("No complete +6h pairs remain. Check timestamp spacing.")
    return out


def feature_frame(frame: pd.DataFrame) -> pd.DataFrame:
    return frame[FEATURES].copy().apply(pd.to_numeric, errors="coerce")


def target_values(frame: pd.DataFrame) -> np.ndarray:
    return frame[[f"target_{c}" for c in TARGET_COLUMNS]].to_numpy(dtype=float)


def chronological_2024_2025(frame: pd.DataFrame):
    work = frame.sort_values(TIMESTAMP_COLUMN).reset_index(drop=True)
    train = work[work[TIMESTAMP_COLUMN].dt.year == 2024].reset_index(drop=True)
    test = work[work[TIMESTAMP_COLUMN].dt.year == 2025].reset_index(drop=True)
    if train.empty or test.empty:
        raise ValueError("Each benchmark split requires both 2024 and 2025 rows.")
    return train, test


def fit_multioutput(frame: pd.DataFrame, seed_offset: int = 0, *, residual: bool = False):
    X = feature_frame(frame)
    models = []
    for j, target in enumerate(TARGET_COLUMNS):
        model = make_model(RANDOM_STATE + seed_offset + j, residual=residual)
        model.fit(X, frame[f"target_{target}"].to_numpy(float), verbose=False)
        models.append(model)
    return models


def predict_one(model: xgb.XGBRegressor, X_cpu: np.ndarray) -> np.ndarray:
    if device_name() == "cuda":
        try:
            import cupy as cp
            pred = model.get_booster().inplace_predict(cp.asarray(X_cpu))
            return cp.asnumpy(pred).astype(float, copy=False)
        except Exception:
            pass
    return np.asarray(model.predict(X_cpu), dtype=float)


def predict_multioutput(models, frame: pd.DataFrame) -> np.ndarray:
    X = feature_frame(frame).to_numpy(dtype=np.float32)
    return np.column_stack([predict_one(model, X) for model in models])


def degrade(frame: pd.DataFrame, scenario: str, seed: int) -> pd.DataFrame:
    out = frame.copy()
    if scenario == "clean":
        return out
    rng = np.random.default_rng(seed)
    wind = [c for c in ["wind_speed_kts", "wind_gust_kts", "wind_direction_deg"] if c in FEATURES]
    sea = [c for c in ["wave_height_m", "wave_period_s", "wave_direction_deg", "swell_height_m", "swell_period_s", "swell_direction_deg"] if c in FEATURES]
    atm = [c for c in ["air_pressure_hpa", "air_temperature_c", "precipitation_mm"] if c in FEATURES]
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


def risk_class(values: np.ndarray) -> np.ndarray:
    y = np.asarray(values, dtype=float)
    w, g, wh, sh, _ = y.T
    score = np.maximum.reduce([w / 25.0, g / 35.0, wh / 3.0, sh / 2.0])
    return np.select([score >= 1.0, score >= 0.72, score >= 0.45], [3, 2, 1], default=0).astype(int)


def regression_metrics(actual: np.ndarray, pred: np.ndarray) -> dict:
    return {
        "mean_mae": float(mean_absolute_error(actual, pred)),
        "mean_r2": float(r2_score(actual, pred, multioutput="uniform_average")),
    }


def metrics(actual: np.ndarray, pred: np.ndarray) -> dict:
    y = risk_class(actual)
    p = risk_class(pred)
    critical = y >= 2
    return {
        "accuracy": float(accuracy_score(y, p)),
        "balanced_accuracy": float(balanced_accuracy_score(y, p)),
        "macro_f1": float(f1_score(y, p, average="macro", zero_division=0)),
        "critical_recall": float((p[critical] >= 2).mean()) if critical.any() else 0.0,
        "critical_miss_rate": float((critical & (p < 2)).mean()),
        "false_escalation_rate": float((p > y).mean()),
        **regression_metrics(actual, pred),
    }


def utility(m: dict) -> float:
    return (
        10.0 * m["critical_recall"]
        + 2.0 * m["balanced_accuracy"]
        + m["accuracy"]
        - 2.0 * m["false_escalation_rate"]
        - 0.10 * m["mean_mae"]
    )


def deterministic_adaptation_sample(target_2024: pd.DataFrame, fraction: float, seed: int) -> pd.DataFrame:
    if fraction <= 0:
        return target_2024.iloc[0:0].copy()
    n = max(1, int(np.floor(len(target_2024) * fraction)))
    n = min(n, len(target_2024))
    rng = np.random.default_rng(seed)
    order = rng.permutation(len(target_2024))[:n]
    return target_2024.iloc[np.sort(order)].reset_index(drop=True)


def fit_residual_adapter(base_models, adaptation: pd.DataFrame, seed_offset: int):
    """Fit a small target-domain residual model on top of frozen predictions."""
    base_pred = predict_multioutput(base_models, adaptation)
    actual = target_values(adaptation)
    residuals = actual - base_pred
    X = feature_frame(adaptation)
    adapters = []
    for j in range(len(TARGET_COLUMNS)):
        model = make_model(RANDOM_STATE + 10000 + seed_offset + j, residual=True)
        model.fit(X, residuals[:, j], verbose=False)
        adapters.append(model)
    return adapters


def apply_residual_adapter(base_models, adapters, frame: pd.DataFrame) -> np.ndarray:
    base = predict_multioutput(base_models, frame)
    X = feature_frame(frame).to_numpy(dtype=np.float32)
    correction = np.column_stack([predict_one(model, X) for model in adapters])
    return base + correction


def evaluate_model(models, test: pd.DataFrame, strategy: str, location: str, model_type: str):
    rows = []
    for si, scenario in enumerate(SCENARIOS):
        frame = degrade(test, scenario, 360000 + si)
        actual = target_values(frame)
        pred = predict_multioutput(models, frame)
        m = metrics(actual, pred)
        rows.append({
            "location": location,
            "strategy": strategy,
            "model_type": model_type,
            "scenario": scenario,
            **m,
        })
    return rows


def evaluate_adapter(base_models, adapters, test: pd.DataFrame, strategy: str, location: str):
    rows = []
    for si, scenario in enumerate(SCENARIOS):
        frame = degrade(test, scenario, 370000 + si)
        actual = target_values(frame)
        pred = apply_residual_adapter(base_models, adapters, frame)
        m = metrics(actual, pred)
        rows.append({
            "location": location,
            "strategy": strategy,
            "model_type": "residual_adapter",
            "scenario": scenario,
            **m,
        })
    return rows


def summarize(rows_df: pd.DataFrame) -> pd.DataFrame:
    rows = []
    for strategy in rows_df["strategy"].drop_duplicates().tolist():
        subset = rows_df[rows_df["strategy"] == strategy]
        clean = subset[subset["scenario"] == "clean"]
        stress = subset[subset["scenario"] != "clean"]
        if clean.empty or stress.empty:
            continue
        c = clean.mean(numeric_only=True)
        s = stress.mean(numeric_only=True)
        score = utility({
            "critical_recall": s["critical_recall"],
            "balanced_accuracy": s["balanced_accuracy"],
            "accuracy": s["accuracy"],
            "false_escalation_rate": s["false_escalation_rate"],
            "mean_mae": s["mean_mae"],
        })
        rows.append({
            "strategy": strategy,
            "clean_accuracy": c["accuracy"],
            "clean_critical_recall": c["critical_recall"],
            "clean_mean_mae": c["mean_mae"],
            "stress_accuracy": s["accuracy"],
            "stress_balanced_accuracy": s["balanced_accuracy"],
            "stress_macro_f1": s["macro_f1"],
            "stress_critical_recall": s["critical_recall"],
            "stress_critical_miss_rate": s["critical_miss_rate"],
            "stress_false_escalation_rate": s["false_escalation_rate"],
            "stress_mean_mae": s["mean_mae"],
            "stress_mean_r2": s["mean_r2"],
            "benchmark_score": score,
        })
    return pd.DataFrame(rows).sort_values("benchmark_score", ascending=False).reset_index(drop=True)


def main() -> None:
    started = time.perf_counter()
    print("=" * 92)
    print("ORCA-X REFINEMENT 36 — COASTAL DOMAIN ADAPTATION")
    print("=" * 92)
    print("Read-only benchmark: production artifacts, risk policy and thresholds untouched")
    print(f"XGBoost device={device_name()} n_jobs={n_jobs()} version={xgb.__version__}")

    df = load_pairs()
    locations = sorted(df[LOCATION_COLUMN].astype(str).unique().tolist())
    print(f"Source rows={len(df):,} | complete +6h pairs={len(df):,} | locations={len(locations)}")
    print(f"Locations={locations}")
    print(f"Features={len(FEATURES)} | targets={len(TARGET_COLUMNS)} | scenarios={len(SCENARIOS)}")
    print(f"Adaptation budgets={[f'{b:.0%}' for b in ADAPTATION_BUDGETS]}")

    all_rows = []
    adaptation_rows = []
    spatial_rows = []

    for i, holdout in enumerate(locations, 1):
        heldout = df[df[LOCATION_COLUMN].astype(str) == holdout].reset_index(drop=True)
        target_2024, target_2025 = chronological_2024_2025(heldout)
        source = df[df[LOCATION_COLUMN].astype(str) != holdout].reset_index(drop=True)
        source_2024, _ = chronological_2024_2025(source)

        print(f"\n[{i}/{len(locations)}] holdout={holdout} source_2024={len(source_2024):,} target_2024={len(target_2024):,} target_2025={len(target_2025):,}")
        print("  Training source-coast global model...")
        global_models = fit_multioutput(source_2024, 1000 + i * 100)
        all_rows.extend(evaluate_model(global_models, target_2025, "global_baseline", holdout, "source_global"))

        print("  Training local expert baseline...")
        local_models = fit_multioutput(target_2024, 3000 + i * 100)
        all_rows.extend(evaluate_model(local_models, target_2025, "local_expert", holdout, "target_local"))

        for bi, fraction in enumerate(ADAPTATION_BUDGETS):
            adaptation = deterministic_adaptation_sample(target_2024, fraction, 50000 + i * 100 + bi)
            adapters = fit_residual_adapter(global_models, adaptation, i * 100 + bi * 10)
            strategy = f"adapt_{int(fraction * 100)}pct"
            adaptation_rows.append({
                "location": holdout,
                "budget_fraction": fraction,
                "adaptation_rows": len(adaptation),
                "target_2024_rows": len(target_2024),
                "selection_rule": "deterministic fraction of 2024 held-out-coast rows; no 2025 access",
            })
            all_rows.extend(evaluate_adapter(global_models, adapters, target_2025, strategy, holdout))
            print(f"    adaptation={fraction:.0%} rows={len(adaptation):,} complete")

        # Per-coast summary is computed only after all strategies for this fold.
        fold_df = pd.DataFrame([r for r in all_rows if r["location"] == holdout])
        fold_summary = summarize(fold_df)
        for record in fold_summary.to_dict("records"):
            record["location"] = holdout
            spatial_rows.append(record)

    results = pd.DataFrame(all_rows)
    summary = summarize(results)
    adaptation_table = pd.DataFrame(adaptation_rows)
    spatial_summary = pd.DataFrame(spatial_rows)
    winner = summary.iloc[0]["strategy"] if not summary.empty else "none"

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    results.to_csv(OUTPUT_DIR / "spatial_2025_domain_adaptation_results.csv", index=False)
    summary.to_csv(OUTPUT_DIR / "strategy_summary.csv", index=False)
    adaptation_table.to_csv(OUTPUT_DIR / "adaptation_budgets.csv", index=False)
    spatial_summary.to_csv(OUTPUT_DIR / "per_coast_strategy_summary.csv", index=False)

    metadata = {
        "refinement": 36,
        "name": "coastal_domain_adaptation",
        "strategies": ["global_baseline", "adapt_1pct", "adapt_5pct", "adapt_10pct", "adapt_20pct", "local_expert"],
        "adaptation_method": "frozen source-global XGBoost plus target-coast residual XGBoost correction",
        "adaptation_budgets": ADAPTATION_BUDGETS,
        "scenarios": SCENARIOS,
        "locations": locations,
        "source_rows": int(len(df)),
        "prediction_horizon_hours": int(RISK_HORIZON_HOURS),
        "spatial_protocol": "leave-one-coast-out; held-out coast excluded from source training; only 2024 adaptation rows allowed",
        "test_protocol": "held-out coast 2025 is untouched until final evaluation",
        "model_selection": "fixed strategy set and deterministic adaptation fractions; no 2025 selection",
        "benchmark_winner": winner,
        "production_modified": False,
        "device": device_name(),
        "n_jobs": n_jobs(),
        "runtime_seconds": time.perf_counter() - started,
    }
    (OUTPUT_DIR / "benchmark_metadata.json").write_text(json.dumps(metadata, indent=2), encoding="utf-8")

    print("\n" + "=" * 92)
    print("REFINEMENT 36 COMPLETE")
    print("=" * 92)
    print(summary.to_string(index=False))
    print(f"\nBenchmark winner: {winner}")
    print("Winner is a benchmark candidate only; production model/risk policy was NOT changed.")
    print(f"Artifacts: {OUTPUT_DIR}")
    print(f"Elapsed: {(time.perf_counter() - started) / 60.0:.2f} minutes")


if __name__ == "__main__":
    main()
