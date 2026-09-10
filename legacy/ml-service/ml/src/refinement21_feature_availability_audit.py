"""ORCA-X Refinement 21: feature availability + physical-causality audit.

Read-only diagnostic. It audits the features used by Refinement 19/13 against the
+6h forecasting contract without changing production artifacts.
"""
from __future__ import annotations

import json
import re
from pathlib import Path
import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "ml" / "data" / "processed" / "orca_historical_marine_risk.parquet"
OUT = ROOT / "ml" / "models" / "refinement21"
HORIZON_HOURS = 6
TARGETS = ["wind_speed_kts", "wind_gust_kts", "wave_height_m", "swell_height_m", "wave_period_s"]

SUSPICIOUS = re.compile(r"future|forecast|target|label|risk|lead|lag|next|tplus|t\+|ahead|horizon", re.I)

def location_col(df):
    for c in ["location", "coastline", "station", "location_id"]:
        if c in df.columns: return c
    raise ValueError("No location column found")

def audit_feature(name, df):
    low = name.lower()
    reasons=[]; verdict="SAFE"
    if SUSPICIOUS.search(low):
        reasons.append("name suggests future/target/risk-derived information")
        verdict="SUSPICIOUS"
    if name in TARGETS:
        reasons.append("is itself a future prediction target")
        verdict="FORBIDDEN"
    return verdict, reasons

def main():
    print("="*78)
    print("ORCA-X FEATURE AVAILABILITY + PHYSICAL CAUSALITY AUDIT — REFINEMENT 21")
    print("="*78)
    print("Read-only diagnostic | no production artifacts modified")
    print(f"Source dataset: {DATA}")
    print(f"Forward horizon: +{HORIZON_HOURS}h")
    df=pd.read_parquet(DATA)
    loc=location_col(df)
    ts="timestamp" if "timestamp" in df.columns else None
    if ts is None: raise ValueError("timestamp column required")
    df[ts]=pd.to_datetime(df[ts], errors="coerce", utc=True)
    numeric=df.select_dtypes(include=[np.number]).columns.tolist()
    candidates=[c for c in numeric if c not in ["risk_class"]]
    rows=[]
    for c in candidates:
        v,r=audit_feature(c,df)
        s=df[c]
        rows.append({"feature":c,"dtype":str(s.dtype),"non_null_fraction":float(s.notna().mean()),"unique_values":int(s.nunique(dropna=True)),"verdict":v,"reasons":"; ".join(r)})
    audit=pd.DataFrame(rows)
    # Pair source t with exact t+6 target rows. This measures whether a feature has
    # implausibly strong contemporaneous association with a future physical state.
    keys=[loc,ts]
    base=df[keys+candidates].copy()
    future=df[[loc,ts]+TARGETS].copy()
    future[ts]=future[ts]-pd.Timedelta(hours=HORIZON_HOURS)
    future=future.rename(columns={c:f"future_{c}" for c in TARGETS})
    pairs=base.merge(future,on=keys,how="inner",validate="one_to_one")
    print(f"Rows source: {len(df):,} | exact +6h pairs: {len(pairs):,} | numeric candidates: {len(candidates)}")
    corr_rows=[]
    for c in candidates:
        for t in TARGETS:
            fc=f"future_{t}"
            valid=pairs[[c,fc]].replace([np.inf,-np.inf],np.nan).dropna()
            corr=float(valid[c].corr(valid[fc])) if len(valid)>=3 else float("nan")
            corr_rows.append({"feature":c,"future_target":t,"pearson_r":corr,"abs_pearson_r":abs(corr) if np.isfinite(corr) else np.nan,"pairs":len(valid)})
    corr=pd.DataFrame(corr_rows)
    maxcorr=corr.groupby("feature",as_index=False)["abs_pearson_r"].max().rename(columns={"abs_pearson_r":"max_abs_future_target_corr"})
    audit=audit.merge(maxcorr,on="feature",how="left")
    # Strong association is not itself leakage; flag only for human review.
    audit.loc[(audit.max_abs_future_target_corr>=0.98)&(audit.verdict=="SAFE"),"verdict"]="SUSPICIOUS"
    audit.loc[(audit.max_abs_future_target_corr>=0.98)&(audit.verdict=="SAFE"),"reasons"]="extremely strong future-target correlation; causal review required"
    counts=audit.verdict.value_counts().to_dict()
    print("\nFeature audit:")
    for _,r in audit.sort_values(["verdict","feature"]).iterrows():
        print(f"{r.feature:35s} {r.verdict:10s} non_null={r.non_null_fraction:.3f} max_future_corr={r.max_abs_future_target_corr if pd.notna(r.max_abs_future_target_corr) else float('nan'):.5f} {r.reasons}")
    result={
      "rows_source":len(df),"exact_forward_pairs":len(pairs),"candidate_numeric_features":len(candidates),
      "verdict_counts":counts,
      "strict_feature_availability_verdict": bool((audit.verdict=="SAFE").all()),
      "note":"Correlation with future state is a screening signal, not proof of leakage. SAFE requires the feature to be available at prediction time and not derived from future observations; this automated audit cannot establish physical causality by itself.",
      "features":audit.to_dict(orient="records")
    }
    OUT.mkdir(parents=True,exist_ok=True)
    audit.to_csv(OUT/"feature_availability_audit.csv",index=False)
    corr.to_csv(OUT/"future_target_correlations.csv",index=False)
    (OUT/"refinement21_feature_availability_audit.json").write_text(json.dumps(result,indent=2,allow_nan=True),encoding="utf-8")
    print("\n"+"="*78)
    print("REFINEMENT 21 COMPLETE")
    print("="*78)
    print(json.dumps({k:v for k,v in result.items() if k!="features"},indent=2))
    print(f"Saved: {OUT/'refinement21_feature_availability_audit.json'}")
    print(f"Saved: {OUT/'feature_availability_audit.csv'}")
    print(f"Saved: {OUT/'future_target_correlations.csv'}")
    print("Production model, risk policy, thresholds, and source dataset were NOT modified.")

if __name__=="__main__": main()
