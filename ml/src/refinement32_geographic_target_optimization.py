"""
ORCA-X REFINEMENT 32 — GEOGRAPHIC + TARGET-AWARE OPTIMIZATION

Read-only benchmark focused on the weakness exposed by Refinement 31:
performance varies materially by coastline. This experiment compares:
  1) baseline: the existing 15 point-in-time features
  2) geographic_context: adds latitude/longitude and cyclical encodings
  3) geographic_target_aware: geographic_context plus target-specific
     regularization for noisy/high-impact targets

The experiment preserves the +6h forecasting setup, six spatial holdouts,
ten degradation scenarios, and 2024->2025 temporal validation. It also
reports per-location and per-target errors so the winning profile is not
selected from a single aggregate score.

NO production model, risk policy, threshold, or source dataset is modified.
Designed for Colab T4/L4.
"""
from __future__ import annotations

import json
import os
import time
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.metrics import accuracy_score, balanced_accuracy_score, f1_score, mean_absolute_error, r2_score
from xgboost import XGBRegressor

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "ml/data/processed/orca_historical_marine_risk.parquet"
OUT = ROOT / "ml/models/refinement32"
H = 6
TARGETS = ["wind_speed_kts", "wind_gust_kts", "wave_height_m", "swell_height_m", "wave_period_s"]
BASE_FEATURES = [
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
PROFILES = ("baseline", "geographic_context", "geographic_target_aware")

BASE_PARAMS = dict(
    n_estimators=450, max_depth=5, learning_rate=.05, min_child_weight=4,
    subsample=.90, colsample_bytree=.90, reg_alpha=.05, reg_lambda=2.0, gamma=.02,
)


def location_col(df):
    return next(c for c in ["location", "location_name", "station", "station_id", "site"] if c in df.columns)


def timestamp_col(df):
    return next(c for c in ["timestamp", "time", "datetime", "date_time"] if c in df.columns)


def make_pairs(df, loc):
    ts = timestamp_col(df)
    d = df.copy()
    d[ts] = pd.to_datetime(d[ts], utc=True, errors="coerce")
    d = d.dropna(subset=[ts]).sort_values([loc, ts])
    future = d[[loc, ts] + TARGETS].copy()
    future[ts] = future[ts] - pd.Timedelta(hours=H)
    future = future.rename(columns={c: "future_" + c for c in TARGETS})
    q = d.merge(future, on=[loc, ts], how="inner")
    valid = np.isfinite(q[["future_" + c for c in TARGETS]].to_numpy(float)).all(axis=1)
    return q.loc[valid].reset_index(drop=True), ts


def build_features(q, profile):
    X = q[[c for c in BASE_FEATURES if c in q.columns]].copy()
    for c in X.columns:
        X[c] = pd.to_numeric(X[c], errors="coerce")
    if profile in ("geographic_context", "geographic_target_aware"):
        for c in ["latitude", "longitude"]:
            if c in q.columns:
                X[c] = pd.to_numeric(q[c], errors="coerce")
        # Circular time/direction representations remove artificial 0/360 and
        # 12/1 month discontinuities without using future information.
        month = pd.to_numeric(q["month"], errors="coerce").fillna(1).to_numpy(float)
        X["month_sin"] = np.sin(2 * np.pi * (month - 1) / 12.0)
        X["month_cos"] = np.cos(2 * np.pi * (month - 1) / 12.0)
        for col in ["wind_direction_deg", "wave_direction_deg", "swell_direction_deg"]:
            if col in X.columns:
                a = X[col].fillna(0).to_numpy(float)
                X[col + "_sin"] = np.sin(np.deg2rad(a))
                X[col + "_cos"] = np.cos(np.deg2rad(a))
    return X


def policy(y):
    w, g, wh, sh, _ = np.asarray(y, dtype=float).T
    score = np.maximum.reduce([w / 25.0, g / 35.0, wh / 3.0, sh / 2.0])
    return np.select([score >= 1.0, score >= .72, score >= .45], [3, 2, 1], default=0).astype(int)


def degrade(X, scenario, seed):
    rng = np.random.default_rng(seed)
    out = X.copy().astype(float)
    groups = {
        "wind": [c for c in ["wind_speed_kts", "wind_gust_kts", "wind_direction_deg", "wind_direction_deg_sin", "wind_direction_deg_cos"] if c in out],
        "sea": [c for c in ["wave_height_m", "wave_period_s", "wave_direction_deg", "wave_direction_deg_sin", "wave_direction_deg_cos", "swell_height_m", "swell_period_s", "swell_direction_deg", "swell_direction_deg_sin", "swell_direction_deg_cos"] if c in out],
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


def fit(Xtr, Ytr, profile, seed):
    med = Xtr.median(numeric_only=True)
    A = Xtr.fillna(med).fillna(0.0).astype(np.float32)
    members = []
    for s in [seed, seed + 17, seed + 31]:
        models = []
        for j, target in enumerate(TARGETS):
            p = BASE_PARAMS.copy()
            if profile == "geographic_target_aware":
                # Wind/gust and sea-state heights dominate the operational risk
                # score and were the main error signals in earlier diagnostics.
                if target in ("wind_speed_kts", "wind_gust_kts"):
                    p.update(max_depth=4, min_child_weight=8, reg_alpha=.15, reg_lambda=3.0, gamma=.05)
                elif target in ("wave_height_m", "swell_height_m"):
                    p.update(max_depth=5, min_child_weight=6, reg_alpha=.10, reg_lambda=2.5, gamma=.03)
                else:
                    p.update(min_child_weight=5, reg_lambda=2.5)
            model = XGBRegressor(
                **p, objective="reg:squarederror", tree_method="hist",
                device=os.getenv("ORCA_X_DEVICE", "cuda"),
                n_jobs=int(os.getenv("ORCA_X_N_JOBS", "2")), random_state=s + j,
            )
            model.fit(A, Ytr[:, j])
            models.append(model)
        members.append(models)
    return members, med


def predict(members, X, med):
    A = X.fillna(med).fillna(0.0).astype(np.float32)
    cp = None
    cupy_X = None
    if os.getenv("ORCA_X_DEVICE", "cuda") == "cuda":
        try:
            import cupy as _cp
            cp = _cp
            cupy_X = cp.asarray(A.to_numpy(dtype=np.float32))
        except Exception:
            pass
    all_preds = []
    for models in members:
        cols = []
        for model in models:
            if cupy_X is not None:
                col = cp.asnumpy(model.get_booster().inplace_predict(cupy_X))
            else:
                col = model.predict(A)
            cols.append(np.asarray(col, dtype=np.float64))
        all_preds.append(np.column_stack(cols))
    return np.stack(all_preds, axis=0).mean(axis=0)


def metric_row(truth, pred, profile, location, scenario):
    actual = policy(truth)
    predicted = policy(pred)
    critical = actual >= 2
    critical_pred = predicted >= 2
    false = predicted > actual
    return {
        "profile": profile, "location": location, "scenario": scenario,
        "accuracy": float(accuracy_score(actual, predicted)),
        "balanced_accuracy": float(balanced_accuracy_score(actual, predicted)),
        "macro_f1": float(f1_score(actual, predicted, average="macro", zero_division=0)),
        "critical_recall": float(critical_pred[critical].mean()) if critical.any() else 0.0,
        "critical_miss_rate": float((critical & ~critical_pred).mean()),
        "false_escalation_rate": float((false & (actual < 3)).mean()),
        "over_escalation_rate": float(false.mean()),
        "mean_mae": float(mean_absolute_error(truth, pred)),
        "mean_r2": float(r2_score(truth, pred, multioutput="uniform_average")),
        "wind_mae": float(mean_absolute_error(truth[:, 0], pred[:, 0])),
        "gust_mae": float(mean_absolute_error(truth[:, 1], pred[:, 1])),
        "wave_height_mae": float(mean_absolute_error(truth[:, 2], pred[:, 2])),
        "swell_height_mae": float(mean_absolute_error(truth[:, 3], pred[:, 3])),
        "wave_period_mae": float(mean_absolute_error(truth[:, 4], pred[:, 4])),
        "wind_r2": float(r2_score(truth[:, 0], pred[:, 0])),
        "gust_r2": float(r2_score(truth[:, 1], pred[:, 1])),
        "wave_height_r2": float(r2_score(truth[:, 2], pred[:, 2])),
        "swell_height_r2": float(r2_score(truth[:, 3], pred[:, 3])),
        "wave_period_r2": float(r2_score(truth[:, 4], pred[:, 4])),
    }


def target_error_rows(truth, pred, profile, location, scenario):
    rows = []
    for j, target in enumerate(TARGETS):
        rows.append({
            "profile": profile, "location": location, "scenario": scenario,
            "target": target,
            "mae": float(mean_absolute_error(truth[:, j], pred[:, j])),
            "r2": float(r2_score(truth[:, j], pred[:, j])),
            "bias": float(np.mean(pred[:, j] - truth[:, j])),
        })
    return rows


def main():
    started = time.perf_counter()
    print("=" * 86)
    print("ORCA-X REFINEMENT 32 — GEOGRAPHIC + TARGET-AWARE OPTIMIZATION")
    print("=" * 86)
    print("Read-only benchmark: production artifacts, risk policy and thresholds untouched")
    print(f"XGBoost device={os.getenv('ORCA_X_DEVICE', 'cuda')} n_jobs={os.getenv('ORCA_X_N_JOBS', '2')}")
    df = pd.read_parquet(DATA)
    loc = location_col(df)
    q, ts = make_pairs(df, loc)
    Y = q[["future_" + c for c in TARGETS]].to_numpy(float)
    locations = sorted(q[loc].astype(str).unique())
    years = pd.to_datetime(q[ts], utc=True).dt.year.to_numpy()
    print(f"Source rows={len(df):,} | complete +6h pairs={len(q):,} | locations={len(locations)}")
    print(f"Profiles={list(PROFILES)} | scenarios={len(SCENARIOS)} | models/profile/fold=15")

    spatial_rows, target_rows = [], []
    for li, hold in enumerate(locations, 1):
        te = q[loc].astype(str).eq(hold).to_numpy()
        tr = ~te
        print(f"\n[{li}/{len(locations)}] geographic holdout: {hold}")
        for pi, profile in enumerate(PROFILES, 1):
            print(f"  [{pi}/{len(PROFILES)}] training {profile} ...", flush=True)
            X = build_features(q, profile)
            members, med = fit(X.loc[tr], Y[tr], profile, 32000 + li * 1000 + pi * 100)
            for si, scenario in enumerate(SCENARIOS):
                Xin = X.loc[te] if scenario == "clean" else degrade(X.loc[te], scenario, 42000 + li * 100 + si)
                pred = predict(members, Xin, med)
                spatial_rows.append(metric_row(Y[te], pred, profile, hold, scenario))
                target_rows.extend(target_error_rows(Y[te], pred, profile, hold, scenario))
                if scenario == "clean":
                    r = spatial_rows[-1]
                    print(f"      clean acc={r['accuracy']:.4f} critical_recall={r['critical_recall']:.4f} mae={r['mean_mae']:.4f} wind_mae={r['wind_mae']:.4f} gust_mae={r['gust_mae']:.4f}")

    spatial = pd.DataFrame(spatial_rows)
    target_df = pd.DataFrame(target_rows)
    stress = spatial[spatial.scenario != "clean"]
    stress_summary = stress.groupby("profile").mean(numeric_only=True).reset_index()

    temporal_rows = []
    if (years == 2024).any() and (years == 2025).any():
        tr, te = years == 2024, years == 2025
        print("\nTemporal validation: train=2024 -> test=2025")
        for pi, profile in enumerate(PROFILES, 1):
            X = build_features(q, profile)
            print(f"  [{pi}/{len(PROFILES)}] temporal {profile} ...", flush=True)
            members, med = fit(X.loc[tr], Y[tr], profile, 52000 + pi * 100)
            pred = predict(members, X.loc[te], med)
            r = metric_row(Y[te], pred, profile, "TEMPORAL_2025", "clean")
            r["rows"] = int(te.sum())
            temporal_rows.append(r)
            print(f"      acc={r['accuracy']:.4f} critical_recall={r['critical_recall']:.4f} mae={r['mean_mae']:.4f} wind_mae={r['wind_mae']:.4f} gust_mae={r['gust_mae']:.4f}")
    temporal = pd.DataFrame(temporal_rows)

    ranking = []
    for profile in PROFILES:
        s = stress_summary[stress_summary.profile == profile].iloc[0]
        t = temporal[temporal.profile == profile].iloc[0] if not temporal.empty else None
        # Transparent ranking only: safety recall first, then accuracy and
        # balanced accuracy, with penalties for escalation and large error.
        score = (
            .45 * s.critical_recall + .30 * s.accuracy + .10 * s.balanced_accuracy
            + .05 * s.macro_f1 - .06 * s.false_escalation_rate
            - .04 * min(s.mean_mae / 10.0, 1.0)
        )
        ranking.append({
            "profile": profile,
            "stress_critical_recall": float(s.critical_recall),
            "stress_accuracy": float(s.accuracy),
            "stress_balanced_accuracy": float(s.balanced_accuracy),
            "stress_macro_f1": float(s.macro_f1),
            "stress_false_escalation_rate": float(s.false_escalation_rate),
            "stress_mean_mae": float(s.mean_mae),
            "stress_wind_mae": float(s.wind_mae),
            "stress_gust_mae": float(s.gust_mae),
            "temporal_critical_recall": float(t.critical_recall) if t is not None else np.nan,
            "temporal_accuracy": float(t.accuracy) if t is not None else np.nan,
            "temporal_mean_mae": float(t.mean_mae) if t is not None else np.nan,
            "temporal_wind_mae": float(t.wind_mae) if t is not None else np.nan,
            "temporal_gust_mae": float(t.gust_mae) if t is not None else np.nan,
            "benchmark_score": float(score),
        })
    ranking_df = pd.DataFrame(ranking).sort_values("benchmark_score", ascending=False)

    OUT.mkdir(parents=True, exist_ok=True)
    spatial.to_csv(OUT / "spatial_by_scenario.csv", index=False)
    stress_summary.to_csv(OUT / "stress_summary.csv", index=False)
    target_df.to_csv(OUT / "per_target_by_location_scenario.csv", index=False)
    temporal.to_csv(OUT / "temporal_2024_2025.csv", index=False)
    ranking_df.to_csv(OUT / "profile_ranking.csv", index=False)

    elapsed = time.perf_counter() - started
    result = {
        "best_profile": ranking_df.iloc[0].to_dict(),
        "profiles": list(PROFILES), "targets": TARGETS, "base_features": BASE_FEATURES,
        "scenarios": SCENARIOS, "source_rows": int(len(df)), "complete_pairs": int(len(q)),
        "locations": locations, "temporal_train_year": 2024, "temporal_test_year": 2025,
        "strict_point_in_time": True, "production_modified": False,
        "selection_rule": "transparent benchmark score; safety recall weighted first with accuracy/balanced-F1 and escalation/error penalties",
        "runtime_seconds": elapsed,
    }
    (OUT / "refinement32_results.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
    print("\n" + "=" * 86)
    print("REFINEMENT 32 COMPLETE")
    print("=" * 86)
    print(ranking_df.to_string(index=False, float_format=lambda x: f"{x:.6f}"))
    print("\nWinner is a benchmark candidate only; production model/risk policy was NOT changed.")
    print(f"Artifacts: {OUT}")
    print(f"Elapsed: {elapsed / 60:.2f} minutes")


if __name__ == "__main__":
    main()
