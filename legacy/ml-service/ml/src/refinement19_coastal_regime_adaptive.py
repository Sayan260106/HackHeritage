"""ORCA-X Refinement 19: coastal-regime-adaptive physical forecasting benchmark.

Read-only benchmark. Exact +6h physical targets are used; future values,
stored risk labels, location identifiers, and coordinates are excluded from
features. Digha is reserved for the final audit.
"""
from __future__ import annotations

import json
import os
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.metrics import accuracy_score, mean_absolute_error, mean_squared_error, r2_score, recall_score
from xgboost import XGBRegressor

from config import PROCESSED_DIR, RISK_HORIZON_HOURS

ROOT = Path(__file__).resolve().parents[2]
DATA = PROCESSED_DIR / "orca_historical_marine_risk.parquet"
OUT = ROOT / "ml" / "models" / "refinement19"
HORIZON = int(RISK_HORIZON_HOURS)
TARGETS = ["wind_speed_kts", "wind_gust_kts", "wave_height_m", "swell_height_m", "wave_period_s"]
DIGHA = "digha_wb"
SEED = 42


def find_location_col(df):
    for c in ("location", "station", "location_id", "coastline"):
        if c in df.columns:
            return c
    raise ValueError("No location column found")


def add_regime(df):
    wind = pd.to_numeric(df["wind_speed_kts"], errors="coerce").fillna(0).clip(lower=0)
    gust = pd.to_numeric(df["wind_gust_kts"], errors="coerce").fillna(wind).clip(lower=0)
    wave = pd.to_numeric(df["wave_height_m"], errors="coerce").fillna(0).clip(lower=0)
    swell = pd.to_numeric(df["swell_height_m"], errors="coerce").fillna(0).clip(lower=0)
    sea = wave + swell
    ratio = (wind + 0.35 * np.maximum(gust - wind, 0)) / (4 * sea + 1e-6)
    r = pd.Series("mixed", index=df.index, dtype="object")
    r.loc[(ratio >= 1.25) & (wind >= 12)] = "wind_dominant"
    r.loc[(ratio <= 0.65) & (sea >= 1.2)] = "sea_dominant"
    r.loc[(wind < 8) & (sea < 1)] = "calm"
    return r


def make_features(df, loc):
    excluded = set(
        TARGETS
        + [
            "risk_class", "risk_label", "stored_risk_label", "location_id",
            "timestamp", "latitude", "longitude", "lat", "lon",
            "station_id", loc,
        ]
    )
    cols = [c for c in df.columns if c not in excluded and pd.api.types.is_numeric_dtype(df[c])]
    if not cols:
        raise ValueError("No numeric prediction features remain after leakage exclusions")
    x = df[cols].replace([np.inf, -np.inf], np.nan)
    return x.fillna(x.median(numeric_only=True)).fillna(0)


def make_pairs(df, loc):
    x = df.copy()
    x["timestamp"] = pd.to_datetime(x["timestamp"], utc=True, errors="coerce")
    x = x.dropna(subset=[loc, "timestamp"]).sort_values([loc, "timestamp"]).reset_index(drop=True)
    future = x[[loc, "timestamp"] + TARGETS].copy()
    future["timestamp"] -= pd.to_timedelta(HORIZON, unit="h")
    future = future.rename(columns={c: "future_" + c for c in TARGETS})
    return (
        x.merge(future, on=[loc, "timestamp"], how="inner", validate="one_to_one")
        .dropna(subset=["future_" + c for c in TARGETS])
        .reset_index(drop=True)
    )


def fit_predict(xtr, ytr, xte, p):
    out = np.zeros((len(xte), 5))
    for j in range(5):
        m = XGBRegressor(
            objective="reg:squarederror", tree_method="hist",
            n_estimators=p["n_estimators"], learning_rate=p["learning_rate"],
            max_depth=p["max_depth"], min_child_weight=p["min_child_weight"],
            subsample=p["subsample"], colsample_bytree=p["colsample_bytree"],
            reg_alpha=p["reg_alpha"], reg_lambda=p["reg_lambda"], gamma=p["gamma"],
            random_state=SEED, n_jobs=max(1, min(8, os.cpu_count() or 2)),
        )
        m.fit(xtr, ytr[:, j])
        out[:, j] = m.predict(xte)
    return out


def continuous(y, p):
    mae = [mean_absolute_error(y[:, j], p[:, j]) for j in range(5)]
    rmse = [mean_squared_error(y[:, j], p[:, j]) ** 0.5 for j in range(5)]
    r2 = [r2_score(y[:, j], p[:, j]) for j in range(5)]
    return {
        "mean_mae": float(np.mean(mae)), "mean_rmse": float(np.mean(rmse)),
        "mean_r2": float(np.mean(r2)),
        "target_mae": dict(zip(TARGETS, map(float, mae))),
        "target_r2": dict(zip(TARGETS, map(float, r2))),
    }


def risk_proxy(a):
    w, g, wv, sw, _ = a.T
    s = np.maximum(w, 0) * 0.45 + np.maximum(g, 0) * 0.20 + np.maximum(wv, 0) * 5 + np.maximum(sw, 0) * 3
    return np.select([s >= 34, s >= 24, s >= 14], [3, 2, 1], default=0).astype(int)


def evaluate(y, p):
    m = continuous(y, p)
    yr, pr = risk_proxy(y), risk_proxy(p)
    m["policy_proxy_accuracy"] = float(accuracy_score(yr, pr))
    m["critical_proxy_recall"] = float(recall_score(yr >= 2, pr >= 2, zero_division=0))
    return m


def replace_regime_predictions(pred, q, base_mask, regime_series, X, Y, p):
    """Replace only the rows of the supplied test mask with regime models.

    The previous implementation used global q positions with a prediction
    array whose length was only base_mask.sum(), causing IndexError whenever
    the held-out rows did not start at index 0. This helper converts regime
    positions into positions inside the prediction array explicitly.
    """
    base_positions = np.flatnonzero(base_mask.to_numpy())
    for rg in q.loc[base_mask, "regime"].unique():
        trr = (~base_mask) & (regime_series == rg)
        ter = base_mask & (regime_series == rg)
        if trr.sum() >= 1500 and ter.sum() > 0:
            test_positions = np.flatnonzero(ter.to_numpy())
            local_positions = np.searchsorted(base_positions, test_positions)
            pred[local_positions] = fit_predict(X.loc[trr], Y[trr.to_numpy()], X.loc[ter], p)
    return pred


def main():
    print("=" * 78)
    print("ORCA-X COASTAL REGIME-ADAPTIVE FORECASTING — REFINEMENT 19")
    print("=" * 78)
    print("Read-only benchmark | no production artifacts modified")
    print(f"Source dataset: {DATA}")
    if not DATA.exists():
        raise FileNotFoundError(
            f"Processed dataset not found: {DATA}. This is the canonical dataset path used by Refinements 11 and 18."
        )

    df = pd.read_parquet(DATA)
    loc = find_location_col(df)
    q = make_pairs(df, loc)
    q["regime"] = add_regime(q)
    X = make_features(q, loc)
    Y = q[["future_" + c for c in TARGETS]].to_numpy(float)
    locations = sorted(q[loc].astype(str).unique())

    print(f"Rows source: {len(df):,} | exact +{HORIZON}h pairs: {len(q):,}")
    print(f"Locations: {len(locations)} | Features: {X.shape[1]} | Regimes: {q['regime'].value_counts().to_dict()}")

    trials = [
        {"n_estimators": 800, "learning_rate": 0.04, "max_depth": 4, "min_child_weight": 8, "subsample": 0.85, "colsample_bytree": 0.85, "reg_alpha": 0.1, "reg_lambda": 2.5, "gamma": 0},
        {"n_estimators": 1000, "learning_rate": 0.03, "max_depth": 5, "min_child_weight": 10, "subsample": 0.8, "colsample_bytree": 0.8, "reg_alpha": 0.15, "reg_lambda": 3.5, "gamma": 0.03},
        {"n_estimators": 900, "learning_rate": 0.035, "max_depth": 6, "min_child_weight": 12, "subsample": 0.8, "colsample_bytree": 0.8, "reg_alpha": 0.2, "reg_lambda": 4, "gamma": 0.05},
    ]
    candidates = []
    for ti, p in enumerate(trials, 1):
        folds = []
        for hold in [z for z in locations if z != DIGHA]:
            tr = q[loc].astype(str) != hold
            te = ~tr
            pred = fit_predict(X.loc[tr], Y[tr.to_numpy()], X.loc[te], p)
            pred = replace_regime_predictions(pred, q, te, q["regime"], X, Y, p)
            m = evaluate(Y[te.to_numpy()], pred)
            m["location"] = hold
            folds.append(m)
        acc = float(np.mean([f["policy_proxy_accuracy"] for f in folds]))
        cr = float(np.mean([f["critical_proxy_recall"] for f in folds]))
        r2 = float(np.mean([f["mean_r2"] for f in folds]))
        obj = 0.45 * acc + 0.35 * cr + 0.20 * ((r2 + 1) / 2)
        candidates.append({"trial": ti, "params": p, "objective": obj, "mean_policy_proxy_accuracy": acc, "mean_critical_proxy_recall": cr, "mean_r2": r2, "folds": folds})
        print(f"[{ti:02d}/{len(trials)}] objective={obj:.5f} policy_proxy_acc={acc:.5f} critical_recall={cr:.5f} mean_R2={r2:.5f}")

    best = max(candidates, key=lambda z: z["objective"])
    p = best["params"]
    tri, tei = [], []
    for z in locations:
        ids = q.index[q[loc].astype(str) == z].to_numpy()
        ids = ids[np.argsort(pd.to_datetime(q.loc[ids, "timestamp"]).to_numpy())]
        cut = int(0.7 * len(ids))
        tri.extend(ids[:cut])
        tei.extend(ids[cut:])
    tp = fit_predict(X.loc[tri], Y[tri], X.loc[tei], p)
    temporal = evaluate(Y[tei], tp)

    tr = q[loc].astype(str) != DIGHA
    te = q[loc].astype(str) == DIGHA
    dp = fit_predict(X.loc[tr], Y[tr.to_numpy()], X.loc[te], p)
    dp = replace_regime_predictions(dp, q, te, q["regime"], X, Y, p)
    digha = evaluate(Y[te.to_numpy()], dp)

    result = {
        "best": best, "temporal": temporal, "digha_final_audit": digha,
        "regime_counts": q["regime"].value_counts().to_dict(),
        "contract": {"horizon_hours": HORIZON, "location_excluded": True, "coordinates_excluded": True, "future_features_excluded": True, "stored_risk_label_excluded": True, "proxy_risk_metrics": True},
    }
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "refinement19_results.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
    (OUT / "best_regime_adaptive_config.json").write_text(json.dumps(best, indent=2), encoding="utf-8")
    print("=" * 78)
    print("REFINEMENT 19 COMPLETE")
    print("=" * 78)
    print(json.dumps({"mean_policy_proxy_accuracy": best["mean_policy_proxy_accuracy"], "mean_critical_proxy_recall": best["mean_critical_proxy_recall"], "mean_r2": best["mean_r2"], "temporal": temporal, "digha_final_audit": digha}, indent=2))
    print(f"Saved: {OUT / 'refinement19_results.json'}")
    print(f"Saved: {OUT / 'best_regime_adaptive_config.json'}")
    print("Production model, risk policy, thresholds, and source dataset were NOT modified.")


if __name__ == "__main__":
    main()
