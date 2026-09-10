"""ORCA-X Refinement 26: uncertainty-aware continuous forecasting.

Read-only benchmark. Builds an ensemble of point-in-time temporal forecasters,
calibrates target-wise residual uncertainty on a chronological calibration slice,
and converts the upper uncertainty envelope into a conservative operational-risk
forecast. No production model, policy, thresholds, or source dataset is modified.

Design goals:
- preserve the strict point-in-time contract from Refinement 22/25;
- quantify forecast uncertainty instead of treating a point prediction as certain;
- use chronological calibration only (never future observations);
- select hyperparameters without using Digha;
- evaluate clean, temporal, Digha and observation-degradation performance;
- report whether the conservative uncertainty envelope improves critical recall
  without an unacceptable false-alarm increase.
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
from refinement25_temporal_reliability_forecast import (
    BASE_FEATURES,
    TARGETS,
    DIGHA,
    build_feature_matrix,
    degrade,
    find_location_col,
    make_pairs,
    stable_seed,
)

ROOT = Path(__file__).resolve().parents[2]
DATA = PROCESSED_DIR / "orca_historical_marine_risk.parquet"
OUT = ROOT / "ml" / "models" / "refinement26"
HORIZON = int(RISK_HORIZON_HOURS)
SEED = 42
CONFIDENCE = 0.90
CALIBRATION_FRACTION = 0.20
SCENARIOS = [
    "clean", "random_missing_10", "random_missing_25", "random_missing_40",
    "wind_outage", "sea_state_outage", "atmospheric_outage",
    "stale_wind", "stale_sea_state", "mixed_degradation",
]
TRIALS = [
    dict(n_estimators=650, learning_rate=.045, max_depth=5, min_child_weight=10,
         subsample=.80, colsample_bytree=.80, reg_alpha=.15, reg_lambda=2.5, gamma=.02),
    dict(n_estimators=800, learning_rate=.04, max_depth=6, min_child_weight=12,
         subsample=.82, colsample_bytree=.78, reg_alpha=.20, reg_lambda=3.5, gamma=.03),
    dict(n_estimators=900, learning_rate=.035, max_depth=6, min_child_weight=16,
         subsample=.85, colsample_bytree=.75, reg_alpha=.25, reg_lambda=4.0, gamma=.04),
]


def proxy_risk(a):
    w, g, wave, swell, _ = np.asarray(a).T
    score = np.maximum(w, 0)*.45 + np.maximum(g, 0)*.20 + np.maximum(wave, 0)*5 + np.maximum(swell, 0)*3
    return np.select([score >= 34, score >= 24, score >= 14], [3, 2, 1], default=0).astype(int)


def evaluate(y, point, conservative):
    yr = proxy_risk(y)
    pr = proxy_risk(point)
    cr = proxy_risk(conservative)
    mae = np.mean(np.abs(y-point), axis=0)
    r2 = [float(r2_score(y[:, j], point[:, j])) if np.std(y[:, j]) > 1e-12 else 0.0 for j in range(len(TARGETS))]
    critical = yr >= 2
    return {
        "point_policy_accuracy": float(accuracy_score(yr, pr)),
        "point_critical_recall": float(recall_score(critical, pr >= 2, zero_division=0)),
        "conservative_policy_accuracy": float(accuracy_score(yr, cr)),
        "conservative_critical_recall": float(recall_score(critical, cr >= 2, zero_division=0)),
        "mean_mae": float(np.mean(mae)),
        "mean_r2": float(np.mean(r2)),
    }


def fit_ensemble(X, Y, params, seed, members=3):
    X = X.replace([np.inf, -np.inf], np.nan)
    med = X.median(numeric_only=True)
    Xf = X.fillna(med).fillna(0.0)
    models = []
    for member in range(members):
        rng = np.random.default_rng(seed + member * 9973)
        idx = rng.integers(0, len(Xf), size=len(Xf))
        model_set = []
        for j in range(len(TARGETS)):
            model = xgb.XGBRegressor(
                objective="reg:squarederror", tree_method="hist", random_state=seed + member,
                n_jobs=-1, **params,
            )
            model.fit(Xf.iloc[idx], Y[idx, j], verbose=False)
            model_set.append(model)
        models.append(model_set)
    return models, med


def predict_ensemble(models, X, med):
    Xf = X.replace([np.inf, -np.inf], np.nan).fillna(med).fillna(0.0)
    member_preds = []
    for model_set in models:
        member_preds.append(np.column_stack([m.predict(Xf) for m in model_set]))
    arr = np.stack(member_preds, axis=0)
    return arr.mean(axis=0), arr.std(axis=0)


def calibration_quantiles(models, X_cal, Y_cal, med):
    """Target-wise split-conformal absolute residual quantiles."""
    point, _ = predict_ensemble(models, X_cal, med)
    residual = np.abs(Y_cal - point)
    q = []
    n = len(residual)
    # Finite-sample conformal quantile: ceil((n+1)*confidence)/n.
    rank = int(np.ceil((n + 1) * CONFIDENCE))
    level = min(1.0, max(0.0, rank / max(n, 1)))
    for j in range(residual.shape[1]):
        q.append(float(np.quantile(residual[:, j], level, method="higher")))
    return np.asarray(q), point


def conservative(point, q, spread, k=0.50):
    """Upper envelope; ensemble spread contributes a bounded uncertainty term."""
    return np.maximum(point, 0.0) + q[None, :] + k * spread


def temporal_split(q):
    years = pd.to_datetime(q["timestamp"], utc=True).dt.year
    tr = years <= 2024
    te = years >= 2025
    return tr.to_numpy(), te.to_numpy()


def fit_calibrated_models(q, X, Y, train_mask, params, seed):
    train_idx = np.flatnonzero(train_mask)
    if len(train_idx) < 20:
        raise ValueError("Insufficient training rows for uncertainty calibration")
    cut = max(10, int(len(train_idx) * (1.0 - CALIBRATION_FRACTION)))
    fit_idx, cal_idx = train_idx[:cut], train_idx[cut:]
    models, med = fit_ensemble(X.iloc[fit_idx], Y[fit_idx], params, seed)
    qhat, _ = calibration_quantiles(models, X.iloc[cal_idx], Y[cal_idx], med)
    return models, med, qhat, fit_idx, cal_idx


def location_trial(q, X, Y, loc, hold, params, seed):
    train = (q[loc] != hold).to_numpy()
    test = ~train
    models, med, qhat, _, _ = fit_calibrated_models(q, X, Y, train, params, seed)
    rows = []
    for scenario in SCENARIOS:
        Xs = degrade(X.loc[test], scenario, stable_seed(scenario, seed))
        point, spread = predict_ensemble(models, Xs, med)
        cons = conservative(point, qhat, spread)
        e = evaluate(Y[test], point, cons)
        e.update(location=hold, scenario=scenario)
        rows.append(e)
    return rows


def summarize(rows):
    clean = [r for r in rows if r["scenario"] == "clean"]
    clean_point = float(np.mean([r["point_policy_accuracy"] for r in clean]))
    out = []
    for s in SCENARIOS:
        rs = [r for r in rows if r["scenario"] == s]
        out.append({
            "scenario": s,
            "point_policy_accuracy": float(np.mean([r["point_policy_accuracy"] for r in rs])),
            "point_critical_recall": float(np.mean([r["point_critical_recall"] for r in rs])),
            "conservative_policy_accuracy": float(np.mean([r["conservative_policy_accuracy"] for r in rs])),
            "conservative_critical_recall": float(np.mean([r["conservative_critical_recall"] for r in rs])),
            "mean_mae": float(np.mean([r["mean_mae"] for r in rs])),
            "mean_r2": float(np.mean([r["mean_r2"] for r in rs])),
            "point_accuracy_drop_vs_clean": clean_point - float(np.mean([r["point_policy_accuracy"] for r in rs])),
        })
    return out


def temporal_audit(q, X, Y, params, seed):
    tr, te = temporal_split(q)
    models, med, qhat, _, _ = fit_calibrated_models(q, X, Y, tr, params, seed)
    point, spread = predict_ensemble(models, X.iloc[np.flatnonzero(te)], med)
    cons = conservative(point, qhat, spread)
    e = evaluate(Y[te], point, cons)
    e.update(rows=int(te.sum()), calibration_confidence=CONFIDENCE, quantiles=qhat.tolist())
    return e


def main():
    print("="*78)
    print("ORCA-X UNCERTAINTY-AWARE CONTINUOUS FORECASTING — REFINEMENT 26")
    print("="*78)
    print("Read-only benchmark | no production artifacts modified")
    print(f"Source dataset: {DATA}")
    print(f"Forward horizon: +{HORIZON}h | policy: {POLICY_VERSION}")
    print("Contract: observed state at t + historical observations before t -> physical state at t+6h")
    print(f"Uncertainty: {int(CONFIDENCE*100)}% split-conformal residual envelope + ensemble spread")

    if not DATA.exists():
        raise FileNotFoundError(f"Canonical processed dataset not found: {DATA}")
    df = pd.read_parquet(DATA).copy()
    source_rows = len(df)
    loc = find_location_col(df)
    required = ["timestamp", *BASE_FEATURES, *TARGETS]
    missing = [c for c in required if c not in df.columns]
    if missing:
        raise ValueError(f"Dataset missing required fields: {missing}")
    df["timestamp"] = pd.to_datetime(df["timestamp"], utc=True, errors="coerce")
    df[loc] = df[loc].astype(str)
    for c in BASE_FEATURES + TARGETS:
        df[c] = pd.to_numeric(df[c], errors="coerce")
    df = df.dropna(subset=[loc, "timestamp"]).sort_values([loc, "timestamp"]).reset_index(drop=True)
    q = make_pairs(df, loc)
    Y = q[[f"future_{c}" for c in TARGETS]].to_numpy(float)
    X = build_feature_matrix(q, loc)
    locations = sorted(q[loc].unique().tolist())
    print(f"Rows source: {source_rows:,} | exact +6h pairs: {len(q):,}")
    print(f"Locations: {len(locations)} | Engineered features: {X.shape[1]}")
    print(f"Selection: leave-one-location-out; {DIGHA} excluded from trial selection")

    selectable = [x for x in locations if x != DIGHA]
    trial_summaries = []
    all_trial_rows = {}
    for ti, params in enumerate(TRIALS, 1):
        rows = []
        for hold in selectable:
            rows.extend(location_trial(q, X, Y, loc, hold, params, stable_seed(f"trial-{ti}-{hold}")))
        clean = [r for r in rows if r["scenario"] == "clean"]
        stress = [r for r in rows if r["scenario"] != "clean"]
        point_acc = float(np.mean([r["point_policy_accuracy"] for r in clean]))
        point_crit = float(np.mean([r["point_critical_recall"] for r in clean]))
        stress_acc = float(np.mean([r["point_policy_accuracy"] for r in stress]))
        stress_crit = float(np.mean([r["conservative_critical_recall"] for r in stress]))
        objective = .35*point_acc + .25*point_crit + .15*stress_acc + .25*stress_crit
        trial_summaries.append({"trial": ti, "objective": objective, "point_clean_accuracy": point_acc, "point_clean_critical_recall": point_crit, "point_stress_accuracy": stress_acc, "conservative_stress_critical_recall": stress_crit})
        all_trial_rows[ti] = rows
        print(f"[{ti:02d}/{len(TRIALS)}] objective={objective:.5f} clean_acc={point_acc:.5f} stress_acc={stress_acc:.5f} conservative_stress_critical={stress_crit:.5f}")

    best = max(trial_summaries, key=lambda r: r["objective"])
    best_params = TRIALS[best["trial"]-1]
    best_rows = all_trial_rows[best["trial"]]
    scenario_summary = summarize(best_rows)
    temporal = temporal_audit(q, X, Y, best_params, stable_seed("temporal-best"))

    # Final Digha audit is completely excluded from selection.
    digha_rows = location_trial(q, X, Y, loc, DIGHA, best_params, stable_seed("digha-final"))
    digha_clean = next(r for r in digha_rows if r["scenario"] == "clean")
    digha_stress = [r for r in digha_rows if r["scenario"] != "clean"]
    digha = {
        "clean": digha_clean,
        "stress_mean_policy_accuracy": float(np.mean([r["conservative_policy_accuracy"] for r in digha_stress])),
        "stress_mean_critical_recall": float(np.mean([r["conservative_critical_recall"] for r in digha_stress])),
    }

    OUT.mkdir(parents=True, exist_ok=True)
    results = {
        "best_trial": best["trial"],
        "selection_objective": best["objective"],
        "trial_summaries": trial_summaries,
        "uncertainty": {"confidence": CONFIDENCE, "calibration_fraction": CALIBRATION_FRACTION, "ensemble_members": 3},
        "source_rows": source_rows,
        "paired_rows": len(q),
        "locations": locations,
        "engineered_features": int(X.shape[1]),
        "scenario_summary": scenario_summary,
        "temporal": temporal,
        "digha_final_audit": digha,
        "strict_point_in_time": True,
    }
    (OUT / "refinement26_results.json").write_text(json.dumps(results, indent=2), encoding="utf-8")
    pd.DataFrame(best_rows).to_csv(OUT / "uncertainty_by_location_scenario.csv", index=False)
    pd.DataFrame(scenario_summary).to_csv(OUT / "uncertainty_by_scenario.csv", index=False)
    (OUT / "uncertainty_aware_config.json").write_text(json.dumps({"best_trial": best["trial"], "params": best_params, "confidence": CONFIDENCE, "calibration_fraction": CALIBRATION_FRACTION, "ensemble_members": 3, "horizon_hours": HORIZON, "policy_version": POLICY_VERSION}, indent=2), encoding="utf-8")

    print("="*78)
    print("REFINEMENT 26 COMPLETE")
    print("="*78)
    print(json.dumps({
        "best_trial": best["trial"],
        "selection_objective": best["objective"],
        "temporal": temporal,
        "digha_clean": digha_clean,
        "digha_stress_mean_policy_accuracy": digha["stress_mean_policy_accuracy"],
        "digha_stress_mean_critical_recall": digha["stress_mean_critical_recall"],
        "strict_point_in_time": True,
    }, indent=2))
    print(f"Saved: {OUT / 'refinement26_results.json'}")
    print(f"Saved: {OUT / 'uncertainty_aware_config.json'}")
    print("Production model, risk policy, thresholds, and source dataset were NOT modified.")


if __name__ == "__main__":
    main()
