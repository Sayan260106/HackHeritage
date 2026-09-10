"""
ORCA-X REFINEMENT 27 — UNCERTAINTY-AWARE RISK GATE

Read-only benchmark. Uses the point-in-time physical forecast and calibrated
uncertainty to activate conservative safety behavior only when evidence is
weak or the predicted state is near a critical boundary.

Designed for Google Colab and local execution. Historical data are used only
at prediction time or earlier; future target values are never used as input.
Production artifacts are not modified.
"""
from __future__ import annotations

import json
from pathlib import Path
import warnings
import numpy as np
import pandas as pd
from sklearn.metrics import mean_absolute_error, r2_score
from sklearn.multioutput import MultiOutputRegressor
from xgboost import XGBRegressor

warnings.filterwarnings("ignore", category=FutureWarning)

ROOT = Path(__file__).resolve().parents[2]
DATA_CANDIDATES = [
    ROOT / "ml/data/processed/orca_historical_marine_risk.parquet",
    ROOT / "ml/data/processed/ndbc_marine_risk.parquet",
]
OUT = ROOT / "ml/models/refinement27"
H = 6
TARGETS = ["wind_speed_kts", "wind_gust_kts", "wave_height_m", "swell_height_m", "wave_period_s"]
BASE = [
    "wind_speed_kts", "wind_gust_kts", "wind_direction_deg",
    "wave_height_m", "wave_period_s", "wave_direction_deg",
    "swell_height_m", "swell_period_s", "swell_direction_deg",
    "air_pressure_hpa", "air_temperature_c", "sea_surface_temperature_c",
    "precipitation_mm", "month", "season",
]


def locate(df):
    for c in ["location", "location_name", "station", "station_id", "site"]:
        if c in df.columns:
            return c
    raise ValueError("No location column found")


def make_pairs(df, loc):
    ts = next(c for c in ["timestamp", "time", "datetime", "date_time"] if c in df.columns)
    d = df.copy()
    d[ts] = pd.to_datetime(d[ts], utc=True, errors="coerce")
    d = d.dropna(subset=[ts]).sort_values([loc, ts])
    future = d[[loc, ts] + TARGETS].copy()
    future[ts] = future[ts] - pd.Timedelta(hours=H)
    future = future.rename(columns={c: f"future_{c}" for c in TARGETS})
    return d.merge(future, on=[loc, ts], how="inner"), ts


def features(q):
    """Build X/Y and remove rows with missing future labels.

    The historical source contains legitimate missing observations in some
    target channels. Those rows cannot participate in supervised training,
    because sklearn/XGBoost reject NaN labels. We therefore filter only on the
    five future target columns, never on the feature matrix, and keep the
    resulting X/Y rows exactly aligned.
    """
    use = [c for c in BASE if c in q.columns]
    X = q[use].copy()
    for c in X.columns:
        X[c] = pd.to_numeric(X[c], errors="coerce")
    X = X.fillna(X.median(numeric_only=True)).fillna(0.0)

    Ydf = q[[f"future_{c}" for c in TARGETS]].apply(pd.to_numeric, errors="coerce")
    valid = np.isfinite(Ydf.to_numpy(dtype=float)).all(axis=1)
    dropped = int((~valid).sum())
    if dropped:
        print(f"Supervised-label filter: dropped {dropped:,} pairs with incomplete future targets")

    X = X.loc[valid].reset_index(drop=True)
    Y = Ydf.loc[valid].to_numpy(dtype=float)
    return X, Y


def model(seed):
    return MultiOutputRegressor(XGBRegressor(
        n_estimators=450, max_depth=6, learning_rate=.055,
        subsample=.85, colsample_bytree=.85, objective="reg:squarederror",
        tree_method="hist", n_jobs=2, random_state=seed
    ))


def policy(pred):
    w, g, wh, sh, _ = pred.T
    score = np.maximum.reduce([w / 25.0, g / 35.0, wh / 3.0, sh / 2.0])
    return np.select([score >= 1.0, score >= .72, score >= .45], [3, 2, 1], default=0).astype(int)


def gate(point, spread, q90, alpha):
    norm = np.mean(spread / np.maximum(q90, 1e-6), axis=1)
    uncertain = norm >= alpha
    near_critical = np.abs(policy(point) - 2) <= 1
    activate = uncertain | (near_critical & (norm >= alpha * .70))
    out = point.copy()
    out[activate] = point[activate] + spread[activate]
    return out, activate, norm


def fit_predict(Xtr, Ytr, Xte, seed):
    members = []
    for s in [seed, seed + 17, seed + 31]:
        mm = model(s)
        mm.fit(Xtr, Ytr)
        members.append(np.column_stack([e.predict(Xte) for e in mm.estimators_]))
    arr = np.stack(members, axis=0)
    return arr.mean(axis=0), arr.std(axis=0)


def main():
    print("=" * 78)
    print("ORCA-X UNCERTAINTY-AWARE RISK GATE — REFINEMENT 27")
    print("=" * 78)
    print("Read-only benchmark | no production artifacts modified")
    path = next((p for p in DATA_CANDIDATES if p.exists()), None)
    if path is None:
        raise FileNotFoundError("Historical source parquet not found")
    df = pd.read_parquet(path)
    loc = locate(df)
    q, ts = make_pairs(df, loc)
    X, Y = features(q)
    print(f"Source dataset: {path}")
    print(f"Rows source: {len(df):,} | exact +6h pairs: {len(q):,} | supervised pairs: {len(Y):,}")
    print(f"Locations: {q[loc].nunique()} | Features: {X.shape[1]}")

    # q must be filtered identically to X/Y after the target-validity filter.
    target_cols = [f"future_{c}" for c in TARGETS]
    q_valid = np.isfinite(q[target_cols].apply(pd.to_numeric, errors="coerce").to_numpy(dtype=float)).all(axis=1)
    q_eval = q.loc[q_valid].reset_index(drop=True)

    locations = sorted(q_eval[loc].dropna().astype(str).unique())
    candidates = [0.65, 0.80, 0.95]
    rows = []
    best = None
    for ti, alpha in enumerate(candidates, 1):
        fold = []
        for hold in locations:
            te = q_eval[loc].astype(str).eq(hold)
            tr = ~te
            if tr.sum() < 100 or te.sum() < 20:
                continue
            p, s = fit_predict(X.loc[tr], Y[tr.to_numpy()], X.loc[te], 1000 + ti)
            cal = model(9000 + ti)
            cal.fit(X.loc[tr], Y[tr.to_numpy()])
            cp = cal.predict(X.loc[tr])
            resid = np.abs(Y[tr.to_numpy()] - cp)
            q90 = np.quantile(resid, .90, axis=0)
            gated, active, norm = gate(p, s, q90, alpha)
            yp, yg = policy(p), policy(gated)
            yt = policy(Y[te.to_numpy()])
            fold.append({
                "location": hold, "alpha": alpha,
                "point_accuracy": float(np.mean(yp == yt)),
                "gated_accuracy": float(np.mean(yg == yt)),
                "point_critical_recall": float(np.sum((yt >= 2) & (yp >= 2)) / max(1, np.sum(yt >= 2))),
                "gated_critical_recall": float(np.sum((yt >= 2) & (yg >= 2)) / max(1, np.sum(yt >= 2))),
                "gate_rate": float(active.mean()),
                "mean_uncertainty": float(norm.mean()),
            })
        if not fold:
            continue
        acc = np.mean([r["gated_accuracy"] for r in fold])
        rec = np.mean([r["gated_critical_recall"] for r in fold])
        obj = .55 * acc + .45 * rec
        print(f"[{ti}/3] alpha={alpha:.2f} objective={obj:.5f} gated_acc={acc:.5f} gated_critical={rec:.5f}")
        rows.extend(fold)
        if best is None or obj > best["objective"]:
            best = {"trial": ti, "alpha": alpha, "objective": float(obj), "accuracy": float(acc), "critical_recall": float(rec)}

    if best is None:
        raise RuntimeError("No valid location holdout folds were available")

    years = pd.to_datetime(q_eval[ts], utc=True).dt.year.to_numpy()
    temporal = None
    if 2024 in years and 2025 in years:
        tr = years == 2024
        te = years == 2025
        p, s = fit_predict(X.loc[tr], Y[tr], X.loc[te], 2027)
        cal = model(12027)
        cal.fit(X.loc[tr], Y[tr])
        q90 = np.quantile(np.abs(Y[tr] - cal.predict(X.loc[tr])), .90, axis=0)
        g, active, _ = gate(p, s, q90, best["alpha"])
        yp, yg, yt = policy(p), policy(g), policy(Y[te])
        temporal = {
            "point_policy_accuracy": float(np.mean(yp == yt)),
            "gated_policy_accuracy": float(np.mean(yg == yt)),
            "point_critical_recall": float(np.sum((yt >= 2) & (yp >= 2)) / max(1, np.sum(yt >= 2))),
            "gated_critical_recall": float(np.sum((yt >= 2) & (yg >= 2)) / max(1, np.sum(yt >= 2))),
            "gate_rate": float(active.mean()),
            "mean_mae": float(mean_absolute_error(Y[te], p)),
            "mean_r2": float(r2_score(Y[te], p, multioutput="uniform_average")),
            "rows": int(te.sum()),
        }

    digha = None
    names = q_eval[loc].astype(str).str.lower()
    if "digha_wb" in set(names):
        te = names.eq("digha_wb")
        tr = ~te
        p, s = fit_predict(X.loc[tr], Y[tr], X.loc[te], 3027)
        cal = model(13027)
        cal.fit(X.loc[tr], Y[tr])
        q90 = np.quantile(np.abs(Y[tr] - cal.predict(X.loc[tr])), .90, axis=0)
        g, active, _ = gate(p, s, q90, best["alpha"])
        yp, yg, yt = policy(p), policy(g), policy(Y[te])
        digha = {
            "point_policy_accuracy": float(np.mean(yp == yt)),
            "gated_policy_accuracy": float(np.mean(yg == yt)),
            "point_critical_recall": float(np.sum((yt >= 2) & (yp >= 2)) / max(1, np.sum(yt >= 2))),
            "gated_critical_recall": float(np.sum((yt >= 2) & (yg >= 2)) / max(1, np.sum(yt >= 2))),
            "gate_rate": float(active.mean()),
            "rows": int(te.sum()),
        }

    OUT.mkdir(parents=True, exist_ok=True)
    result = {
        "best": best,
        "temporal": temporal,
        "digha": digha,
        "source_rows": int(len(df)),
        "exact_pairs": int(len(q)),
        "supervised_pairs": int(len(Y)),
        "strict_point_in_time": True,
        "production_modified": False,
    }
    (OUT / "refinement27_results.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
    pd.DataFrame(rows).to_csv(OUT / "gate_by_location.csv", index=False)
    (OUT / "uncertainty_gate_config.json").write_text(
        json.dumps({"alpha_candidates": candidates, "targets": TARGETS, "horizon_hours": H}, indent=2),
        encoding="utf-8",
    )
    print("=" * 78)
    print("REFINEMENT 27 COMPLETE")
    print("=" * 78)
    print(json.dumps(result, indent=2))
    print(f"Saved: {OUT / 'refinement27_results.json'}")
    print("Production model, policy, thresholds, and source dataset were NOT modified.")


if __name__ == "__main__":
    main()
