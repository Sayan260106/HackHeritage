"""ORCA-X Refinement 25: temporal persistence + observation-quality-aware forecasting.

Strict point-in-time benchmark. Only observations at t and historical observations
before t are used to forecast physical state at t+6h. This is read-only with
respect to production artifacts.
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
OUT = ROOT / "ml" / "models" / "refinement25"
HORIZON = int(RISK_HORIZON_HOURS)
DIGHA = "digha_wb"
SEED = 42
MAX_AGE_HOURS = 12

BASE_FEATURES = [
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
SCENARIOS = ["clean", "random_missing_10", "random_missing_25", "random_missing_40", "wind_outage", "sea_state_outage", "atmospheric_outage", "stale_wind", "stale_sea_state", "mixed_degradation"]
TRIALS = [
    dict(n_estimators=650, learning_rate=.045, max_depth=5, min_child_weight=10, subsample=.80, colsample_bytree=.80, reg_alpha=.15, reg_lambda=2.5, gamma=.02),
    dict(n_estimators=800, learning_rate=.04, max_depth=6, min_child_weight=12, subsample=.82, colsample_bytree=.78, reg_alpha=.20, reg_lambda=3.5, gamma=.03),
    dict(n_estimators=900, learning_rate=.035, max_depth=6, min_child_weight=16, subsample=.85, colsample_bytree=.75, reg_alpha=.25, reg_lambda=4.0, gamma=.04),
]


def find_location_col(df):
    for c in ("location", "station", "coastline", "location_id"):
        if c in df.columns:
            return c
    raise ValueError("No location column found")


def stable_seed(name, extra=0):
    return SEED + extra + int(hashlib.sha256(name.encode()).hexdigest()[:8], 16) % 100000


def load_source():
    if not DATA.exists():
        raise FileNotFoundError(f"Canonical processed dataset not found: {DATA}")
    df = pd.read_parquet(DATA).copy()
    source_rows = len(df)
    loc = find_location_col(df)
    required = ["timestamp", *BASE_FEATURES, *TARGETS]
    missing = [c for c in required if c not in df.columns]
    if missing:
        raise ValueError(f"Dataset missing required point-in-time fields: {missing}")
    df["timestamp"] = pd.to_datetime(df["timestamp"], utc=True, errors="coerce")
    df[loc] = df[loc].astype(str)
    for c in BASE_FEATURES + TARGETS:
        df[c] = pd.to_numeric(df[c], errors="coerce")
    df = df.dropna(subset=[loc, "timestamp"]).sort_values([loc, "timestamp"]).reset_index(drop=True)
    return df, loc, source_rows


def make_pairs(df, loc):
    future = df[[loc, "timestamp"] + TARGETS].copy()
    future["timestamp"] = future["timestamp"] - pd.to_timedelta(HORIZON, unit="h")
    future = future.rename(columns={c: f"future_{c}" for c in TARGETS})
    return df.merge(future, on=[loc, "timestamp"], how="inner", validate="one_to_one").dropna(subset=[f"future_{c}" for c in TARGETS]).reset_index(drop=True)


def proxy_risk(a):
    w, g, wave, swell, _ = a.T
    score = np.maximum(w, 0)*.45 + np.maximum(g, 0)*.20 + np.maximum(wave, 0)*5 + np.maximum(swell, 0)*3
    return np.select([score >= 34, score >= 24, score >= 14], [3, 2, 1], default=0).astype(int)


def evaluate(y, p):
    yr, pr = proxy_risk(y), proxy_risk(p)
    mae = np.mean(np.abs(y-p), axis=0)
    r2 = [float(r2_score(y[:, j], p[:, j])) if np.std(y[:, j]) > 1e-12 else 0.0 for j in range(len(TARGETS))]
    return {"policy_proxy_accuracy": float(accuracy_score(yr, pr)), "critical_proxy_recall": float(recall_score(yr >= 2, pr >= 2, zero_division=0)), "mean_mae": float(np.mean(mae)), "mean_r2": float(np.mean(r2)), "target_mae": dict(zip(TARGETS, map(float, mae))), "target_r2": dict(zip(TARGETS, r2))}


def add_temporal_features(df, loc):
    out = df[[loc, "timestamp"] + BASE_FEATURES].copy()
    g = out.groupby(loc, sort=False)
    for c in [x for x in BASE_FEATURES if x not in ("month", "season")]:
        for lag in (1, 3, 6):
            out[f"{c}_lag{lag}"] = g[c].shift(lag)
        out[f"{c}_delta1"] = out[c] - out[f"{c}_lag1"]
        out[f"{c}_delta6"] = out[c] - out[f"{c}_lag6"]
        out[f"{c}_mean6"] = g[c].transform(lambda s: s.shift(1).rolling(6, min_periods=1).mean())
        out[f"{c}_std6"] = g[c].transform(lambda s: s.shift(1).rolling(6, min_periods=2).std())
    for name, cols in GROUPS.items():
        present = out[cols].notna().all(axis=1).astype(int)
        last_seen = out["timestamp"].where(present.eq(1)).groupby(out[loc], sort=False).ffill()
        age = (out["timestamp"]-last_seen).dt.total_seconds()/3600.0
        out[f"{name}_age_h"] = age.clip(lower=0, upper=MAX_AGE_HOURS).fillna(MAX_AGE_HOURS)
        out[f"{name}_available"] = out[cols].notna().mean(axis=1)
        out[f"{name}_fully_available"] = present.astype(float)
    out["critical_available"] = out[["wind_available", "sea_state_available"]].min(axis=1)
    out["critical_stale"] = ((out["wind_age_h"] > 3) | (out["sea_state_age_h"] > 3)).astype(float)
    out["any_stale"] = (out[["wind_age_h", "sea_state_age_h", "atmospheric_age_h"]] > 3).any(axis=1).astype(float)
    return out.drop(columns=[loc, "timestamp"])


def build_feature_matrix(q, loc):
    """Return one uniquely-labelled matrix.

    BUG FIX: add_temporal_features already contains the 15 current point-in-time
    base features. Concatenating q[BASE_FEATURES] with it created duplicate column
    labels. Pandas then returned 2-D frames for e.g. ``a["wind_speed_kts"]``, so
    the augmentation mask had shape (n,15) while the selected frame had (n,30),
    causing: ValueError: Array conditional must be same shape as self.
    """
    X = add_temporal_features(q, loc).reset_index(drop=True)
    if X.columns.duplicated().any():
        dupes = X.columns[X.columns.duplicated()].tolist()
        raise RuntimeError(f"Duplicate feature columns after temporal engineering: {dupes}")
    return X.replace([np.inf, -np.inf], np.nan)


def _mask_columns(out, cols, rate, rng):
    """Apply a same-shape mask without pandas duplicate-column ambiguity."""
    cols = list(dict.fromkeys(c for c in cols if c in out.columns))
    if not cols:
        return out
    values = out.loc[:, cols].astype(float).copy()
    mask = rng.random(values.shape) < rate
    out.loc[:, cols] = values.mask(mask)
    return out


def degrade(X, scenario, seed):
    out = X.copy()
    rng = np.random.default_rng(seed)
    if scenario == "clean":
        return out
    if scenario.startswith("random_missing_"):
        return _mask_columns(out, BASE_FEATURES, int(scenario.rsplit("_", 1)[1])/100, rng)
    if scenario == "wind_outage":
        for c in out.columns:
            if c.startswith("wind_") and not any(k in c for k in ("age", "available", "stale")):
                out[c] = np.nan
        out["wind_age_h"], out["wind_available"], out["wind_fully_available"] = MAX_AGE_HOURS, 0.0, 0.0
        out["critical_available"], out["critical_stale"], out["any_stale"] = 0.0, 1.0, 1.0
        return out
    if scenario == "sea_state_outage":
        for c in out.columns:
            if (c.startswith("wave_") or c.startswith("swell_")) and not any(k in c for k in ("age", "available", "stale")):
                out[c] = np.nan
        out["sea_state_age_h"], out["sea_state_available"], out["sea_state_fully_available"] = MAX_AGE_HOURS, 0.0, 0.0
        out["critical_available"], out["critical_stale"], out["any_stale"] = 0.0, 1.0, 1.0
        return out
    if scenario == "atmospheric_outage":
        for c in out.columns:
            if (c.startswith("air_") or c.startswith("precipitation_")) and not any(k in c for k in ("age", "available", "stale")):
                out[c] = np.nan
        out["atmospheric_age_h"], out["atmospheric_available"], out["atmospheric_fully_available"] = MAX_AGE_HOURS, 0.0, 0.0
        out["any_stale"] = 1.0
        return out
    if scenario in {"stale_wind", "stale_sea_state"}:
        cols = WIND if scenario == "stale_wind" else SEA
        group = "wind" if scenario == "stale_wind" else "sea_state"
        for c in cols:
            lag = f"{c}_lag3"
            if lag in out.columns:
                out[c] = out[lag]
        out[f"{group}_age_h"], out[f"{group}_available"], out[f"{group}_fully_available"] = 3.0, 1.0, 1.0
        out["critical_stale"], out["any_stale"] = 1.0, 1.0
        return out
    if scenario == "mixed_degradation":
        _mask_columns(out, BASE_FEATURES, .25, rng)
        choose = rng.random(len(out)) < .25
        for c in SEA:
            if c in out.columns:
                out.loc[choose, c] = np.nan
        out.loc[choose, "sea_state_available"] = 0.0
        out.loc[choose, "sea_state_fully_available"] = 0.0
        out.loc[choose, "sea_state_age_h"] = MAX_AGE_HOURS
        out.loc[choose, "critical_available"] = 0.0
        out.loc[choose, "critical_stale"] = 1.0
        out.loc[choose, "any_stale"] = 1.0
        return out
    raise ValueError(scenario)


def fit_models(X, Y, params, seed, augmentation=True):
    rng = np.random.default_rng(seed)
    X = X.copy()
    if X.columns.duplicated().any():
        raise ValueError("Duplicate feature columns passed to fit_models")
    if augmentation:
        parts = [X]
        for rate in (.10, .25):
            a = _mask_columns(X.copy(), BASE_FEATURES, rate, rng)
            parts.append(a)
        X = pd.concat(parts, ignore_index=True)
        Y = np.tile(Y, (len(parts), 1))
    X = X.replace([np.inf, -np.inf], np.nan)
    med = X.median(numeric_only=True)
    Xf = X.fillna(med).fillna(0.0)
    models = []
    for j in range(len(TARGETS)):
        model = xgb.XGBRegressor(objective="reg:squarederror", tree_method="hist", random_state=seed, n_jobs=-1, **params)
        model.fit(Xf, Y[:, j], verbose=False)
        models.append(model)
    return models, med


def predict(models, X, med):
    X = X.replace([np.inf, -np.inf], np.nan).fillna(med).fillna(0.0)
    return np.column_stack([m.predict(X) for m in models])


def location_benchmark(q, X, Y, loc, hold, params, seed):
    tr = (q[loc] != hold).to_numpy()
    te = ~tr
    models, med = fit_models(X.loc[tr], Y[tr], params, seed, augmentation=True)
    rows = []
    for scenario in SCENARIOS:
        e = evaluate(Y[te], predict(models, degrade(X.loc[te], scenario, stable_seed(scenario, seed)), med))
        e.update(location=hold, scenario=scenario)
        rows.append(e)
    return rows


def summarize(rows):
    clean_acc = float(np.mean([r["policy_proxy_accuracy"] for r in rows if r["scenario"] == "clean"]))
    clean_crit = float(np.mean([r["critical_proxy_recall"] for r in rows if r["scenario"] == "clean"]))
    result = []
    for s in SCENARIOS:
        rs = [r for r in rows if r["scenario"] == s]
        acc = float(np.mean([r["policy_proxy_accuracy"] for r in rs]))
        crit = float(np.mean([r["critical_proxy_recall"] for r in rs]))
        result.append({"scenario": s, "policy_proxy_accuracy": acc, "critical_proxy_recall": crit, "mean_mae": float(np.mean([r["mean_mae"] for r in rs])), "mean_r2": float(np.mean([r["mean_r2"] for r in rs])), "accuracy_drop_vs_clean": clean_acc-acc, "critical_recall_drop_vs_clean": clean_crit-crit})
    return result


def main():
    print("="*78); print("ORCA-X TEMPORAL PERSISTENCE + RELIABILITY-AWARE FORECASTING — REFINEMENT 25"); print("="*78)
    print("Read-only benchmark | no production artifacts modified")
    print(f"Source dataset: {DATA}"); print(f"Forward horizon: +{HORIZON}h | policy: {POLICY_VERSION}")
    print("Contract: observed state at t + historical observations before t -> physical state at t+6h")
    df, loc, source_rows = load_source(); q = make_pairs(df, loc)
    Y = q[[f"future_{c}" for c in TARGETS]].to_numpy(float); X = build_feature_matrix(q, loc)
    locations = sorted(q[loc].unique()); selectable = [z for z in locations if z != DIGHA]
    print(f"Rows source: {source_rows:,} | exact +{HORIZON}h pairs: {len(q):,}")
    print(f"Locations: {len(locations)} | Base features: {len(BASE_FEATURES)} | Engineered features: {X.shape[1]}")
    print(f"Temporal features use lags 1/3/6 and past-only rolling windows; MAX_AGE_HOURS={MAX_AGE_HOURS}")
    print(f"Scenarios: {SCENARIOS}")
    trials = []
    for ti, params in enumerate(TRIALS, 1):
        rows = []
        for hold in selectable:
            rows.extend(location_benchmark(q, X, Y, loc, hold, params, stable_seed(f"trial-{ti}")))
        clean = [r for r in rows if r["scenario"] == "clean"]; stressed = [r for r in rows if r["scenario"] != "clean"]
        ca = float(np.mean([r["policy_proxy_accuracy"] for r in clean])); cc = float(np.mean([r["critical_proxy_recall"] for r in clean]))
        sa = float(np.mean([r["policy_proxy_accuracy"] for r in stressed])); sc = float(np.mean([r["critical_proxy_recall"] for r in stressed]))
        obj = .25*ca + .15*cc + .20*sa + .40*sc
        trials.append({"trial": ti, "params": params, "objective": obj, "rows": rows})
        print(f"[{ti:02d}/{len(TRIALS)}] objective={obj:.5f} clean_acc={ca:.5f} stress_acc={sa:.5f} stress_critical={sc:.5f}")
    best = max(trials, key=lambda z: z["objective"]); rows = best["rows"]; scenario_summary = summarize(rows)
    times = np.sort(q[q[loc] != DIGHA]["timestamp"].unique()); cut = times[int(.82*len(times))]
    tr = ((q[loc] != DIGHA) & (q["timestamp"] < cut)).to_numpy(); te = ((q[loc] != DIGHA) & (q["timestamp"] >= cut)).to_numpy()
    models, med = fit_models(X.loc[tr], Y[tr], best["params"], stable_seed("temporal"), True); temporal = evaluate(Y[te], predict(models, X.loc[te], med))
    dte = (q[loc] == DIGHA).to_numpy(); models, med = fit_models(X.loc[~dte], Y[~dte], best["params"], stable_seed("digha"), True); digha = evaluate(Y[dte], predict(models, X.loc[dte], med))
    digha_stress = []
    for s in SCENARIOS:
        e = evaluate(Y[dte], predict(models, degrade(X.loc[dte], s, stable_seed(f"digha-{s}")), med)); e["scenario"] = s; digha_stress.append(e)
    worst = min(scenario_summary, key=lambda r: r["policy_proxy_accuracy"])
    result = {"best_trial": best["trial"], "best_params": best["params"], "engineered_feature_count": int(X.shape[1]), "mean_policy_proxy_accuracy": float(np.mean([r["policy_proxy_accuracy"] for r in rows if r["scenario"] == "clean"])), "mean_clean_critical_proxy_recall": float(np.mean([r["critical_proxy_recall"] for r in rows if r["scenario"] == "clean"])), "mean_stress_policy_proxy_accuracy": float(np.mean([r["policy_proxy_accuracy"] for r in rows if r["scenario"] != "clean"])), "mean_stress_critical_proxy_recall": float(np.mean([r["critical_proxy_recall"] for r in rows if r["scenario"] != "clean"])), "worst_scenario": worst, "scenario_summary": scenario_summary, "temporal": temporal, "digha_final_audit": digha, "digha_stress_summary": digha_stress, "strict_point_in_time": True, "selection_excludes_digha": True, "production_modified": False}
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT/"refinement25_results.json").write_text(json.dumps(result, indent=2, default=str), encoding="utf-8")
    cfg = {"horizon_hours": HORIZON, "policy_version": POLICY_VERSION, "base_features": BASE_FEATURES, "targets": TARGETS, "temporal_lags": [1,3,6], "rolling_window_rows": 6, "max_age_hours": MAX_AGE_HOURS, "scenarios": SCENARIOS, "best_trial": best["trial"], "best_params": best["params"], "source_dataset": str(DATA), "strict_point_in_time": True, "selection_excludes_digha": True}
    (OUT/"temporal_reliability_config.json").write_text(json.dumps(cfg, indent=2), encoding="utf-8")
    pd.DataFrame(scenario_summary).to_csv(OUT/"robustness_by_scenario.csv", index=False); pd.DataFrame(digha_stress).to_csv(OUT/"digha_stress_audit.csv", index=False)
    print("="*78); print("REFINEMENT 25 COMPLETE"); print("="*78)
    print(json.dumps({"best_trial": best["trial"], "mean_clean_accuracy": result["mean_policy_proxy_accuracy"], "mean_clean_critical_recall": result["mean_clean_critical_proxy_recall"], "mean_stress_accuracy": result["mean_stress_policy_proxy_accuracy"], "mean_stress_critical_recall": result["mean_stress_critical_proxy_recall"], "temporal": temporal, "digha_final_audit": digha, "worst_scenario": worst}, indent=2))
    print(f"Saved: {OUT/'refinement25_results.json'}"); print(f"Saved: {OUT/'temporal_reliability_config.json'}"); print("Production model, risk policy, thresholds, and source dataset were NOT modified.")


if __name__ == "__main__":
    main()
