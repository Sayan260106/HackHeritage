"""ORCA-X Refinement 22: point-in-time feature contract + causal benchmark.

Purpose
-------
Refinement 21 correctly identified the five physical state variables as the
future prediction targets. This refinement does NOT incorrectly ban their
current-time observations. Instead it enforces the forecasting contract:

    feature(t) -> target(t + 6h)

Current observations such as wind_speed_kts(t) and wave_height_m(t) are valid;
future/lead/target-derived columns are forbidden. The script is benchmark-only
and never modifies production artifacts.

Outputs
-------
ml/models/refinement22/
  refinement22_results.json
  point_in_time_feature_contract.json
  feature_contract_audit.csv

The benchmark uses XGBoost, leave-one-coast-out selection with Digha excluded,
and a chronological temporal evaluation. It also performs a strict schema
and provenance audit before training.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

import numpy as np
import pandas as pd
import xgboost as xgb
from sklearn.metrics import accuracy_score, balanced_accuracy_score, f1_score, recall_score, r2_score

from config import PROCESSED_DIR, RISK_HORIZON_HOURS
from label_policy import POLICY_VERSION

ROOT = Path(__file__).resolve().parents[2]
DATA = PROCESSED_DIR / "orca_historical_marine_risk.parquet"
OUT = ROOT / "ml" / "models" / "refinement22"
HORIZON = int(RISK_HORIZON_HOURS)
DIGHA = "digha_wb"
SEED = 42

TARGETS = [
    "wind_speed_kts", "wind_gust_kts", "wave_height_m",
    "swell_height_m", "wave_period_s",
]

# Explicitly approved point-in-time physical observations. These are observed
# at t and are therefore legitimate inputs to a t -> t+6h forecast.
APPROVED_BASE_FEATURES = [
    "wind_speed_kts", "wind_gust_kts", "wind_direction_deg",
    "wave_height_m", "wave_period_s", "wave_direction_deg",
    "swell_height_m", "swell_period_s", "swell_direction_deg",
    "air_pressure_hpa", "air_temperature_c", "sea_surface_temperature_c",
    "precipitation_mm", "month", "season",
]

FORBIDDEN_EXACT = {
    "risk_class", "risk_label", "stored_risk_label", "future_risk_class",
    "future_risk", "reconstructed_forward_risk", "target", "label",
    "location_id", "station_id", "timestamp", "latitude", "longitude",
    "lat", "lon",
}
SUSPICIOUS = re.compile(
    r"(^|[_\-])(future|forecast|target|label|risk|lead|lag|next|tplus|ahead|horizon)([_\-]|$)",
    re.I,
)

TRIALS = [
    dict(n_estimators=700, learning_rate=0.04, max_depth=5, min_child_weight=10, subsample=0.80, colsample_bytree=0.80, reg_alpha=0.15, reg_lambda=2.0, gamma=0.0),
    dict(n_estimators=900, learning_rate=0.035, max_depth=6, min_child_weight=10, subsample=0.80, colsample_bytree=0.80, reg_alpha=0.15, reg_lambda=3.0, gamma=0.03),
    dict(n_estimators=1000, learning_rate=0.03, max_depth=6, min_child_weight=12, subsample=0.75, colsample_bytree=0.75, reg_alpha=0.2, reg_lambda=3.5, gamma=0.05),
]


def find_location_col(df: pd.DataFrame) -> str:
    for c in ("location", "station", "location_id", "coastline"):
        if c in df.columns:
            return c
    raise ValueError("No location column found")


def load_source() -> tuple[pd.DataFrame, str]:
    if not DATA.exists():
        raise FileNotFoundError(f"Canonical processed dataset not found: {DATA}")
    df = pd.read_parquet(DATA).copy()
    loc = find_location_col(df)
    if "timestamp" not in df.columns:
        raise ValueError("timestamp column is required for point-in-time validation")
    missing = [c for c in APPROVED_BASE_FEATURES + TARGETS if c not in df.columns]
    if missing:
        raise ValueError(f"Dataset is missing required physical fields: {missing}")
    df["timestamp"] = pd.to_datetime(df["timestamp"], utc=True, errors="coerce")
    df[loc] = df[loc].astype(str)
    for c in APPROVED_BASE_FEATURES + TARGETS:
        df[c] = pd.to_numeric(df[c], errors="coerce")
    df = df.dropna(subset=[loc, "timestamp"]).sort_values([loc, "timestamp"]).reset_index(drop=True)
    return df, loc


def make_pairs(df: pd.DataFrame, loc: str) -> pd.DataFrame:
    # Shift future rows backwards by exactly HORIZON so the merge key remains
    # the prediction timestamp t. No feature values from t+H are copied into X.
    future = df[[loc, "timestamp"] + TARGETS].copy()
    future["timestamp"] = future["timestamp"] - pd.to_timedelta(HORIZON, unit="h")
    future = future.rename(columns={c: f"future_{c}" for c in TARGETS})
    q = df.merge(future, on=[loc, "timestamp"], how="inner", validate="one_to_one")
    return q.dropna(subset=[f"future_{c}" for c in TARGETS]).reset_index(drop=True)


def audit_schema(df: pd.DataFrame, loc: str) -> tuple[pd.DataFrame, list[str]]:
    rows = []
    for c in df.select_dtypes(include=[np.number]).columns:
        reasons = []
        verdict = "SAFE"
        if c in FORBIDDEN_EXACT or c == loc:
            verdict = "FORBIDDEN"
            reasons.append("identifier/label/time field is not a point-in-time model feature")
        if SUSPICIOUS.search(c.lower()):
            verdict = "FORBIDDEN"
            reasons.append("name indicates future/target/risk-derived information")
        if c in TARGETS:
            # Important: current-time physical observations remain explicitly
            # allowed despite being future targets. Their future counterparts
            # are created only as Y during make_pairs().
            verdict = "APPROVED_CURRENT_OBSERVATION"
            reasons.append("observed at prediction time t; future copy is target-only")
        rows.append({
            "feature": c,
            "dtype": str(df[c].dtype),
            "non_null_fraction": float(df[c].notna().mean()),
            "verdict": verdict,
            "reasons": "; ".join(reasons),
        })
    audit = pd.DataFrame(rows)
    missing_approved = [c for c in APPROVED_BASE_FEATURES if c not in df.columns]
    if missing_approved:
        raise ValueError(f"Approved point-in-time feature contract is incomplete: {missing_approved}")
    return audit, list(APPROVED_BASE_FEATURES)


def assert_no_future_feature_columns(q: pd.DataFrame, features: list[str]) -> None:
    bad = []
    for c in features:
        if c not in q.columns:
            bad.append(c)
            continue
        if c.startswith("future_") or SUSPICIOUS.search(c.lower()):
            bad.append(c)
    if bad:
        raise ValueError(f"Point-in-time contract violation in model features: {bad}")
    if any(c in FORBIDDEN_EXACT for c in features):
        raise ValueError("Forbidden identifier/label field admitted to model features")


def model(params: dict) -> xgb.XGBRegressor:
    return xgb.XGBRegressor(
        objective="reg:squarederror", tree_method="hist", random_state=SEED,
        n_jobs=-1, **params,
    )


def fit_predict(Xtr: pd.DataFrame, Ytr: np.ndarray, Xte: pd.DataFrame, params: dict) -> np.ndarray:
    pred = np.zeros((len(Xte), len(TARGETS)), dtype=float)
    for j in range(len(TARGETS)):
        m = model(params)
        y = Ytr[:, j]
        keep = np.isfinite(y)
        m.fit(Xtr.loc[keep], y[keep], verbose=False)
        pred[:, j] = m.predict(Xte)
    return pred


def proxy_risk(a: np.ndarray) -> np.ndarray:
    w, g, wave, swell, _ = a.T
    score = np.maximum(w, 0) * 0.45 + np.maximum(g, 0) * 0.20 + np.maximum(wave, 0) * 5 + np.maximum(swell, 0) * 3
    return np.select([score >= 34, score >= 24, score >= 14], [3, 2, 1], default=0).astype(int)


def evaluate(y: np.ndarray, p: np.ndarray) -> dict:
    yr, pr = proxy_risk(y), proxy_risk(p)
    critical_y, critical_p = yr >= 2, pr >= 2
    mae = np.mean(np.abs(y - p), axis=0)
    r2 = [r2_score(y[:, j], p[:, j]) for j in range(len(TARGETS))]
    return {
        "policy_proxy_accuracy": float(accuracy_score(yr, pr)),
        "critical_proxy_recall": float(recall_score(critical_y, critical_p, zero_division=0)),
        "mean_mae": float(np.mean(mae)),
        "mean_r2": float(np.mean(r2)),
        "target_mae": dict(zip(TARGETS, map(float, mae))),
        "target_r2": dict(zip(TARGETS, map(float, r2))),
    }


def split_temporal(q: pd.DataFrame, loc: str) -> tuple[np.ndarray, np.ndarray]:
    non_digha = q[q[loc] != DIGHA]
    times = np.sort(non_digha["timestamp"].unique())
    cut = times[int(0.82 * len(times))]
    tr = q[loc].ne(DIGHA) & (q["timestamp"] < cut)
    te = q[loc].ne(DIGHA) & (q["timestamp"] >= cut)
    return tr.to_numpy(), te.to_numpy()


def main() -> None:
    print("=" * 78)
    print("ORCA-X POINT-IN-TIME FEATURE CONTRACT + CAUSAL BENCHMARK — REFINEMENT 22")
    print("=" * 78)
    print("Read-only benchmark | no production artifacts modified")
    print(f"Source dataset: {DATA}")
    print(f"Forward horizon: +{HORIZON}h | policy: {POLICY_VERSION}")
    print("Contract: observed state at t -> physical state at t+6h")
    print("Current physical observations are allowed; future-derived fields are forbidden.")

    df, loc = load_source()
    audit, features = audit_schema(df, loc)
    q = make_pairs(df, loc)
    assert_no_future_feature_columns(q, features)

    # Enforce one row per location/timestamp and verify chronological ordering.
    duplicate_pairs = int(q.duplicated([loc, "timestamp"]).sum())
    if duplicate_pairs:
        raise ValueError(f"Duplicate prediction timestamps detected: {duplicate_pairs}")
    temporal_violations = int((q.groupby(loc)["timestamp"].diff().dropna() < pd.Timedelta(0)).sum())
    if temporal_violations:
        raise ValueError(f"Temporal ordering violations detected: {temporal_violations}")

    X = q[features].replace([np.inf, -np.inf], np.nan)
    X = X.fillna(X.median(numeric_only=True)).fillna(0)
    Y = q[[f"future_{c}" for c in TARGETS]].to_numpy(float)
    locations = sorted(q[loc].unique())

    print(f"Rows source: {len(df):,} | exact +{HORIZON}h pairs: {len(q):,}")
    print(f"Locations: {len(locations)} | Approved point-in-time features: {len(features)}")
    print(f"Approved features: {features}")

    results = []
    selectable = [z for z in locations if z != DIGHA]
    for ti, params in enumerate(TRIALS, 1):
        folds = []
        for hold in selectable:
            tr = q[loc].ne(hold).to_numpy()
            te = q[loc].eq(hold).to_numpy()
            pred = fit_predict(X.loc[tr], Y[tr], X.loc[te], params)
            m = evaluate(Y[te], pred)
            folds.append({"location": hold, **m})
        acc = float(np.mean([f["policy_proxy_accuracy"] for f in folds]))
        critical = float(np.mean([f["critical_proxy_recall"] for f in folds]))
        r2 = float(np.mean([f["mean_r2"] for f in folds]))
        objective = 0.45 * acc + 0.35 * critical + 0.20 * ((r2 + 1) / 2)
        result = {"trial": ti, "params": params, "objective": objective,
                  "mean_policy_proxy_accuracy": acc,
                  "mean_critical_proxy_recall": critical,
                  "mean_r2": r2, "folds": folds}
        results.append(result)
        print(f"[{ti:02d}/{len(TRIALS)}] objective={objective:.5f} policy_acc={acc:.5f} critical_recall={critical:.5f} mean_R2={r2:.5f}")

    best = max(results, key=lambda x: x["objective"])
    p = best["params"]

    tr_t, te_t = split_temporal(q, loc)
    temporal_pred = fit_predict(X.loc[tr_t], Y[tr_t], X.loc[te_t], p)
    temporal = evaluate(Y[te_t], temporal_pred)

    digha_tr = q[loc].ne(DIGHA).to_numpy()
    digha_te = q[loc].eq(DIGHA).to_numpy()
    digha_pred = fit_predict(X.loc[digha_tr], Y[digha_tr], X.loc[digha_te], p)
    digha = evaluate(Y[digha_te], digha_pred)

    approved = audit[audit.feature.isin(features)]
    forbidden_in_features = audit[audit.feature.isin(FORBIDDEN_EXACT) | audit.feature.str.contains(r"future|forecast|target|label|risk|lead|lag|next|tplus|ahead|horizon", case=False, regex=True)]
    contract = {
        "horizon_hours": HORIZON,
        "target_mapping": {c: f"future_{c}" for c in TARGETS},
        "approved_feature_count": len(features),
        "approved_features": features,
        "current_physical_targets_allowed_as_inputs": TARGETS,
        "future_target_columns_used_as_features": False,
        "stored_risk_label_used": False,
        "location_identifier_used": False,
        "coordinates_used": False,
        "duplicate_prediction_timestamps": duplicate_pairs,
        "temporal_ordering_violations": temporal_violations,
        "forbidden_fields_in_model_features": forbidden_in_features.feature.tolist(),
        "strict_contract_pass": len(forbidden_in_features[forbidden_in_features.feature.isin(features)]) == 0 and duplicate_pairs == 0 and temporal_violations == 0,
        "interpretation": "A current observation that is also a future target is valid as X(t); only its shifted future copy is Y(t+6h).",
    }

    OUT.mkdir(parents=True, exist_ok=True)
    audit.to_csv(OUT / "feature_contract_audit.csv", index=False)
    (OUT / "point_in_time_feature_contract.json").write_text(json.dumps(contract, indent=2), encoding="utf-8")
    report = {
        "refinement": 22,
        "contract": contract,
        "rows_source": len(df),
        "exact_forward_pairs": len(q),
        "locations": locations,
        "best": best,
        "temporal": temporal,
        "digha_final_audit": digha,
        "comparison_reference": {
            "refinement_13_mean_macro_f1": 0.6241291910990515,
            "refinement_13_temporal_accuracy": 0.7670081317985004,
            "note": "Reference values are recorded from the project's Refinement 13 run; this refinement uses a causal continuous-state benchmark and therefore is not a direct metric-equivalent replacement."
        },
    }
    (OUT / "refinement22_results.json").write_text(json.dumps(report, indent=2, default=float), encoding="utf-8")

    print("=" * 78)
    print("REFINEMENT 22 COMPLETE")
    print("=" * 78)
    print(json.dumps({
        "strict_contract_pass": contract["strict_contract_pass"],
        "approved_features": len(features),
        "best_objective": best["objective"],
        "mean_policy_proxy_accuracy": best["mean_policy_proxy_accuracy"],
        "mean_critical_proxy_recall": best["mean_critical_proxy_recall"],
        "mean_r2": best["mean_r2"],
        "temporal": temporal,
        "digha_final_audit": digha,
    }, indent=2, default=float))
    print(f"Saved: {OUT / 'refinement22_results.json'}")
    print(f"Saved: {OUT / 'point_in_time_feature_contract.json'}")
    print(f"Saved: {OUT / 'feature_contract_audit.csv'}")
    print("Production model, risk policy, thresholds, and source dataset were NOT modified.")


if __name__ == "__main__":
    main()
