"""ORCA-X Refinement 7: coastline distribution-shift diagnostics.

This is a read-only diagnostic. It does not retrain a model, alter the risk
policy, modify calibration/thresholds, or change production artifacts.

The analysis answers four questions before coast-balanced training:
1. How different are the environmental feature distributions by coastline?
2. Which coast/class combinations are under-represented?
3. Which features show the strongest cross-coast distribution shift?
4. Are Goa and Chennai failures explained by covariate or class/regime shift?

All statistics are computed from the same +6h forward target contract used by
train.py and train_cross_coast_generalization.py. The contemporaneous stored
risk label is deliberately ignored.
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd

from config import FEATURE_COLUMNS, PROCESSED_DIR, RISK_HORIZON_HOURS, RISK_CLASS_NAMES, TARGET_COLUMN
from label_policy import assign_operational_risk, POLICY_VERSION

LOCATIONS = ["digha_wb", "paradip_od", "vizag_ap", "chennai_tn", "goa", "kochi_kl"]
NUMERIC_BASE = [
    "wind_speed_kts", "wind_gust_kts", "wave_height_m", "wave_period_s",
    "swell_height_m", "swell_period_s", "air_pressure_hpa", "air_temperature_c",
    "sea_surface_temperature_c", "precipitation_mm",
]
OUT_DIR = Path(__file__).resolve().parents[1] / "models" / "spatial_generalization"


def load_forward_dataset() -> pd.DataFrame:
    path = PROCESSED_DIR / "orca_historical_marine_risk.parquet"
    if not path.exists():
        raise FileNotFoundError(f"Dataset not found: {path}\nRun prepare_dataset.py first.")
    df = pd.read_parquet(path).copy()
    required = ["location_id", "timestamp", *FEATURE_COLUMNS]
    missing = [c for c in required if c not in df.columns]
    if missing:
        raise ValueError(f"Missing required columns: {missing}")
    df["timestamp"] = pd.to_datetime(df["timestamp"], utc=True, errors="coerce")
    for c in FEATURE_COLUMNS:
        df[c] = pd.to_numeric(df[c], errors="coerce")
    df = df.dropna(subset=["location_id", "timestamp"]).sort_values(["location_id", "timestamp"])
    if df.duplicated(["location_id", "timestamp"]).any():
        raise ValueError("Duplicate location/timestamp rows detected")

    future = df[["location_id", "timestamp", "wind_speed_kts", "wind_gust_kts", "wave_height_m", "swell_height_m"]].copy()
    future[TARGET_COLUMN] = future.apply(assign_operational_risk, axis=1)
    # Future observation at t+6h becomes target for features at t.
    future["timestamp"] = future["timestamp"] - pd.to_timedelta(RISK_HORIZON_HOURS, unit="h")
    target = future[["location_id", "timestamp", TARGET_COLUMN]]
    df = df.merge(target, on=["location_id", "timestamp"], how="left", suffixes=("", "_future"))
    df[TARGET_COLUMN] = pd.to_numeric(df[f"{TARGET_COLUMN}_future"], errors="coerce")
    df = df.drop(columns=[f"{TARGET_COLUMN}_future"]).dropna(subset=[TARGET_COLUMN]).copy()
    df[TARGET_COLUMN] = df[TARGET_COLUMN].astype(int)
    return df


def summarize_class_distribution(df: pd.DataFrame) -> list[dict]:
    counts = df.groupby(["location_id", TARGET_COLUMN]).size().unstack(fill_value=0)
    rows = []
    for loc in LOCATIONS:
        total = int(counts.loc[loc].sum()) if loc in counts.index else 0
        row = {"location": loc, "rows": total}
        for cls in range(4):
            n = int(counts.loc[loc].get(cls, 0)) if loc in counts.index else 0
            row[f"class_{cls}_count"] = n
            row[f"class_{cls}_fraction"] = float(n / total) if total else 0.0
        rows.append(row)
    return rows


def robust_quantiles(series: pd.Series) -> dict:
    s = pd.to_numeric(series, errors="coerce").dropna()
    if s.empty:
        return {"count": 0}
    q = s.quantile([0.01, 0.05, 0.25, 0.5, 0.75, 0.95, 0.99])
    return {
        "count": int(s.size), "missing_fraction": float(series.isna().mean()),
        "mean": float(s.mean()), "std": float(s.std(ddof=0)),
        "q01": float(q.loc[0.01]), "q05": float(q.loc[0.05]),
        "q25": float(q.loc[0.25]), "median": float(q.loc[0.50]),
        "q75": float(q.loc[0.75]), "q95": float(q.loc[0.95]), "q99": float(q.loc[0.99]),
    }


def standardized_mean_difference(a: pd.Series, b: pd.Series) -> float:
    a = pd.to_numeric(a, errors="coerce").dropna()
    b = pd.to_numeric(b, errors="coerce").dropna()
    if len(a) < 2 or len(b) < 2:
        return 0.0
    pooled = np.sqrt((a.var(ddof=1) + b.var(ddof=1)) / 2.0)
    return float((a.mean() - b.mean()) / pooled) if pooled > 0 else 0.0


def psi(expected: pd.Series, actual: pd.Series, bins: int = 10) -> float:
    """Population Stability Index using quantile bins from expected."""
    e = pd.to_numeric(expected, errors="coerce").dropna()
    a = pd.to_numeric(actual, errors="coerce").dropna()
    if len(e) < 20 or len(a) < 20 or e.nunique() < 2:
        return 0.0
    edges = np.unique(e.quantile(np.linspace(0, 1, bins + 1)).to_numpy())
    if len(edges) < 3:
        return 0.0
    edges[0] = -np.inf
    edges[-1] = np.inf
    ep = np.histogram(e, bins=edges)[0].astype(float) / len(e)
    ap = np.histogram(a, bins=edges)[0].astype(float) / len(a)
    ep = np.clip(ep, 1e-6, None)
    ap = np.clip(ap, 1e-6, None)
    return float(np.sum((ap - ep) * np.log(ap / ep)))


def main() -> None:
    print("=" * 78)
    print("ORCA-X COASTLINE DISTRIBUTION-SHIFT ANALYSIS — REFINEMENT 7")
    print("=" * 78)
    print("Read-only diagnostics | forward +6h target | no production changes")
    df = load_forward_dataset()
    print(f"Rows: {len(df):,} | Locations: {df.location_id.nunique()} | Target: {TARGET_COLUMN}")

    class_rows = summarize_class_distribution(df)
    print("\n--- Forward target distribution by coastline ---")
    for r in class_rows:
        print(
            f"{r['location']:12s} rows={r['rows']:6d} "
            f"LOW={r['class_0_fraction']:.3f} MOD={r['class_1_fraction']:.3f} "
            f"HIGH={r['class_2_fraction']:.3f} EXT={r['class_3_fraction']:.3f}"
        )

    feature_summary = {}
    for feature in NUMERIC_BASE:
        feature_summary[feature] = {
            loc: robust_quantiles(df.loc[df.location_id == loc, feature]) for loc in LOCATIONS
        }

    shift_rows = []
    reference = df[df.location_id.isin(["digha_wb", "paradip_od", "vizag_ap"])].copy()
    for feature in NUMERIC_BASE:
        ref = reference[feature]
        for loc in ["chennai_tn", "goa", "kochi_kl"]:
            actual = df.loc[df.location_id == loc, feature]
            shift_rows.append({
                "feature": feature,
                "location": loc,
                "reference_mean": float(pd.to_numeric(ref, errors="coerce").mean()),
                "location_mean": float(pd.to_numeric(actual, errors="coerce").mean()),
                "standardized_mean_difference": standardized_mean_difference(ref, actual),
                "psi_vs_reference": psi(ref, actual),
            })
    shift_df = pd.DataFrame(shift_rows)
    shift_df["abs_smd"] = shift_df["standardized_mean_difference"].abs()
    shift_df["abs_psi"] = shift_df["psi_vs_reference"].abs()

    print("\n--- Largest shifts vs Digha/Paradip/Vizag reference ---")
    for loc in ["chennai_tn", "goa", "kochi_kl"]:
        sub = shift_df[shift_df.location == loc].sort_values(["abs_smd", "abs_psi"], ascending=False).head(5)
        print(f"{loc}:")
        for _, r in sub.iterrows():
            print(f"  {r.feature:28s} | |SMD|={r.abs_smd:.3f} PSI={r.psi_vs_reference:.3f}")

    # Regime-level summaries: compare the environmental distributions inside
    # each operational class. This is more useful than raw class counts alone.
    regime_rows = []
    for loc in LOCATIONS:
        for cls in range(4):
            part = df[(df.location_id == loc) & (df[TARGET_COLUMN] == cls)]
            row = {"location": loc, "risk_class": cls, "risk_name": RISK_CLASS_NAMES[cls], "rows": int(len(part))}
            for feature in ["wind_speed_kts", "wind_gust_kts", "wave_height_m", "swell_height_m"]:
                s = pd.to_numeric(part[feature], errors="coerce")
                row[f"{feature}_median"] = float(s.median()) if not s.dropna().empty else None
                row[f"{feature}_q95"] = float(s.quantile(.95)) if not s.dropna().empty else None
            regime_rows.append(row)

    # Identify classes with unusually small support. This is diagnostic only;
    # no labels are changed and no rows are duplicated here.
    support_rows = []
    class_totals = df[TARGET_COLUMN].value_counts().to_dict()
    for loc in LOCATIONS:
        for cls in range(4):
            n = int(((df.location_id == loc) & (df[TARGET_COLUMN] == cls)).sum())
            global_fraction = n / max(1, class_totals.get(cls, 0))
            support_rows.append({
                "location": loc, "risk_class": cls, "risk_name": RISK_CLASS_NAMES[cls],
                "rows": n, "share_of_global_class": float(global_fraction),
            })

    # Overall coast-to-coast distance: average PSI and |SMD| over the monitored
    # physical variables. Lower is better.
    coast_distance = []
    for loc in LOCATIONS:
        if loc == "digha_wb":
            continue
        sub = shift_df[shift_df.location == loc]
        if not sub.empty:
            coast_distance.append({
                "location": loc,
                "mean_abs_smd": float(sub.abs_smd.mean()),
                "mean_psi": float(sub.psi_vs_reference.mean()),
                "max_abs_smd": float(sub.abs_smd.max()),
                "max_psi": float(sub.psi_vs_reference.max()),
            })

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    payload = {
        "analysis": "coast_distribution_shift",
        "policy_version": POLICY_VERSION,
        "horizon_hours": int(RISK_HORIZON_HOURS),
        "rows": int(len(df)),
        "locations": LOCATIONS,
        "class_distribution": class_rows,
        "feature_summary": feature_summary,
        "reference_coasts": ["digha_wb", "paradip_od", "vizag_ap"],
        "shift_vs_reference": shift_rows,
        "regime_summary": regime_rows,
        "class_support": support_rows,
        "coast_distance": coast_distance,
    }
    (OUT_DIR / "coast_shift_analysis.json").write_text(json.dumps(payload, indent=2), encoding="utf-8")
    shift_df.drop(columns=["abs_smd", "abs_psi"]).to_csv(OUT_DIR / "coast_feature_shift.csv", index=False)
    pd.DataFrame(regime_rows).to_csv(OUT_DIR / "coast_risk_regimes.csv", index=False)
    pd.DataFrame(support_rows).to_csv(OUT_DIR / "coast_class_support.csv", index=False)

    print("\n==============================================================================")
    print("REFINEMENT 7 DIAGNOSTIC COMPLETE")
    print("==============================================================================")
    print(f"Saved: {OUT_DIR / 'coast_shift_analysis.json'}")
    print(f"Saved: {OUT_DIR / 'coast_feature_shift.csv'}")
    print(f"Saved: {OUT_DIR / 'coast_risk_regimes.csv'}")
    print(f"Saved: {OUT_DIR / 'coast_class_support.csv'}")
    print("No model, risk policy, calibration, thresholds, or production artifacts were modified.")


if __name__ == "__main__":
    main()
