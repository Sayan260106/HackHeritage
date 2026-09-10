"""
ORCA-X REFINEMENT 29 — SAFETY-GATE PRECISION + UNCERTAINTY CALIBRATION

Read-only benchmark. Uses only point-in-time observations at t to predict
physical state at t+6h. Calibration is learned from training residuals only.
The goal is to retain very high critical-event recall while reducing false
risk escalations under clean and degraded observations.

No production artifacts are modified.
"""
from __future__ import annotations

import json
import warnings
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.metrics import mean_absolute_error, r2_score
from sklearn.multioutput import MultiOutputRegressor
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
SCENARIOS = ["clean", "random_missing_10", "random_missing_25", "random_missing_40",
             "wind_outage", "sea_state_outage", "atmospheric_outage",
             "stale_wind", "stale_sea_state", "mixed_degradation"]


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


def critical_recall(pred, truth):
    p, y = policy(pred), policy(truth)
    return float(np.sum((y >= 2) & (p >= 2)) / max(1, np.sum(y >= 2)))


def fit_members(Xtr, Ytr, Xte, seed):
    med = Xtr.median(numeric_only=True)
    Xtr = Xtr.fillna(med).fillna(0.0).astype(np.float32)
    Xte = Xte.fillna(med).fillna(0.0).astype(np.float32)
    preds = []
    for s in [seed, seed + 17, seed + 31]:
        m = MultiOutputRegressor(XGBRegressor(
            n_estimators=400, max_depth=6, learning_rate=.05,
            subsample=.85, colsample_bytree=.85, objective="reg:squarederror",
            tree_method="hist", device="cuda", n_jobs=2, random_state=s,
        ))
        m.fit(Xtr, Ytr)
        preds.append(np.column_stack([e.predict(Xte) for e in m.estimators_]))
    a = np.stack(preds)
    return a.mean(0), a.std(0)


def calibrate(Y, pred, level):
    # Split-conformal-style absolute residual quantile, learned only on training data.
    return np.quantile(np.abs(Y - pred), level, axis=0)


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
        out[groups["wind"]] = np.nan
    elif scenario == "sea_state_outage":
        out[groups["sea"]] = np.nan
    elif scenario == "atmospheric_outage":
        out[groups["atm"]] = np.nan
    elif scenario == "mixed_degradation":
        for cols in groups.values():
            if cols:
                out[cols] = out[cols].mask(rng.random((len(out), len(cols))) < .25)
    elif scenario == "stale_wind":
        out[groups["wind"]] = out[groups["wind"]].shift(1)
    elif scenario == "stale_sea_state":
        out[groups["sea"]] = out[groups["sea"]].shift(1)
    return out


def gate(pred, sigma, calibration, threshold, boundary_factor):
    # Uncertainty is normalized against training-only residual calibration.
    u = np.mean(sigma / np.maximum(calibration, 1e-6), axis=1)
    base = policy(pred)
    boundary = (base >= 1) & (base <= 2)
    active = (u >= threshold) | (boundary & (u >= threshold * boundary_factor))
    gated = base.copy()
    gated[active] = np.minimum(3, gated[active] + 1)
    return base, gated, active, u


def evaluate(pred, sigma, truth, calibration, threshold, boundary_factor):
    base, gated, active, u = gate(pred, sigma, calibration, threshold, boundary_factor)
    actual = policy(truth)
    return {
        "point_accuracy": float(np.mean(base == actual)),
        "gated_accuracy": float(np.mean(gated == actual)),
        "point_critical_recall": float(np.mean((actual[gated >= 0] >= 2) & (base[gated >= 0] >= 2))) if len(actual) else 0.0,
        "gated_critical_recall": float(np.sum((actual >= 2) & (gated >= 2)) / max(1, np.sum(actual >= 2))),
        "gate_rate": float(active.mean()),
        "mean_normalized_uncertainty": float(u.mean()),
        "false_escalation_rate": float(np.mean((gated > actual) & (actual < 3))),
        "over_escalation_rate": float(np.mean(gated > actual)),
    }


def objective(rows):
    # Safety first, but explicitly penalize unnecessary escalation.
    rec = float(np.mean([r["gated_critical_recall"] for r in rows]))
    acc = float(np.mean([r["gated_accuracy"] for r in rows]))
    false = float(np.mean([r["false_escalation_rate"] for r in rows]))
    gate = float(np.mean([r["gate_rate"] for r in rows]))
    value = .55 * rec + .35 * acc - .08 * false - .02 * gate
    return value, acc, rec, false, gate


def main():
    print("=" * 78)
    print("ORCA-X SAFETY-GATE PRECISION + UNCERTAINTY CALIBRATION — REFINEMENT 29")
    print("=" * 78)
    print("Read-only benchmark | no production artifacts modified")
    if not DATA.exists():
        raise FileNotFoundError(DATA)
    df = pd.read_parquet(DATA)
    loc = location_col(df)
    q, ts = make_pairs(df, loc)
    X = build_X(q)
    Y = q[["future_" + c for c in TARGETS]].to_numpy(float)
    print(f"Source dataset: {DATA}")
    print(f"Rows source: {len(df):,} | exact +6h complete pairs: {len(q):,}")
    print(f"Locations: {q[loc].nunique()} | Features: {X.shape[1]}")
    print(f"Scenarios: {SCENARIOS}")

    locations = sorted(q[loc].astype(str).unique())
    thresholds = [.60, .80, 1.00, 1.20]
    boundary_factors = [.50, .70]
    levels = [.90, .95]
    best = None
    all_rows = []

    # Location holdout: no held-out observations are used to calibrate the gate.
    for ti, (threshold, boundary_factor, level) in enumerate(
        [(t, b, l) for l in levels for t in thresholds for b in boundary_factors], 1
    ):
        rows = []
        for li, hold in enumerate(locations):
            te = q[loc].astype(str).eq(hold).to_numpy()
            tr = ~te
            if tr.sum() < 100 or te.sum() < 20:
                continue
            pred_tr, _ = fit_members(X.loc[tr], Y[tr], X.loc[tr], 9000 + ti + li)
            calibration = calibrate(Y[tr], pred_tr, level)
            pred, sigma = fit_members(X.loc[tr], Y[tr], X.loc[te], 10000 + ti + li)
            for si, scenario in enumerate(SCENARIOS):
                Xin = X.loc[te] if scenario == "clean" else degrade(X.loc[te], scenario, 20000 + ti * 100 + li * 10 + si)
                p, s = fit_members(X.loc[tr], Y[tr], Xin, 11000 + ti + li + si)
                r = evaluate(p, s, Y[te], calibration, threshold, boundary_factor)
                r.update({"location": hold, "scenario": scenario, "threshold": threshold,
                          "boundary_factor": boundary_factor, "calibration_level": level})
                rows.append(r)
        stress = [r for r in rows if r["scenario"] != "clean"]
        if stress:
            value, acc, rec, false, gate_rate = objective(stress)
            print(f"[{ti:02d}/16] level={level:.2f} threshold={threshold:.2f} boundary={boundary_factor:.2f} objective={value:.5f} stress_acc={acc:.5f} stress_critical={rec:.5f} false={false:.5f} gate={gate_rate:.5f}")
            all_rows.extend(rows)
            candidate = {"trial": ti, "calibration_level": level, "threshold": threshold,
                         "boundary_factor": boundary_factor, "objective": value,
                         "stress_accuracy": acc, "stress_critical_recall": rec,
                         "stress_false_escalation_rate": false, "stress_gate_rate": gate_rate}
            if best is None or value > best["objective"]:
                best = candidate

    years = pd.to_datetime(q[ts], utc=True).dt.year.to_numpy()
    temporal = None
    if 2024 in years and 2025 in years:
        tr, te = years == 2024, years == 2025
        pred_tr, _ = fit_members(X.loc[tr], Y[tr], X.loc[tr], 29001)
        calibration = calibrate(Y[tr], pred_tr, best["calibration_level"])
        pred, sigma = fit_members(X.loc[tr], Y[tr], X.loc[te], 29002)
        e = evaluate(pred, sigma, Y[te], calibration, best["threshold"], best["boundary_factor"])
        temporal = {**e, "mean_mae": float(mean_absolute_error(Y[te], pred)),
                    "mean_r2": float(r2_score(Y[te], pred, multioutput="uniform_average")),
                    "rows": int(te.sum())}

    OUT.mkdir(parents=True, exist_ok=True)
    result = {
        "best": best,
        "temporal": temporal,
        "locations": locations,
        "scenarios": SCENARIOS,
        "source_rows": int(len(df)),
        "complete_pairs": int(len(q)),
        "strict_point_in_time": True,
        "production_modified": False,
    }
    (OUT / "refinement29_results.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
    pd.DataFrame(all_rows).to_csv(OUT / "safety_gate_calibration_by_scenario.csv", index=False)
    (OUT / "safety_gate_calibration_config.json").write_text(json.dumps({
        "thresholds": thresholds, "boundary_factors": boundary_factors,
        "calibration_levels": levels, "targets": TARGETS, "features": FEATURES,
        "horizon_hours": H, "scenarios": SCENARIOS,
        "point_in_time_rule": "observations at t only; future state at t+6h is target",
    }, indent=2), encoding="utf-8")
    print("=" * 78)
    print("REFINEMENT 29 COMPLETE")
    print("=" * 78)
    print(json.dumps(result, indent=2))
    print(f"Saved: {OUT / 'refinement29_results.json'}")
    print("Production model, risk policy, thresholds, and source dataset were NOT modified.")


if __name__ == "__main__":
    main()
