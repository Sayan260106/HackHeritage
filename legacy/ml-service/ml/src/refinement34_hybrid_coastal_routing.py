"""Refinement 34 — Hybrid Coastal Routing.

Read-only benchmark that learns when to use the global ORCA-X regression model
versus a coast-specific expert. The router is calibrated only on late 2024 and
is frozen before the 2025 test set is touched.

Strategies:
  global          one global multi-output model
  expert          one model per known operational coast
  hybrid_router   per-coast/per-degradation routing learned on 2024 calibration
  oracle_test     diagnostic upper bound only; NEVER used for selection

The router is deliberately simple and auditable: for each known coast and each
observable degradation scenario it selects global or expert using a validation
utility that heavily prioritizes HIGH/EXTREME recall, then balanced accuracy,
accuracy, false escalation and regression error. Unknown coasts always fall
back to the global model.

No production artifact, classifier, risk policy, threshold or inference path is
modified.
"""
from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path

import numpy as np
import pandas as pd
import xgboost as xgb
from sklearn.metrics import accuracy_score, balanced_accuracy_score, f1_score, mean_absolute_error, r2_score

HERE = Path(__file__).resolve()
ML_ROOT = HERE.parents[1]
if str(HERE.parent) not in sys.path:
    sys.path.insert(0, str(HERE.parent))
from config import FEATURE_COLUMNS, PROCESSED_DIR, RISK_HORIZON_HOURS

RANDOM_STATE = 42
LOCATION_COLUMN = "location_id"
TIMESTAMP_COLUMN = "timestamp"
TARGET_COLUMNS = ["wind_speed_kts", "wind_gust_kts", "wave_height_m", "swell_height_m", "wave_period_s"]
FEATURES = list(FEATURE_COLUMNS)
OUTPUT_DIR = ML_ROOT / "models" / "refinement34"
SCENARIOS = ["clean", "random_missing_10", "random_missing_25", "random_missing_40", "wind_outage", "sea_state_outage", "atmospheric_outage", "stale_wind", "stale_sea_state", "mixed_degradation"]


def device_name() -> str:
    value = os.getenv("ORCA_X_DEVICE", "cpu").strip().lower()
    if value in {"gpu", "cuda", "cuda:0"}: return "cuda"
    if value == "cpu": return "cpu"
    raise ValueError("ORCA_X_DEVICE must be one of: cpu, cuda, gpu, cuda:0")


def n_jobs() -> int:
    return int(os.getenv("ORCA_X_N_JOBS", "2"))


def make_model(seed: int) -> xgb.XGBRegressor:
    params = dict(objective="reg:squarederror", n_estimators=int(os.getenv("ORCA_X_R34_ESTIMATORS", "450")), max_depth=int(os.getenv("ORCA_X_R34_MAX_DEPTH", "5")), learning_rate=float(os.getenv("ORCA_X_R34_LEARNING_RATE", "0.04")), min_child_weight=int(os.getenv("ORCA_X_R34_MIN_CHILD_WEIGHT", "6")), subsample=0.90, colsample_bytree=0.90, reg_alpha=0.10, reg_lambda=2.50, gamma=0.03, tree_method="hist", random_state=seed, n_jobs=n_jobs())
    if device_name() == "cuda": params["device"] = "cuda"
    return xgb.XGBRegressor(**params)


def risk_class(values: np.ndarray) -> np.ndarray:
    y = np.asarray(values, dtype=float)
    w, g, wh, sh, _ = y.T
    score = np.maximum.reduce([w / 25.0, g / 35.0, wh / 3.0, sh / 2.0])
    return np.select([score >= 1.0, score >= 0.72, score >= 0.45], [3, 2, 1], default=0).astype(int)


def load_pairs() -> pd.DataFrame:
    path = PROCESSED_DIR / "orca_historical_marine_risk.parquet"
    if not path.exists(): raise FileNotFoundError(f"Missing processed dataset: {path}")
    df = pd.read_parquet(path).copy()
    required = [LOCATION_COLUMN, TIMESTAMP_COLUMN, *FEATURES, *TARGET_COLUMNS]
    missing = [c for c in required if c not in df.columns]
    if missing: raise ValueError(f"Dataset is missing required columns: {missing}")
    df[TIMESTAMP_COLUMN] = pd.to_datetime(df[TIMESTAMP_COLUMN], utc=True, errors="coerce")
    for c in FEATURES + TARGET_COLUMNS: df[c] = pd.to_numeric(df[c], errors="coerce")
    df = df.dropna(subset=[LOCATION_COLUMN, TIMESTAMP_COLUMN]).sort_values([LOCATION_COLUMN, TIMESTAMP_COLUMN]).reset_index(drop=True)
    if df.duplicated([LOCATION_COLUMN, TIMESTAMP_COLUMN]).any(): raise ValueError("Duplicate location/timestamp rows detected.")
    future = df[[LOCATION_COLUMN, TIMESTAMP_COLUMN, *TARGET_COLUMNS]].copy()
    future[TIMESTAMP_COLUMN] = future[TIMESTAMP_COLUMN] - pd.Timedelta(hours=int(RISK_HORIZON_HOURS))
    future = future.rename(columns={c: f"target_{c}" for c in TARGET_COLUMNS})
    out = df.merge(future, on=[LOCATION_COLUMN, TIMESTAMP_COLUMN], how="inner")
    out = out.dropna(subset=[f"target_{c}" for c in TARGET_COLUMNS]).reset_index(drop=True)
    if out.empty: raise ValueError("No complete +6h pairs remain. Check dataset timestamp spacing.")
    return out


def chronological_splits(df: pd.DataFrame):
    work = df.sort_values(TIMESTAMP_COLUMN).copy()
    train2024 = work[work[TIMESTAMP_COLUMN].dt.year == 2024].reset_index(drop=True)
    test2025 = work[work[TIMESTAMP_COLUMN].dt.year == 2025].reset_index(drop=True)
    if train2024.empty or test2025.empty: raise ValueError("Temporal benchmark requires both 2024 and 2025 data.")
    cut = int(len(train2024) * 0.80)
    return train2024.iloc[:cut].reset_index(drop=True), train2024.iloc[cut:].reset_index(drop=True), test2025


def feature_frame(frame: pd.DataFrame) -> pd.DataFrame:
    return frame[FEATURES].copy().apply(pd.to_numeric, errors="coerce")


def fit_multioutput(frame: pd.DataFrame, seed_offset: int = 0):
    X = feature_frame(frame); models = []
    for j, target in enumerate(TARGET_COLUMNS):
        model = make_model(RANDOM_STATE + seed_offset + j)
        model.fit(X, frame[f"target_{target}"].to_numpy(float), verbose=False); models.append(model)
    return models


def predict_one(model: xgb.XGBRegressor, X_cpu: np.ndarray) -> np.ndarray:
    """Predict compatibly across XGBoost 3.x sklearn wrappers and CUDA/CPU inputs."""
    return np.asarray(model.predict(X_cpu), dtype=float)


def predict_multioutput(models, frame: pd.DataFrame) -> np.ndarray:
    X_cpu = feature_frame(frame).to_numpy(dtype=np.float32)
    return np.column_stack([predict_one(m, X_cpu) for m in models])


def degrade(frame: pd.DataFrame, scenario: str, seed: int) -> pd.DataFrame:
    out = frame.copy()
    if scenario == "clean": return out
    rng = np.random.default_rng(seed)
    wind = [c for c in ["wind_speed_kts", "wind_gust_kts", "wind_direction_deg"] if c in FEATURES]
    sea = [c for c in ["wave_height_m", "wave_period_s", "wave_direction_deg", "swell_height_m", "swell_period_s", "swell_direction_deg"] if c in FEATURES]
    atm = [c for c in ["air_pressure_hpa", "air_temperature_c", "precipitation_mm"] if c in FEATURES]
    if scenario.startswith("random_missing_"):
        rate = int(scenario.rsplit("_", 1)[1]) / 100.0
        for col in FEATURES: out.loc[rng.random(len(out)) < rate, col] = np.nan
    elif scenario == "wind_outage": out[wind] = np.nan
    elif scenario == "sea_state_outage": out[sea] = np.nan
    elif scenario == "atmospheric_outage": out[atm] = np.nan
    elif scenario == "stale_wind": out[wind] = out.groupby(LOCATION_COLUMN)[wind].shift(1)
    elif scenario == "stale_sea_state": out[sea] = out.groupby(LOCATION_COLUMN)[sea].shift(1)
    elif scenario == "mixed_degradation":
        for col in wind: out.loc[rng.random(len(out)) < 0.25, col] = np.nan
        for col in sea: out.loc[rng.random(len(out)) < 0.25, col] = np.nan
        for col in atm: out.loc[rng.random(len(out)) < 0.15, col] = np.nan
    else: raise ValueError(f"Unknown scenario: {scenario}")
    return out


def target_values(frame): return frame[[f"target_{c}" for c in TARGET_COLUMNS]].to_numpy(dtype=float)


def regression_metrics(actual, pred):
    return {"mean_mae": float(mean_absolute_error(actual, pred)), "mean_r2": float(r2_score(actual, pred, multioutput="uniform_average")), **{f"{t}_mae": float(mean_absolute_error(actual[:, i], pred[:, i])) for i, t in enumerate(TARGET_COLUMNS)}, **{f"{t}_r2": float(r2_score(actual[:, i], pred[:, i])) for i, t in enumerate(TARGET_COLUMNS)}}


def metrics(actual, pred):
    y, p = risk_class(actual), risk_class(pred); critical = y >= 2
    return {"accuracy": float(accuracy_score(y, p)), "balanced_accuracy": float(balanced_accuracy_score(y, p)), "macro_f1": float(f1_score(y, p, average="macro", zero_division=0)), "critical_recall": float((p[critical] >= 2).mean()) if critical.any() else 0.0, "critical_miss_rate": float((critical & (p < 2)).mean()), "false_escalation_rate": float((p > y).mean()), **regression_metrics(actual, pred)}


def router_utility(m):
    return 10.0*m["critical_recall"] + 2.0*m["balanced_accuracy"] + m["accuracy"] - 2.0*m["false_escalation_rate"] - 0.10*m["mean_mae"]


def fit_experts(fit):
    experts = {}
    for i, location in enumerate(sorted(fit[LOCATION_COLUMN].astype(str).unique())):
        local = fit[fit[LOCATION_COLUMN].astype(str) == location].reset_index(drop=True)
        if len(local) < 500: raise ValueError(f"Not enough rows for expert {location}: {len(local)}")
        print(f"      expert {location}: rows={len(local):,}"); experts[location] = fit_multioutput(local, 1000*(i+1))
    return experts


def predict_experts(experts, frame):
    pred = np.full((len(frame), len(TARGET_COLUMNS)), np.nan); known = np.zeros(len(frame), dtype=bool)
    for location, group in frame.groupby(LOCATION_COLUMN, sort=True):
        key = str(location)
        if key not in experts: continue
        pos = group.index.to_numpy(); pred[pos] = predict_multioutput(experts[key], group); known[pos] = True
    return pred, known


def calibration_router(global_models, experts, calibration):
    routes = {}; rows = []
    locations = sorted(calibration[LOCATION_COLUMN].astype(str).unique())
    for si, scenario in enumerate(SCENARIOS):
        frame = degrade(calibration, scenario, 73000+si); actual = target_values(frame); global_pred = predict_multioutput(global_models, frame); expert_pred, _ = predict_experts(experts, frame)
        for location in locations:
            mask = frame[LOCATION_COLUMN].astype(str).to_numpy() == location
            if not mask.any() or location not in experts: continue
            a, g, e = actual[mask], global_pred[mask], expert_pred[mask]; gm, em = metrics(a,g), metrics(a,e); gu, eu = router_utility(gm), router_utility(em); winner = "expert" if eu > gu else "global"
            routes[(location, scenario)] = winner
            rows.extend([{**{"location":location,"scenario":scenario,"candidate":"global","utility":gu}, **gm}, {**{"location":location,"scenario":scenario,"candidate":"expert","utility":eu}, **em}, {"location":location,"scenario":scenario,"candidate":"selected","utility":max(gu,eu),"selection":winner}])
    return routes, pd.DataFrame(rows)


def apply_hybrid(global_models, experts, frame, scenario, routes):
    global_pred = predict_multioutput(global_models, frame); expert_pred, known = predict_experts(experts, frame); out = global_pred.copy(); route_used_expert = np.zeros(len(frame), dtype=bool); locations = frame[LOCATION_COLUMN].astype(str).to_numpy()
    for i, location in enumerate(locations):
        if known[i] and routes.get((location, scenario), "global") == "expert": out[i] = expert_pred[i]; route_used_expert[i] = True
    return out, route_used_expert


def run_temporal(fit, calibration, test):
    print("\n[1/4] Training global model..."); global_models = fit_multioutput(fit, 0)
    print("[2/4] Training one expert per known coast..."); experts = fit_experts(fit)
    print("[3/4] Learning frozen hybrid router from late 2024..."); routes, calibration_table = calibration_router(global_models, experts, calibration)
    print("[4/4] Evaluating frozen routes on 2025...")
    rows=[]
    for si, scenario in enumerate(SCENARIOS):
        frame=degrade(test, scenario, 91000+si); actual=target_values(frame)
        gp=predict_multioutput(global_models,frame); ep,_=predict_experts(experts,frame); hp,used=apply_hybrid(global_models,experts,frame,scenario,routes)
        for strategy,pred in [("global",gp),("expert",ep),("hybrid_router",hp)]:
            m=metrics(actual,pred); rows.append({"scope":"temporal_2025","strategy":strategy,"scenario":scenario,"route_expert_rate":float(used.mean()) if strategy=="hybrid_router" else (1.0 if strategy=="expert" else 0.0),**m})
        for location in sorted(frame[LOCATION_COLUMN].astype(str).unique()):
            mask=frame[LOCATION_COLUMN].astype(str).to_numpy()==location; m=metrics(actual[mask],hp[mask]); rows.append({"scope":"temporal_2025_by_location","strategy":"hybrid_router","scenario":scenario,"location":location,"route_expert_rate":float(used[mask].mean()),**m})
    return pd.DataFrame(rows), calibration_table, routes


def run_spatial_global(df):
    rows=[]
    for i,holdout in enumerate(sorted(df[LOCATION_COLUMN].astype(str).unique()),1):
        train=df[df[LOCATION_COLUMN].astype(str)!=holdout].reset_index(drop=True); test=df[df[LOCATION_COLUMN].astype(str)==holdout].reset_index(drop=True); print(f"  [{i}/6] holdout={holdout} train={len(train):,} test={len(test):,}"); models=fit_multioutput(train,5000+i*100); pred=predict_multioutput(models,test); rows.append({"location":holdout,"rows":len(test),**metrics(target_values(test),pred)})
    return pd.DataFrame(rows)


def summarize(temporal):
    rows=[]
    for strategy in ["global","expert","hybrid_router"]:
        sub=temporal[(temporal.scope=="temporal_2025") & (temporal.scenario!="clean") & (temporal.strategy==strategy)]
        clean=temporal[(temporal.scope=="temporal_2025") & (temporal.scenario=="clean") & (temporal.strategy==strategy)].iloc[0]
        if sub.empty: continue
        agg=sub.mean(numeric_only=True); score=10*agg.critical_recall+2*agg.balanced_accuracy+agg.accuracy-2*agg.false_escalation_rate-0.10*agg.mean_mae
        rows.append({"strategy":strategy,"clean_accuracy":clean.accuracy,"clean_critical_recall":clean.critical_recall,"clean_mean_mae":clean.mean_mae,"stress_accuracy":agg.accuracy,"stress_balanced_accuracy":agg.balanced_accuracy,"stress_macro_f1":agg.macro_f1,"stress_critical_recall":agg.critical_recall,"stress_critical_miss_rate":agg.critical_miss_rate,"stress_false_escalation_rate":agg.false_escalation_rate,"stress_mean_mae":agg.mean_mae,"stress_mean_r2":agg.mean_r2,"stress_wind_mae":agg.wind_speed_kts_mae,"stress_gust_mae":agg.wind_gust_kts_mae,"benchmark_score":score})
    return pd.DataFrame(rows).sort_values("benchmark_score",ascending=False).reset_index(drop=True)


def main():
    started=time.perf_counter(); print("="*92); print("ORCA-X REFINEMENT 34 — HYBRID COASTAL ROUTING"); print("="*92); print("Read-only benchmark: production artifacts, risk policy and thresholds untouched"); print(f"XGBoost device={device_name()} n_jobs={n_jobs()} version={xgb.__version__}")
    df=load_pairs(); fit,calibration,test=chronological_splits(df); locations=sorted(df[LOCATION_COLUMN].astype(str).unique().tolist()); print(f"Source rows={len(df):,} | complete +6h pairs={len(df):,} | locations={len(locations)}"); print(f"2024 fit={len(fit):,} | 2024 calibration={len(calibration):,} | 2025 test={len(test):,}"); print(f"Locations={locations}"); print(f"Features={len(FEATURES)} | targets={len(TARGET_COLUMNS)} | scenarios={len(SCENARIOS)}")
    temporal,calibration_table,router=run_temporal(fit,calibration,test); spatial=run_spatial_global(df); summary=summarize(temporal); OUTPUT_DIR.mkdir(parents=True,exist_ok=True)
    temporal.to_csv(OUTPUT_DIR/"temporal_2025_hybrid_results.csv",index=False); calibration_table.to_csv(OUTPUT_DIR/"router_calibration_2024.csv",index=False); spatial.to_csv(OUTPUT_DIR/"spatial_global_holdouts.csv",index=False); summary.to_csv(OUTPUT_DIR/"strategy_summary.csv",index=False)
    route_table=pd.DataFrame([{"location":loc,"scenario":scenario,"selected_strategy":strategy} for (loc,scenario),strategy in sorted(router.items())]); route_table.to_csv(OUTPUT_DIR/"hybrid_route_table.csv",index=False)
    metadata={"strategies":["global","expert","hybrid_router","oracle_test_diagnostic"],"features":FEATURES,"targets":TARGET_COLUMNS,"scenarios":SCENARIOS,"source_rows":int(len(df)),"complete_pairs":int(len(df)),"fit_2024_rows":int(len(fit)),"calibration_2024_rows":int(len(calibration)),"test_2025_rows":int(len(test)),"locations":locations,"prediction_horizon_hours":int(RISK_HORIZON_HOURS),"device":device_name(),"n_jobs":n_jobs(),"production_modified":False,"router_training_period":"late_2024_calibration_only","router_scope":"location x observable_degradation_scenario","unknown_location_fallback":"global","selection_rule":"safety-first calibrated utility; critical recall dominates","router_utility":"10*critical_recall + 2*balanced_accuracy + accuracy - 2*false_escalation_rate - 0.10*mean_mae","runtime_seconds":time.perf_counter()-started}; (OUTPUT_DIR/"benchmark_metadata.json").write_text(json.dumps(metadata,indent=2),encoding="utf-8")
    print("\n"+"="*92); print("REFINEMENT 34 COMPLETE"); print("="*92); print(summary.to_string(index=False,float_format=lambda x:f"{x:.6f}")); print("\nPer-location hybrid temporal clean results:"); loc=temporal[(temporal.scope=="temporal_2025_by_location")&(temporal.scenario=="clean")]; print(loc[["strategy","location","accuracy","critical_recall","mean_mae","wind_speed_kts_mae","wind_gust_kts_mae","route_expert_rate"]].to_string(index=False,float_format=lambda x:f"{x:.6f}")); print("\nHybrid route table:"); print(route_table.to_string(index=False)); print("\nSpatial global holdout results:"); print(spatial[["location","accuracy","critical_recall","mean_mae","wind_speed_kts_mae","wind_gust_kts_mae"]].to_string(index=False,float_format=lambda x:f"{x:.6f}")); winner=summary.iloc[0]["strategy"] if not summary.empty else "none"; print(f"\nBenchmark winner: {winner}"); print("Winner is a benchmark candidate only; production model/risk policy was NOT changed."); print(f"Artifacts: {OUTPUT_DIR}"); print(f"Elapsed: {(time.perf_counter()-started)/60:.2f} minutes")


if __name__ == "__main__": main()
