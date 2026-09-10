"""
ORCA-X REFINEMENT 31 — RISK-AWARE XGBOOST MODEL OPTIMIZATION

Final model-training benchmark after Refinements 29/29A/30 showed that the
uncertainty gate improves critical recall but creates excessive escalation.
This benchmark therefore optimizes the regression model itself instead of
adding another production gate.

Design goals:
- exact +6h point-in-time target construction
- six geographic holdouts
- 2024 -> 2025 temporal validation
- all ten degradation scenarios
- risk-class metrics are primary; regression metrics are secondary
- targeted XGBoost profiles only; no blind hyperparameter sweep
- production artifacts are NEVER modified

The benchmark trains each profile once per location fold and reuses those
models across all degradation scenarios. The same is done for temporal
validation. A candidate is preferred only when it protects HIGH/EXTREME
recall while reducing unnecessary over-escalation relative to the baseline.
"""
from __future__ import annotations

import json
import os
import time
import warnings
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.metrics import accuracy_score, balanced_accuracy_score, f1_score, mean_absolute_error, r2_score
from xgboost import XGBRegressor

warnings.filterwarnings("ignore", category=FutureWarning)

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "ml/data/processed/orca_historical_marine_risk.parquet"
OUT = ROOT / "ml/models/refinement31"
H = 6
TARGETS = ["wind_speed_kts", "wind_gust_kts", "wave_height_m", "swell_height_m", "wave_period_s"]
DRIVER_TARGETS = ["wind_speed_kts", "wind_gust_kts", "wave_height_m", "swell_height_m"]
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

# Deliberately small, interpretable model profiles. The baseline reproduces
# the current Refinement-29 regression model. Other profiles specifically
# target overfitting/noisy gust predictions without changing the feature set.
PROFILES = {
    "baseline": {
        "n_estimators": 400, "max_depth": 6, "learning_rate": 0.05,
        "min_child_weight": 1, "subsample": 0.85, "colsample_bytree": 0.85,
        "reg_alpha": 0.0, "reg_lambda": 1.0, "gamma": 0.0,
        "gust_min_child_weight": 1, "gust_reg_lambda": 1.0,
    },
    "regularized": {
        "n_estimators": 550, "max_depth": 5, "learning_rate": 0.04,
        "min_child_weight": 6, "subsample": 0.85, "colsample_bytree": 0.85,
        "reg_alpha": 0.10, "reg_lambda": 2.5, "gamma": 0.05,
        "gust_min_child_weight": 12, "gust_reg_lambda": 4.0,
    },
    "balanced": {
        "n_estimators": 500, "max_depth": 5, "learning_rate": 0.045,
        "min_child_weight": 3, "subsample": 0.90, "colsample_bytree": 0.90,
        "reg_alpha": 0.05, "reg_lambda": 1.75, "gamma": 0.02,
        "gust_min_child_weight": 8, "gust_reg_lambda": 3.0,
    },
    "robust": {
        "n_estimators": 650, "max_depth": 4, "learning_rate": 0.035,
        "min_child_weight": 8, "subsample": 0.90, "colsample_bytree": 0.80,
        "reg_alpha": 0.15, "reg_lambda": 3.5, "gamma": 0.05,
        "gust_min_child_weight": 16, "gust_reg_lambda": 5.0,
    },
}

RISK_SCALES = np.array([25.0, 35.0, 3.0, 2.0])


def location_col(df: pd.DataFrame) -> str:
    for c in ["location", "location_name", "station", "station_id", "site"]:
        if c in df.columns:
            return c
    raise ValueError("No location column found")


def timestamp_col(df: pd.DataFrame) -> str:
    for c in ["timestamp", "time", "datetime", "date_time"]:
        if c in df.columns:
            return c
    raise ValueError("No timestamp column found")


def make_pairs(df: pd.DataFrame, loc: str):
    ts = timestamp_col(df)
    d = df.copy()
    d[ts] = pd.to_datetime(d[ts], utc=True, errors="coerce")
    d = d.dropna(subset=[ts]).sort_values([loc, ts])
    future = d[[loc, ts] + TARGETS].copy()
    future[ts] = future[ts] - pd.Timedelta(hours=H)
    future = future.rename(columns={c: "future_" + c for c in TARGETS})
    q = d.merge(future, on=[loc, ts], how="inner")
    ycols = ["future_" + c for c in TARGETS]
    valid = np.isfinite(q[ycols].to_numpy(float)).all(axis=1)
    return q.loc[valid].reset_index(drop=True), ts


def build_X(q: pd.DataFrame) -> pd.DataFrame:
    X = q[[c for c in FEATURES if c in q.columns]].copy()
    for c in X.columns:
        X[c] = pd.to_numeric(X[c], errors="coerce")
    return X


def policy(y: np.ndarray) -> np.ndarray:
    y = np.asarray(y, dtype=float)
    w, g, wh, sh, _ = y.T
    score = np.maximum.reduce([w / 25.0, g / 35.0, wh / 3.0, sh / 2.0])
    return np.select([score >= 1.0, score >= 0.72, score >= 0.45], [3, 2, 1], default=0).astype(int)


def degrade(X: pd.DataFrame, scenario: str, seed: int) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    out = X.copy().astype(float)
    groups = {
        "wind": [c for c in ["wind_speed_kts", "wind_gust_kts", "wind_direction_deg"] if c in out],
        "sea": [c for c in ["wave_height_m", "wave_period_s", "wave_direction_deg", "swell_height_m", "swell_period_s", "swell_direction_deg"] if c in out],
        "atm": [c for c in ["air_pressure_hpa", "air_temperature_c", "precipitation_mm"] if c in out],
    }
    if scenario.startswith("random_missing_"):
        rate = int(scenario.rsplit("_", 1)[1]) / 100.0
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
                out.loc[:, cols] = out[cols].mask(rng.random((len(out), len(cols))) < 0.25)
    elif scenario == "stale_wind":
        out.loc[:, groups["wind"]] = out[groups["wind"]].shift(1)
    elif scenario == "stale_sea_state":
        out.loc[:, groups["sea"]] = out[groups["sea"]].shift(1)
    return out


def fit_profile(Xtr: pd.DataFrame, Ytr: np.ndarray, profile_name: str, seed: int):
    p = PROFILES[profile_name]
    med = Xtr.median(numeric_only=True)
    A = Xtr.fillna(med).fillna(0.0).astype(np.float32)
    models = []
    device = os.getenv("ORCA_X_DEVICE", "cuda")
    n_jobs = int(os.getenv("ORCA_X_N_JOBS", "2"))
    for j, target in enumerate(TARGETS):
        params = dict(
            n_estimators=p["n_estimators"], max_depth=p["max_depth"],
            learning_rate=p["learning_rate"], min_child_weight=(p["gust_min_child_weight"] if target == "wind_gust_kts" else p["min_child_weight"]),
            subsample=p["subsample"], colsample_bytree=p["colsample_bytree"],
            reg_alpha=p["reg_alpha"], reg_lambda=(p["gust_reg_lambda"] if target == "wind_gust_kts" else p["reg_lambda"]),
            gamma=p["gamma"], objective="reg:squarederror", tree_method="hist",
            device=device, n_jobs=n_jobs, random_state=seed + j,
        )
        models.append(XGBRegressor(**params))
        models[-1].fit(A, Ytr[:, j])
    return models, med


def predict(models, X: pd.DataFrame, med: pd.Series) -> np.ndarray:
    A = X.fillna(med).fillna(0.0).astype(np.float32)
    return np.column_stack([m.predict(A) for m in models]).astype(np.float64)


def evaluate(pred: np.ndarray, truth: np.ndarray) -> dict:
    base = policy(pred)
    actual = policy(truth)
    critical = actual >= 2
    critical_n = max(1, int(critical.sum()))
    over = pred_class = base > actual
    under_critical = critical & (base < 2)
    false_critical = (actual < 2) & (base >= 2)
    return {
        "accuracy": float(accuracy_score(actual, base)),
        "balanced_accuracy": float(balanced_accuracy_score(actual, base)),
        "macro_f1": float(f1_score(actual, base, average="macro", zero_division=0)),
        "critical_recall": float(np.sum(critical & (base >= 2)) / critical_n),
        "critical_miss_rate": float(np.sum(under_critical) / critical_n),
        "false_escalation_rate": float(np.mean(over & (actual < 3))),
        "over_escalation_rate": float(np.mean(over)),
        "false_critical_rate": float(np.mean(false_critical)),
        "mean_abs_class_error": float(np.mean(np.abs(base.astype(float) - actual.astype(float)))),
        "rows": int(len(actual)),
    }


def regression_metrics(pred: np.ndarray, truth: np.ndarray) -> dict:
    maes = mean_absolute_error(truth, pred, multioutput="raw_values")
    r2s = r2_score(truth, pred, multioutput="raw_values")
    return {
        "mean_mae": float(np.mean(maes)),
        "mean_r2": float(np.mean(r2s)),
        "target_mae": {t: float(v) for t, v in zip(TARGETS, maes)},
        "target_r2": {t: float(v) for t, v in zip(TARGETS, r2s)},
    }


def aggregate(rows: list[dict]) -> dict:
    keys = ["accuracy", "balanced_accuracy", "macro_f1", "critical_recall", "critical_miss_rate",
            "false_escalation_rate", "over_escalation_rate", "false_critical_rate", "mean_abs_class_error"]
    return {k: float(np.mean([r[k] for r in rows])) for k in keys}


def score_candidate(clean: dict, stress: dict, temporal: dict | None, baseline_stress: dict | None) -> float:
    # Safety first, then precision. The reference baseline is included only as
    # a comparator; the score itself does not require a hand-picked baseline
    # threshold and therefore remains interpretable.
    rec = stress["critical_recall"]
    acc = stress["accuracy"]
    false = stress["false_escalation_rate"]
    miss = stress["critical_miss_rate"]
    class_err = stress["mean_abs_class_error"]
    temporal_rec = temporal["critical_recall"] if temporal else rec
    temporal_acc = temporal["accuracy"] if temporal else acc
    # Strongly penalize any safety regression. Above 0.98 recall, precision
    # matters more because the current system already has ~0.98 recall.
    safety_bonus = 0.45 * rec + 0.20 * temporal_rec
    precision_term = 0.25 * acc - 0.07 * false - 0.03 * class_err
    temporal_term = 0.10 * temporal_acc
    penalty = 0.0
    if rec < 0.965:
        penalty += (0.965 - rec) * 4.0
    if temporal_rec < 0.975:
        penalty += (0.975 - temporal_rec) * 4.0
    if baseline_stress is not None:
        # Reward actual reduction in unnecessary escalation versus baseline.
        penalty += max(0.0, false - baseline_stress["false_escalation_rate"]) * 0.25
    return float(safety_bonus + precision_term + temporal_term - penalty - 0.03 * miss)


def main():
    started = time.perf_counter()
    print("=" * 78)
    print("ORCA-X REFINEMENT 31 — RISK-AWARE XGBOOST MODEL OPTIMIZATION")
    print("=" * 78)
    print("Final targeted model benchmark | no production artifacts modified")
    print("Profiles:", ", ".join(PROFILES))
    df = pd.read_parquet(DATA)
    loc = location_col(df)
    q, ts = make_pairs(df, loc)
    X = build_X(q)
    Y = q[["future_" + c for c in TARGETS]].to_numpy(float)
    locations = sorted(q[loc].astype(str).unique())
    print(f"Rows source: {len(df):,} | complete +6h pairs: {len(q):,}")
    print(f"Locations: {len(locations)} | features: {X.shape[1]} | targets: {len(TARGETS)}")
    print(f"Scenarios: {len(SCENARIOS)} | profiles: {len(PROFILES)}")

    # Cache predictions by profile/location/scenario so evaluation never
    # retrains a model.
    spatial = {name: [] for name in PROFILES}
    for li, hold in enumerate(locations):
        te = q[loc].astype(str).eq(hold).to_numpy()
        tr = ~te
        print(f"[{li + 1}/{len(locations)}] spatial holdout={hold}", flush=True)
        for pi, name in enumerate(PROFILES):
            models, med = fit_profile(X.loc[tr], Y[tr], name, 31000 + li * 100 + pi * 1000)
            for si, scenario in enumerate(SCENARIOS):
                Xin = X.loc[te] if scenario == "clean" else degrade(X.loc[te], scenario, 41000 + li * 100 + si)
                pred = predict(models, Xin, med)
                e = evaluate(pred, Y[te])
                r = {"profile": name, "location": hold, "scenario": scenario, **e}
                if scenario == "clean":
                    r.update(regression_metrics(pred, Y[te]))
                spatial[name].append(r)
            print(f"  profile={name} complete", flush=True)

    # Temporal benchmark uses the exact 2024 -> 2025 split and is independent
    # from the spatial holdout training.
    years = pd.to_datetime(q[ts], utc=True).dt.year.to_numpy()
    if not ({2024, 2025} <= set(years)):
        raise ValueError("Temporal benchmark requires both 2024 and 2025 rows")
    tr_t, te_t = years == 2024, years == 2025
    print("Temporal validation: training 2024 -> testing 2025 ...", flush=True)
    temporal = {}
    for pi, name in enumerate(PROFILES):
        models, med = fit_profile(X.loc[tr_t], Y[tr_t], name, 51000 + pi * 1000)
        pred = predict(models, X.loc[te_t], med)
        temporal[name] = {**evaluate(pred, Y[te_t]), **regression_metrics(pred, Y[te_t])}
        print(f"  profile={name} temporal accuracy={temporal[name]['accuracy']:.5f} critical_recall={temporal[name]['critical_recall']:.5f} false={temporal[name]['false_escalation_rate']:.5f}", flush=True)

    summaries = []
    baseline_stress = None
    for name in PROFILES:
        rows = spatial[name]
        stress_rows = [r for r in rows if r["scenario"] != "clean"]
        clean_rows = [r for r in rows if r["scenario"] == "clean"]
        stress = aggregate(stress_rows)
        clean = aggregate(clean_rows)
        if name == "baseline":
            baseline_stress = stress
        score = score_candidate(clean, stress, temporal[name], baseline_stress if name != "baseline" else None)
        summaries.append({
            "profile": name,
            "objective": score,
            "spatial_clean": clean,
            "spatial_stress": stress,
            "temporal": temporal[name],
            "config": PROFILES[name],
        })

    # Selection constraints: preserve strong critical recall on both validation
    # axes, then prefer lower false escalation and higher accuracy.
    feasible = [s for s in summaries if s["spatial_stress"]["critical_recall"] >= 0.965 and s["temporal"]["critical_recall"] >= 0.975]
    if not feasible:
        feasible = summaries
    feasible = sorted(feasible, key=lambda s: s["objective"], reverse=True)
    best = feasible[0]

    # Scenario-level table for auditability.
    scenario_rows = []
    for name in PROFILES:
        scenario_rows.extend(spatial[name])
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "refinement31_results.json").write_text(json.dumps({
        "refinement": "31",
        "purpose": "risk_aware_xgboost_model_optimization",
        "best": best,
        "ranking": feasible,
        "all_profiles": summaries,
        "locations": locations,
        "scenarios": SCENARIOS,
        "targets": TARGETS,
        "driver_targets": DRIVER_TARGETS,
        "source_rows": int(len(df)),
        "complete_pairs": int(len(q)),
        "temporal_train_year": 2024,
        "temporal_test_year": 2025,
        "production_modified": False,
        "selection": {
            "spatial_stress_critical_recall_min": 0.965,
            "temporal_critical_recall_min": 0.975,
            "priority": "safety recall first, then accuracy and unnecessary escalation",
            "models_reused_across_scenarios": True,
        },
        "elapsed_seconds": time.perf_counter() - started,
    }, indent=2, default=float), encoding="utf-8")
    pd.DataFrame(scenario_rows).to_csv(OUT / "refinement31_by_scenario.csv", index=False)
    pd.DataFrame([
        {
            "profile": s["profile"], "objective": s["objective"],
            "spatial_stress_accuracy": s["spatial_stress"]["accuracy"],
            "spatial_stress_critical_recall": s["spatial_stress"]["critical_recall"],
            "spatial_stress_false_escalation": s["spatial_stress"]["false_escalation_rate"],
            "temporal_accuracy": s["temporal"]["accuracy"],
            "temporal_critical_recall": s["temporal"]["critical_recall"],
            "temporal_false_escalation": s["temporal"]["false_escalation_rate"],
            "temporal_mean_mae": s["temporal"]["mean_mae"],
            "temporal_mean_r2": s["temporal"]["mean_r2"],
        }
        for s in summaries
    ]).sort_values("objective", ascending=False).to_csv(OUT / "refinement31_ranking.csv", index=False)
    (OUT / "refinement31_config.json").write_text(json.dumps({
        "profiles": PROFILES,
        "targets": TARGETS,
        "driver_targets": DRIVER_TARGETS,
        "features": FEATURES,
        "horizon_hours": H,
        "scenarios": SCENARIOS,
        "point_in_time_rule": "features at t predict observed marine state at t+6h",
        "production_rule": "benchmark only; no production model or risk policy is modified",
    }, indent=2), encoding="utf-8")

    print("=" * 78)
    print("REFINEMENT 31 COMPLETE")
    print("=" * 78)
    print(json.dumps({
        "best_profile": best["profile"],
        "objective": best["objective"],
        "spatial_stress": best["spatial_stress"],
        "temporal": best["temporal"],
        "production_modified": False,
        "elapsed_minutes": (time.perf_counter() - started) / 60.0,
    }, indent=2, default=float))
    print(f"Saved: {OUT / 'refinement31_results.json'}")
    print("Production model, risk policy, thresholds, and source dataset were NOT modified.")


if __name__ == "__main__":
    main()
