"""ORCA-X Refinement 20: leakage + feature provenance audit.

Read-only diagnostic for the canonical dataset used by Refinement 19.
It checks direct target/future leakage, duplicate keys, temporal ordering,
and exact feature-vector overlap across temporal train/test partitions.
"""
from __future__ import annotations
import json
import re
from pathlib import Path
import numpy as np
import pandas as pd
from config import PROCESSED_DIR, RISK_HORIZON_HOURS

ROOT = Path(__file__).resolve().parents[2]
DATA = PROCESSED_DIR / "orca_historical_marine_risk.parquet"
OUT = ROOT / "ml" / "models" / "refinement20"
HORIZON = int(RISK_HORIZON_HOURS)
TARGETS = ["wind_speed_kts", "wind_gust_kts", "wave_height_m", "swell_height_m", "wave_period_s"]
FORBIDDEN = set(TARGETS + ["risk_class", "risk_label", "stored_risk_label", "timestamp", "latitude", "longitude", "lat", "lon", "location", "station", "location_id", "station_id", "coastline"])
PATTERNS = [r"(^|_)future($|_)", r"(^|_)target($|_)", r"(^|_)lead($|_)", r"(^|_)horizon($|_)", r"(^|_)risk($|_)", r"(^|_)label($|_)", r"(^|_)next($|_)", r"shift.*forward"]


def loc_col(df):
    for c in ("location", "station", "location_id", "coastline"):
        if c in df.columns:
            return c
    raise ValueError("No location column found")


def num(s):
    return pd.to_numeric(s, errors="coerce").replace([np.inf, -np.inf], np.nan)


def make_pairs(df, loc):
    x = df.copy()
    x["timestamp"] = pd.to_datetime(x["timestamp"], utc=True, errors="coerce")
    x = x.dropna(subset=[loc, "timestamp"]).sort_values([loc, "timestamp"]).reset_index(drop=True)
    f = x[[loc, "timestamp"] + TARGETS].copy()
    f["timestamp"] -= pd.to_timedelta(HORIZON, unit="h")
    f = f.rename(columns={c: "future_" + c for c in TARGETS})
    return x.merge(f, on=[loc, "timestamp"], how="inner", validate="one_to_one")


def name_audit(df):
    out = []
    for c in df.columns:
        cl = c.lower()
        if c in FORBIDDEN or any(re.search(p, cl) for p in PATTERNS):
            out.append(c)
    return sorted(set(out))


def future_copy_audit(df, loc):
    q = make_pairs(df, loc)
    findings = []
    candidates = [c for c in df.columns if c not in TARGETS and c not in {loc, "timestamp"}]
    for c in candidates:
        a = num(q[c])
        if a.notna().sum() < 100:
            continue
        for t in TARGETS:
            b = num(q["future_" + t])
            m = a.notna() & b.notna()
            if m.sum() < 100:
                continue
            av, bv = a[m].to_numpy(), b[m].to_numpy()
            exact = float(np.mean(np.isclose(av, bv, rtol=0, atol=1e-12)))
            corr = float(np.corrcoef(av, bv)[0, 1]) if np.std(av) and np.std(bv) else 0.0
            if exact >= .999999 or corr >= .99999:
                findings.append({"feature": c, "future_target": t, "n": int(m.sum()), "exact_match_fraction": exact, "pearson_r": corr})
    return findings


def temporal_audit(df, loc, features):
    x = df[[loc, "timestamp"] + features].copy()
    x["timestamp"] = pd.to_datetime(x["timestamp"], utc=True, errors="coerce")
    x = x.dropna(subset=[loc, "timestamp"]).sort_values([loc, "timestamp"]).reset_index(drop=True)
    tr_parts, te_parts, violations = [], [], []
    for location, g in x.groupby(loc, sort=False):
        cut = int(.7 * len(g)); tr, te = g.iloc[:cut], g.iloc[cut:]
        tr_parts.append(tr); te_parts.append(te)
        if tr["timestamp"].max() >= te["timestamp"].min(): violations.append(str(location))
    tr, te = pd.concat(tr_parts, ignore_index=True), pd.concat(te_parts, ignore_index=True)
    usable = [c for c in features if tr[c].notna().any() and te[c].notna().any()]
    cross = 0
    if usable:
        hk = pd.util.hash_pandas_object(tr[usable].apply(num).round(10), index=False)
        tk = pd.util.hash_pandas_object(te[usable].apply(num).round(10), index=False)
        cross = int(tk.isin(set(hk)).sum())
    return {"train_rows": len(tr), "test_rows": len(te), "temporal_order_violations": violations, "cross_partition_exact_feature_vector_matches": cross, "cross_partition_match_fraction": cross / len(te) if len(te) else 0.0}


def main():
    print("=" * 78)
    print("ORCA-X LEAKAGE + FEATURE PROVENANCE AUDIT — REFINEMENT 20")
    print("=" * 78)
    print("Read-only diagnostic | no production artifacts modified")
    print(f"Source dataset: {DATA}")
    print(f"Forward horizon: +{HORIZON}h")
    if not DATA.exists(): raise FileNotFoundError(f"Canonical processed dataset not found: {DATA}")
    df = pd.read_parquet(DATA); loc = loc_col(df)
    features = [c for c in df.columns if c not in FORBIDDEN and pd.api.types.is_numeric_dtype(df[c])]
    names = name_audit(df); copies = future_copy_audit(df, loc); temporal = temporal_audit(df, loc, features)
    valid = df.dropna(subset=[loc, "timestamp"]).copy()
    dup = int(valid.duplicated([loc, "timestamp"], keep=False).sum())
    pairs = make_pairs(df, loc)
    direct = [x for x in copies if x["exact_match_fraction"] >= .999999 or x["pearson_r"] >= .99999]
    strict = not names and not direct and not temporal["temporal_order_violations"] and temporal["cross_partition_exact_feature_vector_matches"] == 0 and dup == 0
    result = {"contract": {"horizon_hours": HORIZON, "location_excluded": True, "coordinates_excluded": True, "stored_risk_label_excluded": True}, "source": {"rows": len(df), "columns": len(df.columns), "locations": int(df[loc].nunique()), "location_column": loc}, "candidate_numeric_features": features, "forbidden_or_suspicious_feature_names": names, "future_target_copy_findings": copies, "pair_integrity": {"valid_rows": len(valid), "exact_forward_pairs": len(pairs), "duplicate_location_timestamp_rows": dup}, "temporal_partition": temporal, "verdict": {"automated_leakage_flags": len(names) + len(direct), "strict_leakage_free_verdict": strict, "note": "PASS means these automated direct-leakage checks found no issue; it does not prove physical causal validity or rule out subtle dataset-construction leakage."}}
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "refinement20_leakage_audit.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
    pd.DataFrame(copies).to_csv(OUT / "future_target_copy_findings.csv", index=False)
    print(f"Rows: {len(df):,} | Columns: {len(df.columns)} | Locations: {df[loc].nunique()}")
    print(f"Candidate numeric features: {len(features)}")
    print(f"Forbidden/suspicious feature names: {len(names)}")
    print(f"Near-exact future-target copy findings: {len(direct)}")
    print(f"Duplicate (location,timestamp) rows: {dup:,}")
    print(f"Exact +{HORIZON}h pairs: {len(pairs):,}")
    print(f"Cross temporal-partition exact feature-vector matches: {temporal['cross_partition_exact_feature_vector_matches']:,}")
    print(f"Temporal ordering violations: {len(temporal['temporal_order_violations'])}")
    print("=" * 78); print("REFINEMENT 20 COMPLETE"); print("=" * 78)
    print(json.dumps(result["verdict"], indent=2))
    print(f"Saved: {OUT / 'refinement20_leakage_audit.json'}")
    print(f"Saved: {OUT / 'future_target_copy_findings.csv'}")
    print("Production model, risk policy, thresholds, and source dataset were NOT modified.")

if __name__ == "__main__": main()
