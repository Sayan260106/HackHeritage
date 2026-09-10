"""
ORCA-X REFINEMENT 29A — UNCERTAINTY DIAGNOSTICS

Diagnoses whether the Refinement 29 ensemble uncertainty is informative enough
for a safety gate. This benchmark is read-only: it does not modify production
models, risk policy, thresholds, or the source dataset.

The analysis measures:
- normalized ensemble uncertainty distribution;
- uncertainty by true risk class and degradation scenario;
- relationship between uncertainty and absolute target error;
- ensemble diversity;
- threshold activation rates over observed uncertainty quantiles;
- whether degradation actually increases uncertainty;
- temporal 2024 -> 2025 behavior.

Run in Colab with:
    python ml/src/colab_gpu_runner.py ml/src/refinement29a_uncertainty_diagnostics.py
"""
from __future__ import annotations

import json
import os
import time
import warnings
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.metrics import mean_absolute_error
from xgboost import XGBRegressor

warnings.filterwarnings("ignore", category=FutureWarning)

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "ml/data/processed/orca_historical_marine_risk.parquet"
OUT = ROOT / "ml/models/refinement29a"
H = 6
TARGETS = ["wind_speed_kts", "wind_gust_kts", "wave_height_m", "swell_height_m", "wave_period_s"]
FEATURES = [
    "wind_speed_kts", "wind_gust_kts", "wind_direction_deg",
    "wave_height_m", "wave_period_s", "wave_direction_deg",
    "swell_height_m", "swell_period_s", "swell_direction_deg",
    "air_pressure_hpa", "air_temperature_c", "sea_surface_temperature_c",
    "precipitation_mm", "month", "season",
]
SCENARIOS = [
    "clean", "random_missing_10", "random_missing_25", "random_missing_40",
    "wind_outage", "sea_state_outage", "atmospheric_outage",
    "stale_wind", "stale_sea_state", "mixed_degradation",
]


def location_col(df):
    return next(c for c in ["location", "location_name", "station", "station_id", "site"] if c in df.columns)


def timestamp_col(df):
    return next(c for c in ["timestamp", "time", "datetime", "date_time"] if c in df.columns)


def make_pairs(df, loc):
    ts = timestamp_col(df)
    d = df.copy()
    d[ts] = pd.to_datetime(d[ts], utc=True, errors="coerce")
    d = d.dropna(subset=[ts]).sort_values([loc, ts])
    f = d[[loc, ts] + TARGETS].copy()
    f[ts] = f[ts] - pd.Timedelta(hours=H)
    f = f.rename(columns={c: "future_" + c for c in TARGETS})
    q = d.merge(f, on=[loc, ts], how="inner")
    valid = np.isfinite(q[["future_" + c for c in TARGETS]].to_numpy(float)).all(axis=1)
    return q.loc[valid].reset_index(drop=True), ts


def build_X(q):
    X = q[[c for c in FEATURES if c in q.columns]].copy()
    for c in X.columns:
        X[c] = pd.to_numeric(X[c], errors="coerce")
    return X


def policy(y):
    w, g, wh, sh, _ = y.T
    score = np.maximum.reduce([w / 25.0, g / 35.0, wh / 3.0, sh / 2.0])
    return np.select([score >= 1.0, score >= .72, score >= .45], [3, 2, 1], default=0).astype(int)


def degrade(X, scenario, seed):
    rng = np.random.default_rng(seed)
    out = X.copy().astype(float)
    groups = {
        "wind": [c for c in ["wind_speed_kts", "wind_gust_kts", "wind_direction_deg"] if c in out],
        "sea": [c for c in ["wave_height_m", "wave_period_s", "wave_direction_deg", "swell_height_m", "swell_period_s", "swell_direction_deg"] if c in out],
        "atm": [c for c in ["air_pressure_hpa", "air_temperature_c", "precipitation_mm"] if c in out],
    }
    if scenario.startswith("random_missing_"):
        rate = int(scenario.rsplit("_", 1)[1]) / 100
        out = out.mask(rng.random(out.shape) < rate)
    elif scenario == "wind_outage":
        out.loc[:, groups["wind"]] = np.nan
    elif scenario == "sea_state_outage":
        out.loc[:, groups["sea"]] = np.nan
    elif scenario == "atmospheric_outage":
        out.loc[:, groups["atm"]] = np.nan
    elif scenario == "mixed_degradation":
        for cols in groups.values():
            if cols:
                out.loc[:, cols] = out[cols].mask(rng.random((len(out), len(cols))) < .25)
    elif scenario == "stale_wind":
        out.loc[:, groups["wind"]] = out[groups["wind"]].shift(1)
    elif scenario == "stale_sea_state":
        out.loc[:, groups["sea"]] = out[groups["sea"]].shift(1)
    return out


def fit_ensemble(Xtr, Ytr, seed):
    med = Xtr.median(numeric_only=True)
    A = Xtr.fillna(med).fillna(0.0).astype(np.float32)
    members = []
    for s in [seed, seed + 17, seed + 31]:
        models = []
        for j in range(len(TARGETS)):
            m = XGBRegressor(
                n_estimators=400, max_depth=6, learning_rate=.05,
                subsample=.85, colsample_bytree=.85, objective="reg:squarederror",
                tree_method="hist", device=os.getenv("ORCA_X_DEVICE", "cuda"),
                n_jobs=int(os.getenv("ORCA_X_N_JOBS", "2")), random_state=s + j,
            )
            m.fit(A, Ytr[:, j])
            models.append(m)
        members.append(models)
    return members, med


def predict_members(members, X, med):
    A = X.fillna(med).fillna(0.0).astype(np.float32)
    cupy_X = None
    cp = None
    if os.getenv("ORCA_X_DEVICE", "cuda") == "cuda":
        try:
            import cupy as _cp
            cp = _cp
            cupy_X = cp.asarray(A.to_numpy(dtype=np.float32))
        except Exception:
            pass
    out = []
    for models in members:
        cols = []
        for m in models:
            if cupy_X is not None:
                col = cp.asnumpy(m.get_booster().inplace_predict(cupy_X))
            else:
                col = m.predict(A)
            cols.append(np.asarray(col, dtype=np.float64))
        out.append(np.column_stack(cols))
    return np.stack(out, axis=0)


def quantiles(x):
    x = np.asarray(x, dtype=float)
    return {f"p{p:g}": float(np.quantile(x, p / 100.0)) for p in [1, 5, 10, 25, 50, 75, 90, 95, 97.5, 99, 99.5, 99.9, 100]}


def safe_corr(a, b):
    a, b = np.asarray(a, float), np.asarray(b, float)
    if len(a) < 3 or np.std(a) == 0 or np.std(b) == 0:
        return 0.0
    return float(np.corrcoef(a, b)[0, 1])


def diagnostics_for_predictions(member_pred, truth, calibration):
    mean = member_pred.mean(axis=0)
    sigma = member_pred.std(axis=0)
    u_target = sigma / np.maximum(calibration, 1e-6)
    u = u_target.mean(axis=1)
    abs_err = np.abs(mean - truth)
    target_mae = abs_err.mean(axis=0)
    class_pred = policy(mean)
    class_true = policy(truth)
    return {
        "uncertainty": quantiles(u),
        "uncertainty_target_mean": u_target.mean(axis=0).tolist(),
        "uncertainty_target_quantiles": [quantiles(u_target[:, j]) for j in range(u_target.shape[1])],
        "absolute_error_quantiles": quantiles(abs_err.mean(axis=1)),
        "uncertainty_error_correlation": safe_corr(u, abs_err.mean(axis=1)),
        "uncertainty_error_correlation_by_target": [safe_corr(u_target[:, j], abs_err[:, j]) for j in range(len(TARGETS))],
        "target_mae": target_mae.tolist(),
        "point_accuracy": float(np.mean(class_pred == class_true)),
        "critical_recall": float(np.sum((class_true >= 2) & (class_pred >= 2)) / max(1, np.sum(class_true >= 2))),
        "risk_class_counts": {str(k): int(v) for k, v in zip(*np.unique(class_true, return_counts=True))},
        "ensemble_sigma_mean_by_target": sigma.mean(axis=0).tolist(),
        "ensemble_sigma_quantiles_by_target": [quantiles(sigma[:, j]) for j in range(len(TARGETS))],
    }


def main():
    started = time.perf_counter()
    print("=" * 78)
    print("ORCA-X REFINEMENT 29A — UNCERTAINTY DIAGNOSTICS")
    print("=" * 78)
    print("Read-only benchmark | production artifacts are not modified")
    df = pd.read_parquet(DATA)
    loc = location_col(df)
    q, ts = make_pairs(df, loc)
    X = build_X(q)
    Y = q[["future_" + c for c in TARGETS]].to_numpy(float)
    locations = sorted(q[loc].astype(str).unique())
    years = pd.to_datetime(q[ts], utc=True).dt.year.to_numpy()
    print(f"Rows source: {len(df):,} | complete +6h pairs: {len(q):,}")
    print(f"Locations: {len(locations)} | Features: {X.shape[1]} | Scenarios: {len(SCENARIOS)}")

    rows = []
    fold_summary = []
    for li, hold in enumerate(locations):
        te = q[loc].astype(str).eq(hold).to_numpy()
        tr = ~te
        print(f"[{li + 1}/{len(locations)}] location holdout={hold} ...", flush=True)
        members, med = fit_ensemble(X.loc[tr], Y[tr], 9000 + li * 100)
        train_members = predict_members(members, X.loc[tr], med)
        train_mean = train_members.mean(axis=0)
        calibration = np.quantile(np.abs(Y[tr] - train_mean), .90, axis=0)
        clean = predict_members(members, X.loc[te], med)
        clean_diag = diagnostics_for_predictions(clean, Y[te], calibration)
        clean_u = clean.std(axis=0).mean(axis=1) / np.maximum(calibration.mean(), 1e-6)
        for si, scenario in enumerate(SCENARIOS):
            Xin = X.loc[te] if scenario == "clean" else degrade(X.loc[te], scenario, 20000 + li * 100 + si)
            member_pred = clean if scenario == "clean" else predict_members(members, Xin, med)
            d = diagnostics_for_predictions(member_pred, Y[te], calibration)
            u = member_pred.std(axis=0).mean(axis=1) / np.maximum(calibration.mean(), 1e-6)
            row = {
                "location": hold,
                "scenario": scenario,
                "rows": int(te.sum()),
                "uncertainty_p50": d["uncertainty"]["p50"],
                "uncertainty_p90": d["uncertainty"]["p90"],
                "uncertainty_p95": d["uncertainty"]["p95"],
                "uncertainty_p99": d["uncertainty"]["p99"],
                "uncertainty_p99_9": d["uncertainty"]["p99.9"],
                "uncertainty_mean": float(u.mean()),
                "uncertainty_error_corr": d["uncertainty_error_correlation"],
                "mae": float(mean_absolute_error(Y[te], member_pred.mean(axis=0))),
                "point_accuracy": d["point_accuracy"],
                "critical_recall": d["critical_recall"],
                "clean_mean_uncertainty": float(clean_u.mean()),
                "uncertainty_multiplier_vs_clean": float(u.mean() / max(clean_u.mean(), 1e-9)),
            }
            rows.append(row)
        fold_summary.append({"location": hold, "clean": clean_diag})

    # Aggregate observed uncertainty thresholds rather than assuming .60-1.20.
    all_u = []
    for r in rows:
        all_u.extend([r["uncertainty_p50"], r["uncertainty_p90"], r["uncertainty_p95"], r["uncertainty_p99"]])
    scenario_df = pd.DataFrame(rows)
    clean_df = scenario_df[scenario_df.scenario == "clean"]
    stress_df = scenario_df[scenario_df.scenario != "clean"]
    observed = np.asarray(all_u, float)
    candidate_thresholds = sorted(set(float(x) for x in np.quantile(observed, [0.5, .75, .9, .95, .975, .99])))

    temporal = None
    if 2024 in years and 2025 in years:
        tr, te = years == 2024, years == 2025
        print("Temporal diagnostics: training 2024 -> testing 2025 ...", flush=True)
        members, med = fit_ensemble(X.loc[tr], Y[tr], 29001)
        train_members = predict_members(members, X.loc[tr], med)
        calibration = np.quantile(np.abs(Y[tr] - train_members.mean(axis=0)), .90, axis=0)
        test_members = predict_members(members, X.loc[te], med)
        temporal = diagnostics_for_predictions(test_members, Y[te], calibration)
        temporal["rows"] = int(te.sum())
        temporal["years"] = {"train": 2024, "test": 2025}

    stress_multiplier = float(stress_df.uncertainty_mean.mean() / max(clean_df.uncertainty_mean.mean(), 1e-9))
    stress_corr = float(stress_df.uncertainty_error_corr.mean())
    elapsed = time.perf_counter() - started
    result = {
        "refinement": "29A",
        "purpose": "uncertainty_distribution_and_gate_diagnostics",
        "source_rows": int(len(df)),
        "complete_pairs": int(len(q)),
        "locations": locations,
        "targets": TARGETS,
        "features": FEATURES,
        "scenarios": SCENARIOS,
        "calibration": {"method": "90th percentile absolute training residual per target", "level": .90},
        "aggregate": {
            "clean_mean_uncertainty": float(clean_df.uncertainty_mean.mean()),
            "stress_mean_uncertainty": float(stress_df.uncertainty_mean.mean()),
            "stress_to_clean_uncertainty_ratio": stress_multiplier,
            "stress_mean_uncertainty_error_correlation": stress_corr,
            "candidate_thresholds_from_observed_distribution": candidate_thresholds,
            "recommended_diagnostic_thresholds": [float(x) for x in np.quantile(observed, [.75, .90, .95, .99])],
            "scenario_table_rows": int(len(scenario_df)),
        },
        "by_scenario": rows,
        "by_location": fold_summary,
        "temporal": temporal,
        "interpretation_flags": {
            "gate_likely_inactive_at_060": bool(float(stress_df.uncertainty_p99.max()) < .60),
            "degradation_increases_uncertainty": bool(stress_multiplier > 1.10),
            "uncertainty_has_positive_error_signal": bool(stress_corr > .10),
            "uncertainty_has_strong_error_signal": bool(stress_corr > .30),
        },
        "production_modified": False,
        "elapsed_seconds": elapsed,
    }
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "refinement29a_results.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
    scenario_df.to_csv(OUT / "uncertainty_diagnostics_by_scenario.csv", index=False)
    print("=" * 78)
    print("REFINEMENT 29A COMPLETE")
    print("=" * 78)
    print(json.dumps({k: result[k] for k in ["aggregate", "temporal", "interpretation_flags", "production_modified", "elapsed_seconds"]}, indent=2))
    print(f"Saved: {OUT / 'refinement29a_results.json'}")
    print(f"Elapsed: {elapsed / 60:.2f} minutes")


if __name__ == "__main__":
    main()
