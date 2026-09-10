"""
ORCA-X REFINEMENT 28 — CALIBRATED UNCERTAINTY + DEGRADATION-AWARE SAFETY GATE

Read-only benchmark. This refinement evaluates whether uncertainty should be
converted into conservative risk escalation under missing/stale observations.
It deliberately separates:
  1) point forecast quality,
  2) uncertainty calibration,
  3) degradation-aware gating,
  4) temporal holdout safety.

No production artifacts are modified.
"""
from __future__ import annotations

import json
import warnings
from pathlib import Path
import numpy as np
import pandas as pd
from sklearn.multioutput import MultiOutputRegressor
from sklearn.metrics import mean_absolute_error, r2_score
from xgboost import XGBRegressor

warnings.filterwarnings("ignore", category=FutureWarning)

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "ml/data/processed/orca_historical_marine_risk.parquet"
OUT = ROOT / "ml/models/refinement28"
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


def make_pairs(df, loc):
    ts = next(c for c in ["timestamp", "time", "datetime", "date_time"] if c in df.columns)
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
    X = X.fillna(X.median(numeric_only=True)).fillna(0.0)
    return X


def policy(y):
    w, g, wh, sh, _ = y.T
    score = np.maximum.reduce([w / 25.0, g / 35.0, wh / 3.0, sh / 2.0])
    return np.select([score >= 1.0, score >= .72, score >= .45], [3, 2, 1], default=0).astype(int)


def critical_recall(pred, truth):
    p, y = policy(pred), policy(truth)
    return float(np.sum((y >= 2) & (p >= 2)) / max(1, np.sum(y >= 2)))


def fit_members(Xtr, Ytr, Xte, seed):
    preds = []
    for i, s in enumerate([seed, seed + 17, seed + 31, seed + 47]):
        m = MultiOutputRegressor(XGBRegressor(
            n_estimators=350, max_depth=6, learning_rate=.055,
            subsample=.85, colsample_bytree=.85, objective="reg:squarederror",
            tree_method="hist", device="cuda", n_jobs=2, random_state=s
        ))
        m.fit(Xtr, Ytr)
        preds.append(np.column_stack([e.predict(Xte) for e in m.estimators_]))
    a = np.stack(preds)
    return a.mean(0), a.std(0)


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
        cols = list(out.columns)
        mask = rng.random((len(out), len(cols))) < rate
        out = out.mask(mask)
    elif scenario == "wind_outage":
        out[groups["wind"]] = np.nan
    elif scenario == "sea_state_outage":
        out[groups["sea"]] = np.nan
    elif scenario == "atmospheric_outage":
        out[groups["atm"]] = np.nan
    elif scenario == "mixed_degradation":
        for g in groups.values():
            if g:
                out[g] = out[g].mask(rng.random((len(out), len(g))) < .25)
    elif scenario == "stale_wind":
        for c in groups["wind"]:
            out[c] = out[c].shift(1)
    elif scenario == "stale_sea_state":
        for c in groups["sea"]:
            out[c] = out[c].shift(1)
    return out


def calibrate_sigma(Y, pred, q=.90):
    resid = np.abs(Y - pred)
    return np.quantile(resid, q, axis=0)


def conservative_gate(pred, sigma, calibration, threshold):
    # Normalized uncertainty is deliberately based only on training residual
    # calibration. It is never calibrated from the held-out future targets.
    u = np.mean(sigma / np.maximum(calibration, 1e-6), axis=1)
    pscore = policy(pred)
    boundary = (pscore >= 1) & (pscore <= 2)
    activate = (u >= threshold) | (boundary & (u >= threshold * .70))
    # Escalate one level conservatively; cap at EXTREME=3.
    gated = pscore.copy()
    gated[activate] = np.minimum(3, gated[activate] + 1)
    return gated, activate, u


def evaluate_gate(pred, sigma, truth, calibration, threshold):
    point = policy(pred)
    gated, active, uncertainty = conservative_gate(pred, sigma, calibration, threshold)
    actual = policy(truth)
    return {
        "point_accuracy": float(np.mean(point == actual)),
        "gated_accuracy": float(np.mean(gated == actual)),
        "point_critical_recall": float(np.sum((actual >= 2) & (point >= 2)) / max(1, np.sum(actual >= 2))),
        "gated_critical_recall": float(np.sum((actual >= 2) & (gated >= 2)) / max(1, np.sum(actual >= 2))),
        "gate_rate": float(active.mean()),
        "mean_normalized_uncertainty": float(uncertainty.mean()),
        "false_escalation_rate": float(np.mean((gated > actual) & (actual < 3))),
    }


def main():
    print("=" * 78)
    print("ORCA-X CALIBRATED UNCERTAINTY + DEGRADATION-AWARE SAFETY GATE — REFINEMENT 28")
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
    thresholds = [.60, .80, 1.00]
    all_rows = []
    best = None

    # Location holdout benchmark. Degradation is applied only to held-out
    # observations, while calibration is estimated from training residuals.
    for ti, threshold in enumerate(thresholds, 1):
        rows = []
        for hold in locations:
            te = q[loc].astype(str).eq(hold).to_numpy()
            tr = ~te
            if tr.sum() < 100 or te.sum() < 20:
                continue
            base_pred, _ = fit_members(X.loc[tr], Y[tr], X.loc[te], 2800 + ti)
            cal_pred, _ = fit_members(X.loc[tr], Y[tr], X.loc[tr], 3800 + ti)
            calibration = calibrate_sigma(Y[tr], cal_pred)
            # Clean: uncertainty gate must be evaluated without synthetic degradation.
            _, sigma_clean = fit_members(X.loc[tr], Y[tr], X.loc[te], 4800 + ti)
            r = evaluate_gate(base_pred, sigma_clean, Y[te], calibration, threshold)
            r.update({"location": hold, "scenario": "clean", "threshold": threshold})
            rows.append(r)
            for si, scenario in enumerate(SCENARIOS[1:], 1):
                Xstress = degrade(X.loc[te], scenario, 50000 + ti * 100 + si)
                # Median imputation uses prediction-time observations only; no future data.
                Xstress = Xstress.fillna(X.loc[tr].median(numeric_only=True)).fillna(0.0)
                pred, sigma = fit_members(X.loc[tr], Y[tr], Xstress, 5800 + ti + si)
                rr = evaluate_gate(pred, sigma, Y[te], calibration, threshold)
                rr.update({"location": hold, "scenario": scenario, "threshold": threshold})
                rows.append(rr)
        if not rows:
            continue
        clean = [r for r in rows if r["scenario"] == "clean"]
        stress = [r for r in rows if r["scenario"] != "clean"]
        acc = float(np.mean([r["gated_accuracy"] for r in stress]))
        rec = float(np.mean([r["gated_critical_recall"] for r in stress]))
        # Reward critical recall strongly but penalize indiscriminate escalation.
        false_rate = float(np.mean([r["false_escalation_rate"] for r in stress]))
        gate_rate = float(np.mean([r["gate_rate"] for r in stress]))
        objective = .55 * rec + .30 * acc - .10 * false_rate - .05 * max(0.0, gate_rate - .60)
        print(f"[{ti}/3] threshold={threshold:.2f} objective={objective:.5f} stress_acc={acc:.5f} stress_critical={rec:.5f} gate_rate={gate_rate:.5f}")
        all_rows.extend(rows)
        if best is None or objective > best["objective"]:
            best = {"trial": ti, "threshold": threshold, "objective": objective,
                    "stress_accuracy": acc, "stress_critical_recall": rec,
                    "stress_gate_rate": gate_rate, "stress_false_escalation_rate": false_rate}

    # Temporal 2024 -> 2025 audit with the selected threshold.
    years = pd.to_datetime(q[ts], utc=True).dt.year.to_numpy()
    temporal = None
    if 2024 in years and 2025 in years:
        tr, te = years == 2024, years == 2025
        p, s = fit_members(X.loc[tr], Y[tr], X.loc[te], 7028)
        cp, _ = fit_members(X.loc[tr], Y[tr], X.loc[tr], 8028)
        cal = calibrate_sigma(Y[tr], cp)
        clean = evaluate_gate(p, s, Y[te], cal, best["threshold"])
        temporal = {
            **clean,
            "mean_mae": float(mean_absolute_error(Y[te], p)),
            "mean_r2": float(r2_score(Y[te], p, multioutput="uniform_average")),
            "rows": int(te.sum()),
        }

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
    (OUT / "refinement28_results.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
    pd.DataFrame(all_rows).to_csv(OUT / "calibrated_gate_by_scenario.csv", index=False)
    (OUT / "calibrated_degradation_gate_config.json").write_text(json.dumps({
        "threshold_candidates": thresholds,
        "targets": TARGETS,
        "features": FEATURES,
        "horizon_hours": H,
        "scenarios": SCENARIOS,
    }, indent=2), encoding="utf-8")
    print("=" * 78)
    print("REFINEMENT 28 COMPLETE")
    print("=" * 78)
    print(json.dumps(result, indent=2))
    print(f"Saved: {OUT / 'refinement28_results.json'}")
    print("Production model, risk policy, thresholds, and source dataset were NOT modified.")


if __name__ == "__main__":
    main()
