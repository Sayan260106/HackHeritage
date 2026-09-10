"""ORCA-X Refinement 10: target/data quality reconstruction diagnostics.

Read-only: does not retrain or modify production artifacts.
"""
from __future__ import annotations

import json
from pathlib import Path
import numpy as np
import pandas as pd
from sklearn.metrics import accuracy_score, balanced_accuracy_score, f1_score, confusion_matrix

from config import FEATURE_COLUMNS, PROCESSED_DIR, RISK_HORIZON_HOURS, TARGET_COLUMN, RISK_CLASS_NAMES
from label_policy import assign_operational_risk, POLICY_VERSION

OUT_DIR = Path(__file__).resolve().parents[1] / "models" / "refinement10"


def load_dataset() -> pd.DataFrame:
    path = PROCESSED_DIR / "orca_historical_marine_risk.parquet"
    if not path.exists():
        raise FileNotFoundError("Run prepare_dataset.py first.")
    df = pd.read_parquet(path)
    required = ["location_id", "timestamp", *FEATURE_COLUMNS, TARGET_COLUMN]
    missing = [c for c in required if c not in df.columns]
    if missing:
        raise ValueError(f"Missing columns: {missing}")
    df["timestamp"] = pd.to_datetime(df["timestamp"], utc=True, errors="coerce")
    for c in FEATURE_COLUMNS:
        df[c] = pd.to_numeric(df[c], errors="coerce")
    df = df.dropna(subset=["location_id", "timestamp"]).sort_values(["location_id", "timestamp"]).copy()
    if df.duplicated(["location_id", "timestamp"]).any():
        raise ValueError("Duplicate location/timestamp rows exist.")
    return df


def construct_forward_target(df: pd.DataFrame) -> pd.Series:
    future = df[["location_id", "timestamp", "wind_speed_kts", "wind_gust_kts", "wave_height_m", "swell_height_m"]].copy()
    observable = future[["wind_speed_kts", "wave_height_m", "swell_height_m"]].notna().any(axis=1)
    future["future_risk"] = np.nan
    future.loc[observable, "future_risk"] = future.loc[observable].apply(assign_operational_risk, axis=1)
    future["timestamp"] = future["timestamp"] - pd.Timedelta(hours=int(RISK_HORIZON_HOURS))
    target = future[["location_id", "timestamp", "future_risk"]]
    merged = df[["location_id", "timestamp"]].merge(target, on=["location_id", "timestamp"], how="left")
    return pd.to_numeric(merged["future_risk"], errors="coerce")


def class_distribution(values: pd.Series) -> dict:
    values = pd.to_numeric(values, errors="coerce").dropna().astype(int)
    counts = values.value_counts().sort_index()
    return {RISK_CLASS_NAMES[int(k)]: {"count": int(v), "fraction": float(v / len(values))} for k, v in counts.items()}


def score_metrics(y, pred) -> dict:
    y = np.asarray(y, dtype=int)
    pred = np.asarray(pred, dtype=int)
    critical = np.isin(y, [2, 3])
    return {
        "accuracy": float(accuracy_score(y, pred)),
        "balanced_accuracy": float(balanced_accuracy_score(y, pred)),
        "macro_f1": float(f1_score(y, pred, average="macro", zero_division=0)),
        "critical_recall": float(np.isin(pred[critical], [2, 3]).mean()) if critical.any() else 0.0,
        "confusion_matrix": confusion_matrix(y, pred, labels=[0, 1, 2, 3]).tolist(),
    }


def persistence_baseline(df: pd.DataFrame, target: pd.Series) -> dict:
    current = df[["wind_speed_kts", "wind_gust_kts", "wave_height_m", "swell_height_m"]].apply(assign_operational_risk, axis=1).astype(int)
    valid = target.notna()
    y = target[valid].astype(int).to_numpy()
    pred = current[valid].to_numpy()
    severe_y = np.isin(y, [2, 3])
    severe_p = np.isin(pred, [2, 3])
    return {
        "rows": int(valid.sum()),
        "metrics": score_metrics(y, pred),
        "exact_class_persistence": float((y == pred).mean()),
        "critical_recall": float(severe_p[severe_y].mean()) if severe_y.any() else 0.0,
    }


def temporal_stability(df: pd.DataFrame, target: pd.Series) -> dict:
    work = df[["location_id", "timestamp"]].copy()
    work["target"] = target.to_numpy()
    rows = []
    for location, group in work.dropna(subset=["target"]).groupby("location_id"):
        group = group.sort_values("timestamp")
        y = group["target"].astype(int).to_numpy()
        if len(y) < 2:
            continue
        rows.append({
            "location": location,
            "rows": int(len(y)),
            "adjacent_exact_same": float((y[1:] == y[:-1]).mean()),
            "adjacent_critical_same": float((np.isin(y[1:], [2, 3]) == np.isin(y[:-1], [2, 3])).mean()),
        })
    return {
        "locations": rows,
        "mean_adjacent_exact_same": float(np.mean([r["adjacent_exact_same"] for r in rows])) if rows else 0.0,
        "mean_adjacent_critical_same": float(np.mean([r["adjacent_critical_same"] for r in rows])) if rows else 0.0,
    }


def feature_separation(df: pd.DataFrame, target: pd.Series) -> list[dict]:
    work = df.copy()
    work["target"] = target
    result = []
    for column in FEATURE_COLUMNS:
        x = pd.to_numeric(work[column], errors="coerce")
        valid = x.notna() & work["target"].notna()
        if valid.sum() < 100:
            continue
        means = work.loc[valid].groupby("target")[column].mean()
        std = float(x[valid].std())
        spread = float((means.max() - means.min()) / std) if std > 0 else 0.0
        result.append({
            "feature": column,
            "mean_range_over_std": spread,
            "class_medians": {str(k): float(x[valid & (work["target"] == k)].median()) for k in range(4) if (valid & (work["target"] == k)).any()},
        })
    return sorted(result, key=lambda r: r["mean_range_over_std"], reverse=True)


def audit(df: pd.DataFrame, target: pd.Series) -> dict:
    stored = pd.to_numeric(df[TARGET_COLUMN], errors="coerce")
    valid = target.notna()
    mismatch = valid & stored.notna() & (stored != target)
    gaps = []
    for _, group in df.groupby("location_id"):
        diffs = group["timestamp"].sort_values().diff().dropna().dt.total_seconds() / 3600.0
        gaps.extend(diffs.tolist())
    return {
        "policy_version": POLICY_VERSION,
        "requested_forward_horizon_hours": int(RISK_HORIZON_HOURS),
        "rows": int(len(df)),
        "forward_target_rows": int(valid.sum()),
        "forward_target_missing": int((~valid).sum()),
        "stored_vs_reconstructed_forward_mismatch": int(mismatch.sum()),
        "stored_target_distribution": class_distribution(stored),
        "forward_target_distribution": class_distribution(target),
        "timestamp_gaps_hours": {
            "median": float(np.median(gaps)) if gaps else None,
            "p95": float(np.percentile(gaps, 95)) if gaps else None,
            "max": float(np.max(gaps)) if gaps else None,
            "gaps_gt_1h": int(sum(g > 1.01 for g in gaps)),
        },
    }


def main() -> None:
    print("=" * 78)
    print("ORCA-X TARGET + DATA QUALITY RECONSTRUCTION — REFINEMENT 10")
    print("=" * 78)
    print("Read-only diagnostics | no production model, policy, thresholds, or dataset changes")
    print(f"Forward horizon: +{RISK_HORIZON_HOURS}h | policy: {POLICY_VERSION}")

    df = load_dataset()
    target = construct_forward_target(df)
    df["forward_target"] = target
    valid = target.notna()

    target_audit = audit(df, target)
    persistence = persistence_baseline(df, target)
    stability = temporal_stability(df, target)
    separation = feature_separation(df, target)

    by_location = {}
    for location, group in df[valid].groupby("location_id"):
        by_location[location] = class_distribution(group["forward_target"])

    assessment = {
        "persistence_accuracy": persistence["metrics"]["accuracy"],
        "persistence_macro_f1": persistence["metrics"]["macro_f1"],
        "persistence_critical_recall": persistence["critical_recall"],
        "gap_to_98_accuracy": float(0.98 - persistence["metrics"]["accuracy"]),
        "gap_to_99_accuracy": float(0.99 - persistence["metrics"]["accuracy"]),
        "conclusion": "98-99% accuracy must not be assumed. Under the leakage-safe +6h point-in-time contract it requires genuine held-out evidence. If the target remains a deterministic future weather-policy label, higher performance requires better future-state predictors or a better-grounded observed-outcome target, not more blind hyperparameter search.",
    }

    print(f"Rows: {len(df):,} | Locations: {df.location_id.nunique()} | Forward-target rows: {valid.sum():,}")
    print("\n--- Target construction audit ---")
    print(json.dumps(target_audit, indent=2))
    print("\n--- Current-state policy persistence baseline ---")
    print(json.dumps(persistence, indent=2))
    print("\n--- Target temporal stability ---")
    print(json.dumps(stability, indent=2))
    print("\n--- Forward target distribution by coastline ---")
    for location, dist in by_location.items():
        print(f"{location:12s} {json.dumps(dist, separators=(',', ':'))}")
    print("\n--- Top point-in-time feature separation ---")
    for row in separation[:10]:
        print(f"{row['feature']:32s} mean_range/std={row['mean_range_over_std']:.3f}")
    print("\n--- 98-99% claim assessment ---")
    print(json.dumps(assessment, indent=2))

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    payload = {
        "refinement": "10",
        "audit": target_audit,
        "persistence_baseline": persistence,
        "temporal_stability": stability,
        "coastline_target_distribution": by_location,
        "feature_separation": separation,
        "accuracy_claim_assessment": assessment,
    }
    out = OUT_DIR / "refinement10_diagnostics.json"
    out.write_text(json.dumps(payload, indent=2, default=float), encoding="utf-8")
    print("\n" + "=" * 78)
    print("REFINEMENT 10 DIAGNOSTIC COMPLETE")
    print("=" * 78)
    print(f"Saved: {out}")
    print("Production artifacts were NOT modified.")


if __name__ == "__main__":
    main()
