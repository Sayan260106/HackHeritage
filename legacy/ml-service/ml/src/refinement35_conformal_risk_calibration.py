"""Refinement 35 — Conformal Risk Calibration.

Read-only benchmark for uncertainty-aware marine risk prediction.

R34 showed that coastal routing is essentially tied with the coast expert and
that spatial domain shift remains important. R35 therefore tests a different
axis: whether calibrated upper prediction envelopes can improve safety under
clean and degraded observations without changing the production risk policy.

Protocol:
  * 2024 is split chronologically into fit and calibration partitions.
  * Five XGBoost regressors are trained only on the 2024 fit partition.
  * Absolute calibration residuals produce split-conformal-style upper margins.
  * A single alpha is selected per degradation scenario on late-2024
    calibration data using the frozen safety-first utility.
  * The selected alpha is frozen before the 2025 test set is touched.
  * Baseline predictions and uncertainty-inflated predictions are evaluated
    across the same ten R34 degradation scenarios.
  * Spatial diagnostics use a leave-one-coast-out fit and pooled calibration;
    the held-out coast is never used to select its alpha.

This is intentionally benchmark-only. Production models, thresholds, risk
policy, artifacts and inference code are not modified.
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
RISK_TARGETS = ["wind_speed_kts", "wind_gust_kts", "wave_height_m", "swell_height_m"]
FEATURES = list(FEATURE_COLUMNS)
OUTPUT_DIR = ML_ROOT / "models" / "refinement35"
SCENARIOS = ["clean", "random_missing_10", "random_missing_25", "random_missing_40", "wind_outage", "sea_state_outage", "atmospheric_outage", "stale_wind", "stale_sea_state", "mixed_degradation"]
ALPHAS = [0.05, 0.10, 0.15, 0.20, 0.30, 0.40]


def device_name() -> str:
    value = os.getenv("ORCA_X_DEVICE", "cpu").strip().lower()
    if value in {"gpu", "cuda", "cuda:0"}: return "cuda"
    if value == "cpu": return "cpu"
    raise ValueError("ORCA_X_DEVICE must be one of: cpu, cuda, gpu, cuda:0")


def n_jobs() -> int:
    return int(os.getenv("ORCA_X_N_JOBS", "2"))


def make_model(seed: int) -> xgb.XGBRegressor:
    params = dict(objective="reg:squarederror", n_estimators=int(os.getenv("ORCA_X_R35_ESTIMATORS", "450")), max_depth=int(os.getenv("ORCA_X_R35_MAX_DEPTH", "5")), learning_rate=float(os.getenv("ORCA_X_R35_LEARNING_RATE", "0.04")), min_child_weight=int(os.getenv("ORCA_X_R35_MIN_CHILD_WEIGHT", "6")), subsample=0.90, colsample_bytree=0.90, reg_alpha=0.10, reg_lambda=2.50, gamma=0.03, tree_method="hist", random_state=seed, n_jobs=n_jobs())
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
    X = feature_frame(frame)
    models = []
    for j, target in enumerate(TARGET_COLUMNS):
        model = make_model(RANDOM_STATE + seed_offset + j)
        model.fit(X, frame[f"target_{target}"].to_numpy(float), verbose=False)
        models.append(model)
    return models


def predict_one(model: xgb.XGBRegressor, X_cpu: np.ndarray) -> np.ndarray:
    """Use the native Booster API when CUDA is enabled to avoid device mismatch."""
    if device_name() == "cuda":
        try:
            import cupy as cp
            X_dev = cp.asarray(X_cpu)
            pred = model.get_booster().inplace_predict(X_dev)
            return cp.asnumpy(pred).astype(float, copy=False)
        except Exception:
            pass
    return np.asarray(model.predict(X_cpu), dtype=float)


def predict_multioutput(models, frame: pd.DataFrame) -> np.ndarray:
    X = feature_frame(frame).to_numpy(dtype=np.float32)
    return np.column_stack([predict_one(m, X) for m in models])


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


def target_values(frame):
    return frame[[f"target_{c}" for c in TARGET_COLUMNS]].to_numpy(dtype=float)


def regression_metrics(actual, pred):
    return {"mean_mae": float(mean_absolute_error(actual, pred)), "mean_r2": float(r2_score(actual, pred, multioutput="uniform_average")), **{f"{t}_mae": float(mean_absolute_error(actual[:, i], pred[:, i])) for i, t in enumerate(TARGET_COLUMNS)}, **{f"{t}_r2": float(r2_score(actual[:, i], pred[:, i])) for i, t in enumerate(TARGET_COLUMNS)}}


def metrics(actual, pred):
    y, p = risk_class(actual), risk_class(pred)
    critical = y >= 2
    return {"accuracy": float(accuracy_score(y, p)), "balanced_accuracy": float(balanced_accuracy_score(y, p)), "macro_f1": float(f1_score(y, p, average="macro", zero_division=0)), "critical_recall": float((p[critical] >= 2).mean()) if critical.any() else 0.0, "critical_miss_rate": float((critical & (p < 2)).mean()), "false_escalation_rate": float((p > y).mean()), **regression_metrics(actual, pred)}


def utility(m):
    return 10.0*m["critical_recall"] + 2.0*m["balanced_accuracy"] + m["accuracy"] - 2.0*m["false_escalation_rate"] - 0.10*m["mean_mae"]


def conformal_margins(actual, pred, alpha: float):
    margins = {}
    for i, target in enumerate(TARGET_COLUMNS):
        residual = np.abs(actual[:, i] - pred[:, i])
        q = float(np.quantile(residual, 1.0 - alpha, method="higher"))
        margins[target] = q
    return margins


def upper_prediction(pred: np.ndarray, margins: dict) -> np.ndarray:
    out = pred.copy()
    for i, target in enumerate(TARGET_COLUMNS):
        if target in RISK_TARGETS:
            out[:, i] = out[:, i] + margins[target]
    return out


def choose_alpha(calibration, baseline_models):
    rows = []
    selected = {}
    for si, scenario in enumerate(SCENARIOS):
        frame = degrade(calibration, scenario, 135000 + si)
        actual = target_values(frame)
        baseline = predict_multioutput(baseline_models, frame)
        alpha_rows = []
        for alpha in ALPHAS:
            margins = conformal_margins(actual, baseline, alpha)
            upper = upper_prediction(baseline, margins)
            m = metrics(actual, upper)
            u = utility(m)
            alpha_rows.append((u, alpha, margins, m))
            rows.append({"scenario":scenario,"alpha":alpha,"utility":u,"selected":False,**m,**{f"margin_{k}":v for k,v in margins.items()}})
        winner = max(alpha_rows, key=lambda x: (x[0], -x[1]))
        selected[scenario] = {"alpha":winner[1],"margins":winner[2]}
        rows.append({"scenario":scenario,"alpha":winner[1],"utility":winner[0],"selected":True,**winner[3],**{f"margin_{k}":v for k,v in winner[2].items()}})
    return selected, pd.DataFrame(rows)


def evaluate_temporal(fit, calibration, test):
    print("\n[1/4] Training global regression model...")
    models = fit_multioutput(fit, 0)
    print("[2/4] Calibrating conformal margins on late 2024...")
    selected, calibration_table = choose_alpha(calibration, models)
    print("[3/4] Frozen calibration complete; evaluating 2025...")
    rows = []
    for si, scenario in enumerate(SCENARIOS):
        frame = degrade(test, scenario, 145000 + si)
        actual = target_values(frame)
        baseline = predict_multioutput(models, frame)
        cfg = selected[scenario]
        upper = upper_prediction(baseline, cfg["margins"])
        for strategy, pred in [("global_baseline", baseline), ("conformal_upper", upper)]:
            m = metrics(actual, pred)
            rows.append({"scope":"temporal_2025","strategy":strategy,"scenario":scenario,"alpha":0.0 if strategy=="global_baseline" else cfg["alpha"],**m})
    return pd.DataFrame(rows), calibration_table, selected, models


def run_spatial_holdouts(df):
    rows=[]
    locations=sorted(df[LOCATION_COLUMN].astype(str).unique())
    for i, holdout in enumerate(locations,1):
        train_all=df[df[LOCATION_COLUMN].astype(str)!=holdout].reset_index(drop=True)
        train, calibration, test=chronological_splits(train_all)
        heldout_test=df[df[LOCATION_COLUMN].astype(str)==holdout].reset_index(drop=True)
        heldout_2025=heldout_test[heldout_test[TIMESTAMP_COLUMN].dt.year==2025].reset_index(drop=True)
        if heldout_2025.empty: continue
        print(f"  [{i}/{len(locations)}] holdout={holdout} train={len(train):,} calibration={len(calibration):,} test={len(heldout_2025):,}")
        models=fit_multioutput(train,7000+i*100)
        selected,_=choose_alpha(calibration,models)
        for si,scenario in enumerate(SCENARIOS):
            frame=degrade(heldout_2025,scenario,165000+i*100+si)
            actual=target_values(frame); baseline=predict_multioutput(models,frame); upper=upper_prediction(baseline,selected[scenario]["margins"])
            for strategy,pred in [("global_baseline",baseline),("conformal_upper",upper)]:
                m=metrics(actual,pred)
                rows.append({"location":holdout,"scope":"spatial_2025","strategy":strategy,"scenario":scenario,"alpha":0.0 if strategy=="global_baseline" else selected[scenario]["alpha"],**m})
    return pd.DataFrame(rows)


def summarize(temporal):
    rows=[]
    for strategy in ["global_baseline","conformal_upper"]:
        clean=temporal[(temporal.strategy==strategy)&(temporal.scenario=="clean")].iloc[0]
        stress=temporal[(temporal.strategy==strategy)&(temporal.scenario!="clean")]
        agg=stress.mean(numeric_only=True)
        score=10*agg.critical_recall+2*agg.balanced_accuracy+agg.accuracy-2*agg.false_escalation_rate-0.10*agg.mean_mae
        rows.append({"strategy":strategy,"clean_accuracy":clean.accuracy,"clean_critical_recall":clean.critical_recall,"clean_mean_mae":clean.mean_mae,"stress_accuracy":agg.accuracy,"stress_balanced_accuracy":agg.balanced_accuracy,"stress_macro_f1":agg.macro_f1,"stress_critical_recall":agg.critical_recall,"stress_critical_miss_rate":agg.critical_miss_rate,"stress_false_escalation_rate":agg.false_escalation_rate,"stress_mean_mae":agg.mean_mae,"stress_mean_r2":agg.mean_r2,"benchmark_score":score})
    return pd.DataFrame(rows).sort_values("benchmark_score",ascending=False).reset_index(drop=True)


def main():
    started=time.perf_counter()
    print("="*92); print("ORCA-X REFINEMENT 35 — CONFORMAL RISK CALIBRATION"); print("="*92)
    print("Read-only benchmark: production artifacts, risk policy and thresholds untouched")
    print(f"XGBoost device={device_name()} n_jobs={n_jobs()} version={xgb.__version__}")
    df=load_pairs(); fit,calibration,test=chronological_splits(df); locations=sorted(df[LOCATION_COLUMN].astype(str).unique())
    print(f"Source rows={len(df):,} | complete +6h pairs={len(df):,} | locations={len(locations)}")
    print(f"2024 fit={len(fit):,} | 2024 calibration={len(calibration):,} | 2025 test={len(test):,}")
    print(f"Locations={locations}"); print(f"Features={len(FEATURES)} | targets={len(TARGET_COLUMNS)} | scenarios={len(SCENARIOS)} | candidate_alphas={ALPHAS}")
    temporal,calibration_table,selected,models=evaluate_temporal(fit,calibration,test)
    print("[4/4] Running leave-one-coast-out spatial diagnostics...")
    spatial=run_spatial_holdouts(df); summary=summarize(temporal); OUTPUT_DIR.mkdir(parents=True,exist_ok=True)
    temporal.to_csv(OUTPUT_DIR/"temporal_2025_conformal_results.csv",index=False)
    calibration_table.to_csv(OUTPUT_DIR/"conformal_calibration_2024.csv",index=False)
    spatial.to_csv(OUTPUT_DIR/"spatial_2025_conformal_holdouts.csv",index=False)
    summary.to_csv(OUTPUT_DIR/"strategy_summary.csv",index=False)
    alpha_table=pd.DataFrame([{"scenario":s,"alpha":cfg["alpha"],**{f"margin_{k}":v for k,v in cfg["margins"].items()}} for s,cfg in selected.items()])
    alpha_table.to_csv(OUTPUT_DIR/"selected_conformal_alpha.csv",index=False)
    metadata={"strategies":["global_baseline","conformal_upper"],"features":FEATURES,"targets":TARGET_COLUMNS,"risk_targets":RISK_TARGETS,"scenarios":SCENARIOS,"candidate_alphas":ALPHAS,"source_rows":int(len(df)),"complete_pairs":int(len(df)),"fit_2024_rows":int(len(fit)),"calibration_2024_rows":int(len(calibration)),"test_2025_rows":int(len(test)),"locations":locations,"prediction_horizon_hours":int(RISK_HORIZON_HOURS),"device":device_name(),"n_jobs":n_jobs(),"production_modified":False,"calibration_period":"late_2024_only","selection_rule":"safety-first utility on calibration; critical recall dominates","utility":"10*critical_recall + 2*balanced_accuracy + accuracy - 2*false_escalation_rate - 0.10*mean_mae","conformal_method":"absolute residual quantiles; upper envelope applied only to risk-driving targets","spatial_protocol":"leave-one-coast-out; held-out coast excluded from fit and calibration","runtime_seconds":time.perf_counter()-started}
    (OUTPUT_DIR/"benchmark_metadata.json").write_text(json.dumps(metadata,indent=2),encoding="utf-8")
    print("\n"+"="*92); print("REFINEMENT 35 COMPLETE"); print("="*92)
    print(summary.to_string(index=False,float_format=lambda x:f"{x:.6f}"))
    print("\nSelected conformal alpha by scenario:"); print(alpha_table.to_string(index=False,float_format=lambda x:f"{x:.6f}"))
    print("\nSpatial conformal summary:")
    sp=spatial[spatial.scenario!="clean"].groupby("strategy").mean(numeric_only=True).reset_index()
    print(sp[["strategy","accuracy","balanced_accuracy","critical_recall","critical_miss_rate","false_escalation_rate","mean_mae"]].to_string(index=False,float_format=lambda x:f"{x:.6f}"))
    winner=summary.iloc[0]["strategy"] if not summary.empty else "none"
    print(f"\nBenchmark winner: {winner}")
    print("Winner is a benchmark candidate only; production model/risk policy was NOT changed.")
    print(f"Artifacts: {OUTPUT_DIR}"); print(f"Elapsed: {(time.perf_counter()-started)/60:.2f} minutes")


if __name__ == "__main__": main()
