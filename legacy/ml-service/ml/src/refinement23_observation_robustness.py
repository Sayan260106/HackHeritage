"""ORCA-X Refinement 23: point-in-time observation robustness benchmark.

This is a read-only benchmark. It uses the Refinement-22 point-in-time
contract: observations available at time t predict physical state at t+6h.
It deliberately does not use future-derived fields, stored risk labels,
coordinates, or production artifacts.

Stress scenarios:
  clean, random_missing_10/25/40, wind_outage, sea_state_outage,
  atmospheric_outage, stale_wind, stale_sea_state, mixed_degradation.

Missing values are imputed with medians fitted on the training partition only.
Stale feeds use an earlier observation from the same location. Digha is excluded
from leave-one-coast-out model selection and is evaluated only as a final audit.
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
OUT = ROOT / "ml" / "models" / "refinement23"
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
TARGETS = [
    "wind_speed_kts", "wind_gust_kts", "wave_height_m",
    "swell_height_m", "wave_period_s",
]
WIND = ["wind_speed_kts", "wind_gust_kts", "wind_direction_deg"]
SEA = [
    "wave_height_m", "wave_period_s", "wave_direction_deg",
    "swell_height_m", "swell_period_s", "swell_direction_deg",
]
ATMOS = ["air_pressure_hpa", "air_temperature_c", "precipitation_mm"]
SCENARIOS = [
    "clean", "random_missing_10", "random_missing_25", "random_missing_40",
    "wind_outage", "sea_state_outage", "atmospheric_outage",
    "stale_wind", "stale_sea_state", "mixed_degradation",
]
TRIALS = [
    dict(n_estimators=700, learning_rate=0.04, max_depth=5, min_child_weight=10,
         subsample=0.80, colsample_bytree=0.80, reg_alpha=0.15, reg_lambda=2.0, gamma=0.0),
    dict(n_estimators=900, learning_rate=0.035, max_depth=6, min_child_weight=10,
         subsample=0.80, colsample_bytree=0.80, reg_alpha=0.15, reg_lambda=3.0, gamma=0.03),
]


def find_location_col(df: pd.DataFrame) -> str:
    for c in ("location", "station", "coastline", "location_id"):
        if c in df.columns:
            return c
    raise ValueError("No location column found")


def stable_seed(name: str, extra: int = 0) -> int:
    digest = hashlib.sha256(name.encode("utf-8")).hexdigest()
    return SEED + extra + int(digest[:8], 16) % 100000


def load_pairs() -> tuple[pd.DataFrame, str, int]:
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
    if q.duplicated([loc, "timestamp"]).any():
        raise ValueError("Duplicate location/timestamp prediction rows detected")
    return q, loc, source_rows


def proxy_risk(a: np.ndarray) -> np.ndarray:
    w, g, wave, swell, _ = a.T
    score = np.maximum(w, 0) * 0.45 + np.maximum(g, 0) * 0.20
    score += np.maximum(wave, 0) * 5 + np.maximum(swell, 0) * 3
    return np.select([score >= 34, score >= 24, score >= 14], [3, 2, 1], default=0).astype(int)


def evaluate(y: np.ndarray, p: np.ndarray) -> dict:
    yr, pr = proxy_risk(y), proxy_risk(p)
    mae = np.mean(np.abs(y - p), axis=0)
    r2 = [float(r2_score(y[:, j], p[:, j])) if np.std(y[:, j]) > 1e-12 else 0.0
          for j in range(len(TARGETS))]
    return {
        "policy_proxy_accuracy": float(accuracy_score(yr, pr)),
        "critical_proxy_recall": float(recall_score(yr >= 2, pr >= 2, zero_division=0)),
        "mean_mae": float(np.mean(mae)),
        "mean_r2": float(np.mean(r2)),
        "target_mae": dict(zip(TARGETS, map(float, mae))),
        "target_r2": dict(zip(TARGETS, r2)),
    }


def make_scenario(q: pd.DataFrame, loc: str, scenario: str, seed: int) -> pd.DataFrame:
    out = q[FEATURES].copy()
    if scenario == "clean":
        return out
    if scenario.startswith("random_missing_"):
        rate = int(scenario.rsplit("_", 1)[1]) / 100.0
        rng = np.random.default_rng(seed)
        return out.mask(rng.random(out.shape) < rate)
    if scenario == "wind_outage":
        out[WIND] = np.nan
        return out
    if scenario == "sea_state_outage":
        out[SEA] = np.nan
        return out
    if scenario == "atmospheric_outage":
        out[ATMOS] = np.nan
        return out

    if scenario in {"stale_wind", "stale_sea_state", "mixed_degradation"}:
        stale_cols = WIND if scenario == "stale_wind" else SEA
        # Shift earlier observations forward onto the later prediction time.
        # Thus the value assigned at t is from t-STALE_HOURS, never from t+.
        lag = q[[loc, "timestamp", *stale_cols]].copy()
        lag["timestamp"] = lag["timestamp"] + pd.to_timedelta(STALE_HOURS, unit="h")
        lag = lag.rename(columns={c: f"stale_{c}" for c in stale_cols})
        joined = q[[loc, "timestamp"]].merge(
            lag, on=[loc, "timestamp"], how="left", validate="one_to_one"
        )
        for c in stale_cols:
            out[c] = joined[f"stale_{c}"].to_numpy()
        if scenario == "mixed_degradation":
            remaining = [c for c in FEATURES if c not in stale_cols]
            rng = np.random.default_rng(seed)
            out.loc[:, remaining] = out[remaining].mask(
                rng.random((len(out), len(remaining))) < 0.25
            )
        return out
    raise ValueError(f"Unknown scenario: {scenario}")


def fit_models(Xtr: pd.DataFrame, Ytr: np.ndarray, params: dict) -> tuple[list, pd.Series]:
    Xtr = Xtr.replace([np.inf, -np.inf], np.nan).copy()
    medians = Xtr.median(numeric_only=True)
    Xfit = Xtr.fillna(medians).fillna(0.0)
    models = []
    for j, target in enumerate(TARGETS):
        y = Ytr[:, j]
        keep = np.isfinite(y)
        m = xgb.XGBRegressor(
            objective="reg:squarederror", tree_method="hist", random_state=SEED,
            n_jobs=-1, **params,
        )
        m.fit(Xfit.loc[keep], y[keep], verbose=False)
        models.append(m)
    return models, medians


def predict_models(models: list, X: pd.DataFrame, medians: pd.Series) -> np.ndarray:
    Xp = X.replace([np.inf, -np.inf], np.nan).copy()
    Xp = Xp.fillna(medians).fillna(0.0)
    return np.column_stack([m.predict(Xp) for m in models])


def evaluate_split(q: pd.DataFrame, Y: np.ndarray, loc: str, tr: np.ndarray,
                   te: np.ndarray, params: dict) -> tuple[dict, list[dict]]:
    models, medians = fit_models(q.loc[tr, FEATURES], Y[tr], params)
    clean_pred = predict_models(models, q.loc[te, FEATURES], medians)
    clean = evaluate(Y[te], clean_pred)
    stress = []
    for scenario in SCENARIOS[1:]:
        test_X = make_scenario(q.loc[te], loc, scenario, stable_seed(scenario))
        pred = predict_models(models, test_X, medians)
        stress.append({"scenario": scenario, **evaluate(Y[te], pred)})
    return clean, stress


def temporal_split(q: pd.DataFrame, loc: str) -> tuple[np.ndarray, np.ndarray]:
    base = q[q[loc] != DIGHA]
    times = np.sort(base["timestamp"].unique())
    cut = times[int(0.82 * len(times))]
    return (
        ((q[loc] != DIGHA) & (q["timestamp"] < cut)).to_numpy(),
        ((q[loc] != DIGHA) & (q["timestamp"] >= cut)).to_numpy(),
    )


def run_scenarios(q: pd.DataFrame, Y: np.ndarray, loc: str,
                  tr: np.ndarray, te: np.ndarray, params: dict,
                  seed_offset: int) -> list[dict]:
    models, medians = fit_models(q.loc[tr, FEATURES], Y[tr], params)
    rows = []
    for scenario in SCENARIOS:
        test_X = make_scenario(q.loc[te], loc, scenario,
                               stable_seed(scenario, seed_offset))
        pred = predict_models(models, test_X, medians)
        rows.append({"scenario": scenario, **evaluate(Y[te], pred)})
    return rows


def main() -> None:
    print("=" * 78)
    print("ORCA-X POINT-IN-TIME OBSERVATION ROBUSTNESS BENCHMARK — REFINEMENT 23")
    print("=" * 78)
    print("Read-only benchmark | no production artifacts modified")
    print(f"Source dataset: {DATA}")
    print(f"Forward horizon: +{HORIZON}h | policy: {POLICY_VERSION}")
    print("Contract: observed state at t -> physical state at t+6h")
    print("Stress testing missing, outage, and stale observations without future leakage.")

    q, loc, source_rows = load_pairs()
    Y = q[[f"future_{c}" for c in TARGETS]].to_numpy(float)
    locations = sorted(q[loc].unique())
    selectable = [z for z in locations if z != DIGHA]
    print(f"Rows source: {source_rows:,} | exact +{HORIZON}h pairs: {len(q):,}")
    print(f"Locations: {len(locations)} | Features: {len(FEATURES)}")
    print(f"Scenarios: {SCENARIOS}")

    trials = []
    for ti, params in enumerate(TRIALS, 1):
        clean_folds, stress_folds = [], []
        for hold in selectable:
            tr = (q[loc] != hold).to_numpy()
            te = (q[loc] == hold).to_numpy()
            clean, stress = evaluate_split(q, Y, loc, tr, te, params)
            clean_folds.append({"location": hold, **clean})
            stress_folds.extend({"location": hold, **s} for s in stress)
        clean_acc = float(np.mean([x["policy_proxy_accuracy"] for x in clean_folds]))
        clean_critical = float(np.mean([x["critical_proxy_recall"] for x in clean_folds]))
        stress_acc = float(np.mean([x["policy_proxy_accuracy"] for x in stress_folds]))
        stress_critical = float(np.mean([x["critical_proxy_recall"] for x in stress_folds]))
        objective = 0.35 * clean_acc + 0.25 * clean_critical + 0.15 * stress_acc + 0.25 * stress_critical
        row = {
            "trial": ti, "params": params, "objective": objective,
            "clean_mean_policy_proxy_accuracy": clean_acc,
            "clean_mean_critical_proxy_recall": clean_critical,
            "stress_mean_policy_proxy_accuracy": stress_acc,
            "stress_mean_critical_proxy_recall": stress_critical,
            "clean_folds": clean_folds, "stress_folds": stress_folds,
        }
        trials.append(row)
        print(f"[{ti:02d}/{len(TRIALS)}] objective={objective:.5f} clean_acc={clean_acc:.5f} stress_acc={stress_acc:.5f} stress_critical={stress_critical:.5f}")

    best = max(trials, key=lambda x: x["objective"])
    params = best["params"]
    tr_t, te_t = temporal_split(q, loc)
    temporal = run_scenarios(q, Y, loc, tr_t, te_t, params, 1000)

    digha_tr = (q[loc] != DIGHA).to_numpy()
    digha_te = (q[loc] == DIGHA).to_numpy()
    digha = run_scenarios(q, Y, loc, digha_tr, digha_te, params, 2000)

    rows = []
    clean_ref = best["clean_mean_policy_proxy_accuracy"]
    critical_ref = best["clean_mean_critical_proxy_recall"]
    for scenario in SCENARIOS[1:]:
        vals = [x for x in best["stress_folds"] if x["scenario"] == scenario]
        rows.append({
            "scenario": scenario,
            "mean_policy_proxy_accuracy": float(np.mean([x["policy_proxy_accuracy"] for x in vals])),
            "mean_critical_proxy_recall": float(np.mean([x["critical_proxy_recall"] for x in vals])),
            "mean_mae": float(np.mean([x["mean_mae"] for x in vals])),
            "mean_r2": float(np.mean([x["mean_r2"] for x in vals])),
            "accuracy_drop_vs_clean": clean_ref - float(np.mean([x["policy_proxy_accuracy"] for x in vals])),
            "critical_recall_drop_vs_clean": critical_ref - float(np.mean([x["critical_proxy_recall"] for x in vals])),
        })
    scenario_df = pd.DataFrame(rows)
    feature_df = pd.DataFrame([
        {"feature": c,
         "group": "wind" if c in WIND else "sea_state" if c in SEA else "atmospheric" if c in ATMOS else "calendar",
         "approved_point_in_time": True,
         "stress_tested": c in (WIND + SEA + ATMOS)}
        for c in FEATURES
    ])

    contract = {
        "strict_point_in_time": True,
        "approved_features": FEATURES,
        "future_target_columns_used_as_features": False,
        "stored_risk_label_used": False,
        "coordinates_used": False,
        "median_imputation_fit_on_training_partition_only": True,
        "stale_hours": STALE_HOURS,
        "stale_values_from_prior_same_location_observations": True,
        "stable_random_seed": SEED,
        "production_artifacts_modified": False,
    }
    OUT.mkdir(parents=True, exist_ok=True)
    scenario_df.to_csv(OUT / "robustness_by_scenario.csv", index=False)
    feature_df.to_csv(OUT / "robustness_by_feature.csv", index=False)
    (OUT / "observation_robustness_config.json").write_text(json.dumps({
        "refinement": 23, "horizon_hours": HORIZON, "policy": POLICY_VERSION,
        "features": FEATURES, "targets": TARGETS, "scenarios": SCENARIOS,
        "stale_hours": STALE_HOURS, "trials": TRIALS, "contract": contract,
    }, indent=2), encoding="utf-8")

    worst = min(rows, key=lambda x: x["mean_policy_proxy_accuracy"])
    report = {
        "refinement": 23, "source_rows": source_rows, "exact_forward_pairs": len(q),
        "locations": locations, "features": FEATURES, "best_trial": best,
        "stress_summary": rows, "temporal": temporal, "digha_final_audit": digha,
        "contract": contract,
        "worst_stress_scenario": worst,
        "interpretation": {
            "clean": "Point-in-time reference with recorded observations.",
            "random_missing": "Independent observation loss with training-only imputation statistics.",
            "outage": "Entire sensor groups unavailable at prediction time.",
            "stale": "Selected feeds are replaced by earlier same-location observations.",
            "mixed": "25% random missingness combined with stale sea-state observations.",
            "selection": "Digha is excluded from selection and retained as final audit only.",
        },
    }
    (OUT / "refinement23_results.json").write_text(json.dumps(report, indent=2), encoding="utf-8")

    print("=" * 78)
    print("REFINEMENT 23 COMPLETE")
    print("=" * 78)
    print(json.dumps({
        "best_trial": best["trial"],
        "clean_policy_accuracy": best["clean_mean_policy_proxy_accuracy"],
        "clean_critical_recall": best["clean_mean_critical_proxy_recall"],
        "stress_policy_accuracy": best["stress_mean_policy_proxy_accuracy"],
        "stress_critical_recall": best["stress_mean_critical_proxy_recall"],
        "worst_scenario": worst,
        "temporal_clean": temporal[0],
        "digha_clean": digha[0],
        "strict_point_in_time": True,
    }, indent=2))
    print(f"Saved: {OUT / 'refinement23_results.json'}")
    print(f"Saved: {OUT / 'observation_robustness_config.json'}")
    print(f"Saved: {OUT / 'robustness_by_scenario.csv'}")
    print(f"Saved: {OUT / 'robustness_by_feature.csv'}")
    print("Production model, risk policy, thresholds, and source dataset were NOT modified.")


if __name__ == "__main__":
    main()
