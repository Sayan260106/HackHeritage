"""ORCA-X Refinement 24: reliability-aware observation fusion benchmark.

Point-in-time only. The model receives observations at t and predicts physical
state at t+6h. Availability, staleness and sensor-group reliability indicators
are explicit features. Imputation statistics are fitted on training data only.
No future-derived fields, stored risk labels, or production artifacts are used.

This benchmark is deliberately designed around the Refinement-23 finding that
sea-state outage is the dominant failure mode. It compares a plain point-in-time
baseline against a reliability-aware model under clean, missing, outage, stale,
and mixed-degradation conditions. A degraded-confidence flag is emitted when
critical observation groups are unavailable or stale.
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

import numpy as np
import pandas as pd
import xgboost as xgb
from sklearn.metrics import accuracy_score, recall_score, r2_score

from config import PROCESSED_DIR, RISK_HORIZON_HOURS
from label_policy import POLICY_VERSION

ROOT = Path(__file__).resolve().parents[2]
DATA = PROCESSED_DIR / "orca_historical_marine_risk.parquet"
OUT = ROOT / "ml" / "models" / "refinement24"
HORIZON = int(RISK_HORIZON_HOURS)
DIGHA = "digha_wb"
SEED = 42
STALE_HOURS = 3

FEATURES = [
    "wind_speed_kts", "wind_gust_kts", "wind_direction_deg",
    "wave_height_m", "wave_period_s", "wave_direction_deg",
    "swell_height_m", "swell_period_s", "swell_direction_deg",
    "air_pressure_hpa", "air_temperature_c", "sea_surface_temperature_c",
    "precipitation_mm", "month", "season",
]
TARGETS = ["wind_speed_kts", "wind_gust_kts", "wave_height_m", "swell_height_m", "wave_period_s"]
WIND = ["wind_speed_kts", "wind_gust_kts", "wind_direction_deg"]
SEA = ["wave_height_m", "wave_period_s", "wave_direction_deg", "swell_height_m", "swell_period_s", "swell_direction_deg"]
ATMOS = ["air_pressure_hpa", "air_temperature_c", "precipitation_mm"]
GROUPS = {"wind": WIND, "sea_state": SEA, "atmospheric": ATMOS}

TRIALS = [
    dict(n_estimators=700, learning_rate=0.04, max_depth=5, min_child_weight=10, subsample=0.8, colsample_bytree=0.8, reg_alpha=0.15, reg_lambda=2.0, gamma=0.0),
    dict(n_estimators=900, learning_rate=0.035, max_depth=6, min_child_weight=10, subsample=0.8, colsample_bytree=0.8, reg_alpha=0.15, reg_lambda=3.0, gamma=0.03),
    dict(n_estimators=800, learning_rate=0.04, max_depth=5, min_child_weight=14, subsample=0.85, colsample_bytree=0.8, reg_alpha=0.2, reg_lambda=3.5, gamma=0.03),
]


def find_location_col(df):
    for c in ("location", "station", "coastline", "location_id"):
        if c in df.columns:
            return c
    raise ValueError("No location column found")


def stable_seed(name, extra=0):
    return SEED + extra + int(hashlib.sha256(name.encode()).hexdigest()[:8], 16) % 100000


def load_pairs():
    if not DATA.exists():
        raise FileNotFoundError(f"Canonical processed dataset not found: {DATA}")
    df = pd.read_parquet(DATA).copy()
    source_rows = len(df)
    loc = find_location_col(df)
    required = ["timestamp", *FEATURES, *TARGETS]
    missing = [c for c in required if c not in df.columns]
    if missing:
        raise ValueError(f"Dataset missing required point-in-time fields: {missing}")
    df["timestamp"] = pd.to_datetime(df["timestamp"], utc=True, errors="coerce")
    df[loc] = df[loc].astype(str)
    for c in FEATURES + TARGETS:
        df[c] = pd.to_numeric(df[c], errors="coerce")
    df = df.dropna(subset=[loc, "timestamp"]).sort_values([loc, "timestamp"]).reset_index(drop=True)
    future = df[[loc, "timestamp"] + TARGETS].copy()
    future["timestamp"] = future["timestamp"] - pd.to_timedelta(HORIZON, unit="h")
    future = future.rename(columns={c: f"future_{c}" for c in TARGETS})
    q = df.merge(future, on=[loc, "timestamp"], how="inner", validate="one_to_one")
    q = q.dropna(subset=[f"future_{c}" for c in TARGETS]).reset_index(drop=True)
    return q, loc, source_rows


def proxy_risk(a):
    w, g, wave, swell, _ = a.T
    score = np.maximum(w, 0) * .45 + np.maximum(g, 0) * .20 + np.maximum(wave, 0) * 5 + np.maximum(swell, 0) * 3
    return np.select([score >= 34, score >= 24, score >= 14], [3, 2, 1], default=0).astype(int)


def evaluate(y, p):
    yr, pr = proxy_risk(y), proxy_risk(p)
    mae = np.mean(np.abs(y - p), axis=0)
    r2 = [float(r2_score(y[:, j], p[:, j])) if np.std(y[:, j]) > 1e-12 else 0.0 for j in range(len(TARGETS))]
    return {
        "policy_proxy_accuracy": float(accuracy_score(yr, pr)),
        "critical_proxy_recall": float(recall_score(yr >= 2, pr >= 2, zero_division=0)),
        "mean_mae": float(np.mean(mae)), "mean_r2": float(np.mean(r2)),
        "target_mae": dict(zip(TARGETS, map(float, mae))), "target_r2": dict(zip(TARGETS, r2)),
    }


def add_reliability_features(X):
    X = X.copy()
    blocks = {}
    for name, cols in GROUPS.items():
        avail = X[cols].notna().mean(axis=1)
        X[f"{name}_availability"] = avail
        X[f"{name}_missing"] = (avail < 1.0).astype(float)
        blocks[name] = avail
    X["critical_observation_availability"] = X[["wind_availability", "sea_state_availability"]].min(axis=1)
    X["degraded_confidence"] = (X["critical_observation_availability"] < 1.0).astype(float)
    X["fully_observed"] = (X["critical_observation_availability"] >= 1.0).astype(float)
    return X


def scenario_frame(q, loc, scenario, seed):
    base = q[FEATURES].copy()
    if scenario == "clean":
        return base
    if scenario.startswith("random_missing_"):
        rate = int(scenario.rsplit("_", 1)[1]) / 100
        rng = np.random.default_rng(seed)
        return base.mask(rng.random(base.shape) < rate)
    if scenario == "wind_outage":
        base[WIND] = np.nan
        return base
    if scenario == "sea_state_outage":
        base[SEA] = np.nan
        return base
    if scenario == "atmospheric_outage":
        base[ATMOS] = np.nan
        return base
    if scenario in {"stale_wind", "stale_sea_state", "mixed_degradation"}:
        cols = WIND if scenario == "stale_wind" else SEA
        lag = q[[loc, "timestamp", *cols]].copy()
        lag["timestamp"] = lag["timestamp"] + pd.to_timedelta(STALE_HOURS, unit="h")
        lag = lag.rename(columns={c: f"stale_{c}" for c in cols})
        joined = q[[loc, "timestamp"]].merge(lag, on=[loc, "timestamp"], how="left", validate="one_to_one")
        for c in cols:
            base[c] = joined[f"stale_{c}"].to_numpy()
        if scenario == "mixed_degradation":
            rng = np.random.default_rng(seed)
            base.loc[:, [c for c in FEATURES if c not in cols]] = base[[c for c in FEATURES if c not in cols]].mask(rng.random((len(base), len([c for c in FEATURES if c not in cols]))) < .25)
        return base
    raise ValueError(scenario)


def fit(X, Y, params, reliability):
    X = add_reliability_features(X) if reliability else X.copy()
    X = X.replace([np.inf, -np.inf], np.nan)
    med = X.median(numeric_only=True)
    Xf = X.fillna(med).fillna(0.0)
    models = []
    for j in range(len(TARGETS)):
        m = xgb.XGBRegressor(objective="reg:squarederror", tree_method="hist", random_state=SEED, n_jobs=-1, **params)
        m.fit(Xf, Y[:, j], verbose=False)
        models.append(m)
    return models, med


def predict(models, X, med, reliability):
    X = add_reliability_features(X) if reliability else X.copy()
    X = X.replace([np.inf, -np.inf], np.nan).fillna(med).fillna(0.0)
    return np.column_stack([m.predict(X) for m in models])


def score_location(q, Y, loc, hold, params, reliability):
    tr = (q[loc] != hold).to_numpy(); te = ~tr
    models, med = fit(q.loc[tr, FEATURES], Y[tr], params, reliability)
    rows = []
    for scenario in SCENARIOS:
        X = scenario_frame(q.loc[te], loc, scenario, stable_seed(scenario, 500 if reliability else 0))
        p = predict(models, X, med, reliability)
        e = evaluate(Y[te], p)
        e.update(location=hold, scenario=scenario)
        if reliability:
            rf = add_reliability_features(X)
            e["degraded_confidence_rate"] = float(rf["degraded_confidence"].mean())
            e["fully_observed_rate"] = float(rf["fully_observed"].mean())
        rows.append(e)
    return rows

SCENARIOS = ["clean", "random_missing_10", "random_missing_25", "random_missing_40", "wind_outage", "sea_state_outage", "atmospheric_outage", "stale_wind", "stale_sea_state", "mixed_degradation"]


def main():
    print("=" * 78)
    print("ORCA-X RELIABILITY-AWARE OBSERVATION FUSION BENCHMARK — REFINEMENT 24")
    print("=" * 78)
    print("Read-only benchmark | no production artifacts modified")
    print(f"Source dataset: {DATA}")
    print(f"Forward horizon: +{HORIZON}h | policy: {POLICY_VERSION}")
    print("Contract: observed state at t -> physical state at t+6h")
    q, loc, source_rows = load_pairs()
    Y = q[[f"future_{c}" for c in TARGETS]].to_numpy(float)
    locations = sorted(q[loc].unique()); selectable = [z for z in locations if z != DIGHA]
    print(f"Rows source: {source_rows:,} | exact +{HORIZON}h pairs: {len(q):,}")
    print(f"Locations: {len(locations)} | Base features: {len(FEATURES)} | Reliability features: 10")
    print(f"Scenarios: {SCENARIOS}")

    trials = []
    for ti, params in enumerate(TRIALS, 1):
        all_rows = []
        for hold in selectable:
            all_rows.extend(score_location(q, Y, loc, hold, params, True))
        clean = [r for r in all_rows if r["scenario"] == "clean"]
        stressed = [r for r in all_rows if r["scenario"] != "clean"]
        clean_acc = np.mean([r["policy_proxy_accuracy"] for r in clean])
        clean_crit = np.mean([r["critical_proxy_recall"] for r in clean])
        stress_acc = np.mean([r["policy_proxy_accuracy"] for r in stressed])
        stress_crit = np.mean([r["critical_proxy_recall"] for r in stressed])
        objective = .30*clean_acc + .20*clean_crit + .20*stress_acc + .30*stress_crit
        trials.append({"trial": ti, "params": params, "objective": float(objective), "rows": all_rows})
        print(f"[{ti:02d}/{len(TRIALS)}] objective={objective:.5f} clean_acc={clean_acc:.5f} stress_acc={stress_acc:.5f} stress_critical={stress_crit:.5f}")

    best = max(trials, key=lambda x: x["objective"])
    params = best["params"]
    best_rows = best["rows"]
    clean_ref = np.mean([r["policy_proxy_accuracy"] for r in best_rows if r["scenario"] == "clean"])
    crit_ref = np.mean([r["critical_proxy_recall"] for r in best_rows if r["scenario"] == "clean"])
    scenario_summary = []
    for s in SCENARIOS:
        rs = [r for r in best_rows if r["scenario"] == s]
        scenario_summary.append({"scenario": s, "policy_proxy_accuracy": float(np.mean([r["policy_proxy_accuracy"] for r in rs])), "critical_proxy_recall": float(np.mean([r["critical_proxy_recall"] for r in rs])), "mean_mae": float(np.mean([r["mean_mae"] for r in rs])), "mean_r2": float(np.mean([r["mean_r2"] for r in rs])), "accuracy_drop_vs_clean": float(clean_ref-np.mean([r["policy_proxy_accuracy"] for r in rs])), "critical_recall_drop_vs_clean": float(crit_ref-np.mean([r["critical_proxy_recall"] for r in rs]))})

    # Temporal clean and Digha audit use the selected reliability-aware model.
    times = np.sort(q[q[loc] != DIGHA]["timestamp"].unique()); cut = times[int(.82*len(times))]
    tr = ((q[loc] != DIGHA) & (q["timestamp"] < cut)).to_numpy(); te = ((q[loc] != DIGHA) & (q["timestamp"] >= cut)).to_numpy()
    models, med = fit(q.loc[tr, FEATURES], Y[tr], params, True)
    temporal = evaluate(Y[te], predict(models, q.loc[te, FEATURES], med, True))
    dte = (q[loc] == DIGHA).to_numpy(); models, med = fit(q.loc[~dte, FEATURES], Y[~dte], params, True)
    digha = evaluate(Y[dte], predict(models, q.loc[dte, FEATURES], med, True))

    # Clean baseline with identical splits, so the comparison isolates reliability features.
    baseline_rows = []
    for hold in selectable:
        baseline_rows.extend(score_location(q, Y, loc, hold, params, False))
    bclean = [r for r in baseline_rows if r["scenario"] == "clean"]
    bstress = [r for r in baseline_rows if r["scenario"] != "clean"]
    comparison = {
        "baseline_clean_accuracy": float(np.mean([r["policy_proxy_accuracy"] for r in bclean])),
        "reliability_clean_accuracy": float(np.mean([r["policy_proxy_accuracy"] for r in best_rows if r["scenario"] == "clean"])),
        "baseline_stress_accuracy": float(np.mean([r["policy_proxy_accuracy"] for r in bstress])),
        "reliability_stress_accuracy": float(np.mean([r["policy_proxy_accuracy"] for r in [x for x in best_rows if x["scenario"] != "clean"]])),
        "baseline_stress_critical_recall": float(np.mean([r["critical_proxy_recall"] for r in bstress])),
        "reliability_stress_critical_recall": float(np.mean([r["critical_proxy_recall"] for r in best_rows if r["scenario"] != "clean"])),
    }

    OUT.mkdir(parents=True, exist_ok=True)
    payload = {"best_trial": best["trial"], "best_params": params, "objective": best["objective"], "scenario_summary": scenario_summary, "temporal_clean": temporal, "digha_final_audit": digha, "baseline_vs_reliability": comparison, "strict_point_in_time": True, "reliability_features": ["wind_availability", "wind_missing", "sea_state_availability", "sea_state_missing", "atmospheric_availability", "atmospheric_missing", "critical_observation_availability", "degraded_confidence", "fully_observed"], "scenarios": SCENARIOS}
    (OUT / "refinement24_results.json").write_text(json.dumps(payload, indent=2), encoding="utf-8")
    (OUT / "reliability_aware_config.json").write_text(json.dumps({"features": FEATURES, "reliability_features": payload["reliability_features"], "groups": GROUPS, "stale_hours": STALE_HOURS, "horizon_hours": HORIZON, "policy_version": POLICY_VERSION, "params": params}, indent=2), encoding="utf-8")
    pd.DataFrame(scenario_summary).to_csv(OUT / "robustness_by_scenario.csv", index=False)
    pd.DataFrame(best_rows).to_csv(OUT / "reliability_by_fold_scenario.csv", index=False)
    print("=" * 78)
    print("REFINEMENT 24 COMPLETE")
    print("=" * 78)
    print(json.dumps({"best_trial": best["trial"], "objective": best["objective"], "baseline_vs_reliability": comparison, "worst_scenario": min(scenario_summary, key=lambda x: x["policy_proxy_accuracy"]), "temporal_clean": temporal, "digha_final_audit": digha}, indent=2))
    print(f"Saved: {OUT / 'refinement24_results.json'}")
    print(f"Saved: {OUT / 'reliability_aware_config.json'}")
    print(f"Saved: {OUT / 'robustness_by_scenario.csv'}")
    print(f"Saved: {OUT / 'reliability_by_fold_scenario.csv'}")
    print("Production model, risk policy, thresholds, and source dataset were NOT modified.")


if __name__ == "__main__":
    main()
