"""
ORCA-X REFINEMENT 29 — FAST/CACHED SAFETY-GATE CALIBRATION

Scientifically equivalent benchmark to refinement29_safety_gate_calibration.py,
but removes redundant XGBoost training. Models are trained once per location
holdout and their predictions are cached for every degradation scenario and
all gate/calibration configurations.

This is intended for Colab T4/L4 execution. It does not modify production
artifacts, the source dataset, the risk policy, or thresholds.
"""
from __future__ import annotations

import json
import os
import time
import warnings
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.metrics import mean_absolute_error, r2_score
from xgboost import XGBRegressor

warnings.filterwarnings("ignore", category=FutureWarning)

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "ml/data/processed/orca_historical_marine_risk.parquet"
OUT = ROOT / "ml/models/refinement29"
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
TRIALS = [(l, t, b) for l in [.90, .95] for t in [.60, .80, 1.00, 1.20] for b in [.50, .70]]


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
        out.iloc[:, :] = out.to_numpy().astype(float)
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


def predict_ensemble(members, X, med):
    """Predict with CUDA when available, then normalize outputs to NumPy.

    XGBoost's CUDA inplace_predict returns CuPy arrays. NumPy functions such as
    column_stack/stack deliberately reject implicit CuPy -> NumPy conversion,
    so every GPU prediction is explicitly copied to host memory before the
    ensemble aggregation. This keeps all downstream calibration/evaluation
    CPU-side and fixes the Colab T4 CuPy conversion failure.
    """
    A = X.fillna(med).fillna(0.0).astype(np.float32)
    preds = []
    cupy_X = None
    cp = None
    if os.getenv("ORCA_X_DEVICE", "cuda") == "cuda":
        try:
            import cupy as _cp
            cp = _cp
            cupy_X = cp.asarray(A.to_numpy(dtype=np.float32))
        except Exception:
            cupy_X = None
            cp = None

    for models in members:
        cols = []
        for m in models:
            if cupy_X is not None:
                col = m.get_booster().inplace_predict(cupy_X)
                col = cp.asnumpy(col)
            else:
                col = m.predict(A)
            cols.append(np.asarray(col, dtype=np.float64))
        preds.append(np.column_stack(cols))

    arr = np.stack(preds, axis=0)
    return arr.mean(axis=0), arr.std(axis=0)


def calibrate(Y, pred, level):
    y_np = np.asarray(Y, dtype=np.float64)
    pred_np = np.asarray(pred, dtype=np.float64)
    if y_np.shape != pred_np.shape:
        raise ValueError(f"Calibration shape mismatch: Y={y_np.shape}, pred={pred_np.shape}")
    return np.quantile(np.abs(y_np - pred_np), level, axis=0)


def evaluate(pred, sigma, truth, calibration, threshold, boundary_factor):
    u = np.mean(sigma / np.maximum(calibration, 1e-6), axis=1)
    base = policy(pred)
    actual = policy(truth)
    boundary = (base >= 1) & (base <= 2)
    active = (u >= threshold) | (boundary & (u >= threshold * boundary_factor))
    gated = base.copy()
    gated[active] = np.minimum(3, gated[active] + 1)
    return {
        "point_accuracy": float(np.mean(base == actual)),
        "gated_accuracy": float(np.mean(gated == actual)),
        "point_critical_recall": float(np.sum((actual >= 2) & (base >= 2)) / max(1, np.sum(actual >= 2))),
        "gated_critical_recall": float(np.sum((actual >= 2) & (gated >= 2)) / max(1, np.sum(actual >= 2))),
        "gate_rate": float(active.mean()),
        "mean_normalized_uncertainty": float(u.mean()),
        "false_escalation_rate": float(np.mean((gated > actual) & (actual < 3))),
        "over_escalation_rate": float(np.mean(gated > actual)),
    }


def objective(rows):
    rec = float(np.mean([r["gated_critical_recall"] for r in rows]))
    acc = float(np.mean([r["gated_accuracy"] for r in rows]))
    false = float(np.mean([r["false_escalation_rate"] for r in rows]))
    gate = float(np.mean([r["gate_rate"] for r in rows]))
    return .55 * rec + .35 * acc - .08 * false - .02 * gate, acc, rec, false, gate


def main():
    t_start = time.perf_counter()
    print("=" * 78)
    print("ORCA-X FAST SAFETY-GATE PRECISION + UNCERTAINTY CALIBRATION — REFINEMENT 29")
    print("=" * 78)
    print("Cached benchmark | redundant model fits removed | no production artifacts modified")
    df = pd.read_parquet(DATA)
    loc = location_col(df)
    q, ts = make_pairs(df, loc)
    X = build_X(q)
    Y = q[["future_" + c for c in TARGETS]].to_numpy(float)
    print(f"Source dataset: {DATA}")
    print(f"Rows source: {len(df):,} | exact +6h complete pairs: {len(q):,}")
    print(f"Locations: {q[loc].nunique()} | Features: {X.shape[1]}")
    print(f"Scenarios: {SCENARIOS}")
    print(f"Configurations: {len(TRIALS)} | Strategy: train once/fold, cache predictions, evaluate all configs")

    locations = sorted(q[loc].astype(str).unique())
    cache = []
    for li, hold in enumerate(locations):
        te = q[loc].astype(str).eq(hold).to_numpy()
        tr = ~te
        print(f"[{li + 1}/{len(locations)}] training location holdout={hold} ...", flush=True)
        members, med = fit_ensemble(X.loc[tr], Y[tr], 9000 + li * 100)
        pred_tr, _ = predict_ensemble(members, X.loc[tr], med)
        scenario_cache = {}
        for si, scenario in enumerate(SCENARIOS):
            Xin = X.loc[te] if scenario == "clean" else degrade(X.loc[te], scenario, 20000 + li * 100 + si)
            scenario_cache[scenario] = predict_ensemble(members, Xin, med)
        cache.append((hold, tr, te, pred_tr, scenario_cache))

    best = None
    all_rows = []
    for ti, (level, threshold, boundary_factor) in enumerate(TRIALS, 1):
        rows = []
        for hold, tr, te, pred_tr, scenario_cache in cache:
            calibration = calibrate(Y[tr], pred_tr, level)
            for scenario, (pred, sigma) in scenario_cache.items():
                r = evaluate(pred, sigma, Y[te], calibration, threshold, boundary_factor)
                r.update({"location": hold, "scenario": scenario, "threshold": threshold,
                          "boundary_factor": boundary_factor, "calibration_level": level})
                rows.append(r)
        stress = [r for r in rows if r["scenario"] != "clean"]
        value, acc, rec, false, gate = objective(stress)
        print(f"[{ti:02d}/{len(TRIALS)}] level={level:.2f} threshold={threshold:.2f} boundary={boundary_factor:.2f} objective={value:.5f} stress_acc={acc:.5f} stress_critical={rec:.5f} false={false:.5f} gate={gate:.5f}", flush=True)
        all_rows.extend(rows)
        candidate = {"trial": ti, "calibration_level": level, "threshold": threshold,
                     "boundary_factor": boundary_factor, "objective": value,
                     "stress_accuracy": acc, "stress_critical_recall": rec,
                     "stress_false_escalation_rate": false, "stress_gate_rate": gate}
        if best is None or value > best["objective"]:
            best = candidate

    years = pd.to_datetime(q[ts], utc=True).dt.year.to_numpy()
    temporal = None
    if 2024 in years and 2025 in years:
        tr, te = years == 2024, years == 2025
        print("Temporal validation: training 2024 -> testing 2025 ...", flush=True)
        members, med = fit_ensemble(X.loc[tr], Y[tr], 29001)
        pred_tr, _ = predict_ensemble(members, X.loc[tr], med)
        calibration = calibrate(Y[tr], pred_tr, best["calibration_level"])
        pred, sigma = predict_ensemble(members, X.loc[te], med)
        e = evaluate(pred, sigma, Y[te], calibration, best["threshold"], best["boundary_factor"])
        temporal = {**e, "mean_mae": float(mean_absolute_error(Y[te], pred)),
                    "mean_r2": float(r2_score(Y[te], pred, multioutput="uniform_average")), "rows": int(te.sum())}

    OUT.mkdir(parents=True, exist_ok=True)
    elapsed = time.perf_counter() - t_start
    result = {"best": best, "temporal": temporal, "locations": locations, "scenarios": SCENARIOS,
              "source_rows": int(len(df)), "complete_pairs": int(len(q)),
              "strict_point_in_time": True, "production_modified": False,
              "optimization": {"configurations": len(TRIALS), "model_reuse": True,
                               "models_per_location_fold": 15, "redundant_scenario_refits_removed": True,
                               "elapsed_seconds": elapsed}}
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "refinement29_results.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
    pd.DataFrame(all_rows).to_csv(OUT / "safety_gate_calibration_by_scenario.csv", index=False)
    (OUT / "safety_gate_calibration_config.json").write_text(json.dumps({
        "thresholds": [.60, .80, 1.00, 1.20], "boundary_factors": [.50, .70],
        "calibration_levels": [.90, .95], "targets": TARGETS, "features": FEATURES,
        "horizon_hours": H, "scenarios": SCENARIOS,
        "point_in_time_rule": "observations at t only; future state at t+6h is target",
        "optimization": "models trained once per location holdout; predictions cached across scenarios and configurations",
    }, indent=2), encoding="utf-8")
    print("=" * 78)
    print("REFINEMENT 29 COMPLETE")
    print("=" * 78)
    print(json.dumps(result, indent=2))
    print(f"Elapsed: {elapsed / 60:.2f} minutes")
    print(f"Saved: {OUT / 'refinement29_results.json'}")
    print("Production model, risk policy, thresholds, and source dataset were NOT modified.")


if __name__ == "__main__":
    main()
