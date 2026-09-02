"""
ORCA-X REFINEMENT 31 — RISK-AWARE XGBOOST MODEL OPTIMIZATION

Read-only benchmark for the continuous +6h marine-state model used by
Refinements 29/30.  This refinement changes the REGRESSORS, not the risk
policy or safety gate. It compares four explicitly defined XGBoost profiles
under six geographic holdouts, ten degradation scenarios, and 2024->2025
temporal validation.

No production model, risk policy, threshold, or source dataset is modified.
Designed for Colab T4/L4 execution.
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
OUT = ROOT / "ml/models/refinement31"
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

# Baseline reproduces Refinement 29's continuous regressor family.
PROFILES = {
    "baseline": dict(n_estimators=400, max_depth=6, learning_rate=.05, min_child_weight=1,
                      subsample=.85, colsample_bytree=.85, reg_alpha=0.0, reg_lambda=1.0, gamma=0.0),
    "regularized": dict(n_estimators=500, max_depth=5, learning_rate=.04, min_child_weight=8,
                        subsample=.90, colsample_bytree=.90, reg_alpha=.15, reg_lambda=3.0, gamma=.05),
    "balanced": dict(n_estimators=500, max_depth=5, learning_rate=.04, min_child_weight=4,
                     subsample=.90, colsample_bytree=.90, reg_alpha=.05, reg_lambda=2.0, gamma=.02),
    "robust": dict(n_estimators=450, max_depth=4, learning_rate=.05, min_child_weight=10,
                   subsample=.90, colsample_bytree=.85, reg_alpha=.20, reg_lambda=4.0, gamma=.10),
}


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
    w, g, wh, sh, _ = np.asarray(y, dtype=float).T
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


def fit_profile(Xtr, Ytr, profile, seed):
    p = PROFILES[profile].copy()
    med = Xtr.median(numeric_only=True)
    A = Xtr.fillna(med).fillna(0.0).astype(np.float32)
    members = []
    # Three seeds reduce dependence on one tree-sampling realization.
    for s in [seed, seed + 17, seed + 31]:
        models = []
        for j, target in enumerate(TARGETS):
            pp = p.copy()
            # Gust is the noisiest/highest-impact target; regularized profiles
            # receive a small extra stability constraint for that target.
            if target == "wind_gust_kts" and profile != "baseline":
                pp["min_child_weight"] += 2
                pp["reg_lambda"] += 1.0
            model = XGBRegressor(
                **pp, objective="reg:squarederror", tree_method="hist",
                device=os.getenv("ORCA_X_DEVICE", "cuda"),
                n_jobs=int(os.getenv("ORCA_X_N_JOBS", "2")), random_state=s + j,
            )
            model.fit(A, Ytr[:, j])
            models.append(model)
        members.append(models)
    return members, med


def predict(members, X, med):
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


def metrics(truth, pred):
    actual = policy(truth)
    predicted = policy(pred)
    critical = actual >= 2
    critical_pred = predicted >= 2
    miss = critical & ~critical_pred
    false = predicted > actual
    return {
        "accuracy": float(accuracy_score(actual, predicted)),
        "balanced_accuracy": float(balanced_accuracy_score(actual, predicted)),
        "macro_f1": float(f1_score(actual, predicted, average="macro", zero_division=0)),
        "critical_recall": float(critical_pred[critical].mean()) if critical.any() else 0.0,
        "critical_miss_rate": float(miss.mean()),
        "false_escalation_rate": float((false & (actual < 3)).mean()),
        "over_escalation_rate": float(false.mean()),
        "mean_mae": float(mean_absolute_error(truth, pred)),
        "mean_r2": float(r2_score(truth, pred, multioutput="uniform_average")),
        "wind_mae": float(mean_absolute_error(truth[:, 0], pred[:, 0])),
        "gust_mae": float(mean_absolute_error(truth[:, 1], pred[:, 1])),
        "wave_height_mae": float(mean_absolute_error(truth[:, 2], pred[:, 2])),
        "swell_height_mae": float(mean_absolute_error(truth[:, 3], pred[:, 3])),
        "wave_period_mae": float(mean_absolute_error(truth[:, 4], pred[:, 4])),
    }


def aggregate(rows):
    df = pd.DataFrame(rows)
    numeric = [c for c in df.columns if c not in {"profile", "location", "scenario"}]
    return df.groupby("profile")[numeric].mean().reset_index()


def ranking(spatial, temporal):
    s = spatial.groupby("profile").mean(numeric_only=True)
    t = temporal.set_index("profile") if len(temporal) else pd.DataFrame()
    out = []
    for profile in PROFILES:
        sr = s.loc[profile]
        tr = t.loc[profile] if profile in t.index else pd.Series(dtype=float)
        # Ranking is a transparent benchmark utility, not a scientific truth.
        # Safety is constrained first; accuracy and false escalation break ties.
        safety = float(sr["critical_recall"])
        score = (0.45 * safety + 0.35 * float(sr["accuracy"])
                 + 0.10 * float(sr["balanced_accuracy"])
                 - 0.07 * float(sr["false_escalation_rate"])
                 - 0.03 * float(sr["over_escalation_rate"]))
        out.append({"profile": profile, "stress_critical_recall": safety,
                    "stress_accuracy": float(sr["accuracy"]),
                    "stress_false_escalation_rate": float(sr["false_escalation_rate"]),
                    "stress_mean_mae": float(sr["mean_mae"]),
                    "temporal_critical_recall": float(tr.get("critical_recall", np.nan)),
                    "temporal_accuracy": float(tr.get("accuracy", np.nan)),
                    "temporal_mean_mae": float(tr.get("mean_mae", np.nan)),
                    "benchmark_score": score})
    return pd.DataFrame(out).sort_values("benchmark_score", ascending=False)


def main():
    started = time.perf_counter()
    print("=" * 82)
    print("ORCA-X REFINEMENT 31 — RISK-AWARE XGBOOST MODEL OPTIMIZATION")
    print("=" * 82)
    print("Read-only benchmark: model optimization only; production artifacts untouched")
    print(f"XGBoost device={os.getenv('ORCA_X_DEVICE', 'cuda')} n_jobs={os.getenv('ORCA_X_N_JOBS', '2')}")

    df = pd.read_parquet(DATA)
    loc = location_col(df)
    q, ts = make_pairs(df, loc)
    X = build_X(q)
    Y = q[["future_" + c for c in TARGETS]].to_numpy(float)
    locations = sorted(q[loc].astype(str).unique())
    years = pd.to_datetime(q[ts], utc=True).dt.year.to_numpy()
    print(f"Source rows={len(df):,} | complete +6h pairs={len(q):,} | locations={len(locations)} | features={X.shape[1]}")
    print(f"Profiles={list(PROFILES)} | scenarios={len(SCENARIOS)} | models/profile/fold=15")

    spatial_rows = []
    for li, hold in enumerate(locations, 1):
        te = q[loc].astype(str).eq(hold).to_numpy()
        tr = ~te
        print(f"\n[{li}/{len(locations)}] geographic holdout: {hold}")
        for pi, profile in enumerate(PROFILES, 1):
            print(f"  [{pi}/{len(PROFILES)}] training {profile} ...", flush=True)
            members, med = fit_profile(X.loc[tr], Y[tr], profile, 31000 + li * 1000 + pi * 100)
            for si, scenario in enumerate(SCENARIOS):
                Xin = X.loc[te] if scenario == "clean" else degrade(X.loc[te], scenario, 41000 + li * 100 + si)
                pred = predict(members, Xin, med)
                r = metrics(Y[te], pred)
                r.update({"profile": profile, "location": hold, "scenario": scenario})
                spatial_rows.append(r)
                if scenario == "clean":
                    print(f"      clean acc={r['accuracy']:.4f} critical_recall={r['critical_recall']:.4f} mae={r['mean_mae']:.4f}")

    spatial = pd.DataFrame(spatial_rows)
    stress = spatial[spatial.scenario != "clean"].copy()
    stress_summary = aggregate(stress)

    temporal_rows = []
    if (years == 2024).any() and (years == 2025).any():
        tr, te = years == 2024, years == 2025
        print("\nTemporal validation: train=2024 -> test=2025")
        for pi, profile in enumerate(PROFILES, 1):
            print(f"  [{pi}/{len(PROFILES)}] temporal {profile} ...", flush=True)
            members, med = fit_profile(X.loc[tr], Y[tr], profile, 51000 + pi * 100)
            pred = predict(members, X.loc[te], med)
            r = metrics(Y[te], pred)
            r.update({"profile": profile, "rows": int(te.sum())})
            temporal_rows.append(r)
            print(f"      acc={r['accuracy']:.4f} critical_recall={r['critical_recall']:.4f} mae={r['mean_mae']:.4f}")
    temporal = pd.DataFrame(temporal_rows)

    ranking_df = ranking(stress_summary, temporal)
    OUT.mkdir(parents=True, exist_ok=True)
    spatial.to_csv(OUT / "spatial_by_scenario.csv", index=False)
    stress_summary.to_csv(OUT / "stress_summary.csv", index=False)
    temporal.to_csv(OUT / "temporal_2024_2025.csv", index=False)
    ranking_df.to_csv(OUT / "profile_ranking.csv", index=False)

    elapsed = time.perf_counter() - started
    result = {
        "best_profile": ranking_df.iloc[0].to_dict(),
        "profiles": PROFILES,
        "targets": TARGETS,
        "features": FEATURES,
        "scenarios": SCENARIOS,
        "source_rows": int(len(df)),
        "complete_pairs": int(len(q)),
        "locations": locations,
        "temporal_train_year": 2024,
        "temporal_test_year": 2025,
        "strict_point_in_time": True,
        "production_modified": False,
        "selection_rule": "transparent benchmark score; safety recall weighted first, then accuracy/balanced accuracy with escalation penalties",
        "runtime_seconds": elapsed,
        "models_trained": int(len(locations) * len(PROFILES) * 15 + len(PROFILES) * 15),
    }
    (OUT / "refinement31_results.json").write_text(json.dumps(result, indent=2, default=float), encoding="utf-8")

    print("\n" + "=" * 82)
    print("REFINEMENT 31 COMPLETE")
    print("=" * 82)
    print(ranking_df.to_string(index=False))
    print("\nWinner is a benchmark candidate only; production model/risk policy was NOT changed.")
    print(f"Artifacts: {OUT}")
    print(f"Elapsed: {elapsed / 60:.2f} minutes")


if __name__ == "__main__":
    main()
