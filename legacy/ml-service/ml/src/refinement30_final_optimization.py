"""
ORCA-X REFINEMENT 30 — TARGET-AWARE FINAL SAFETY OPTIMIZATION

Final benchmark after Refinement 29A. It tests safety gates built from the
risk-driving targets instead of averaging all five target uncertainties.

Read-only: production artifacts, source data, policy and thresholds are not
modified. The winning configuration is exported for later human-approved
promotion only.

Run in Colab:
    python ml/src/colab_gpu_runner.py ml/src/refinement30_final_optimization.py
"""
from __future__ import annotations

import json
import os
import time
import warnings
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.metrics import mean_absolute_error, r2_score
from xgboost import XGBRegressor

warnings.filterwarnings("ignore", category=FutureWarning)
ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "ml/data/processed/orca_historical_marine_risk.parquet"
OUT = ROOT / "ml/models/refinement30"
H = 6
TARGETS = ["wind_speed_kts", "wind_gust_kts", "wave_height_m", "swell_height_m", "wave_period_s"]
DRIVERS = ["wind_speed_kts", "wind_gust_kts", "wave_height_m", "swell_height_m"]
FEATURES = ["wind_speed_kts", "wind_gust_kts", "wind_direction_deg", "wave_height_m", "wave_period_s", "wave_direction_deg", "swell_height_m", "swell_period_s", "swell_direction_deg", "air_pressure_hpa", "air_temperature_c", "sea_surface_temperature_c", "precipitation_mm", "month", "season"]
SCENARIOS = ["clean", "random_missing_10", "random_missing_25", "random_missing_40", "wind_outage", "sea_state_outage", "atmospheric_outage", "stale_wind", "stale_sea_state", "mixed_degradation"]
WEIGHT_SETS = {
    "equal": np.array([.25, .25, .25, .25]),
    "wind_priority": np.array([.30, .30, .20, .20]),
    "sea_priority": np.array([.20, .20, .30, .30]),
    "wave_priority": np.array([.15, .15, .35, .35]),
}
GATE_TYPES = ["mean", "max", "top2_mean"]
THRESHOLDS = [.08, .10, .12, .15, .18, .20, .25, .30]
BOUNDARY_FACTORS = [.50, .70, 1.00]
CAL_LEVELS = [.90, .95]


def location_col(df):
    return next(c for c in ["location", "location_name", "station", "station_id", "site"] if c in df.columns)


def timestamp_col(df):
    return next(c for c in ["timestamp", "time", "datetime", "date_time"] if c in df.columns)


def pairs(df, loc):
    ts = timestamp_col(df); d = df.copy(); d[ts] = pd.to_datetime(d[ts], utc=True, errors="coerce")
    d = d.dropna(subset=[ts]).sort_values([loc, ts])
    f = d[[loc, ts] + TARGETS].copy(); f[ts] -= pd.Timedelta(hours=H)
    f = f.rename(columns={c: "future_" + c for c in TARGETS})
    q = d.merge(f, on=[loc, ts], how="inner")
    valid = np.isfinite(q[["future_" + c for c in TARGETS]].to_numpy(float)).all(axis=1)
    return q.loc[valid].reset_index(drop=True), ts


def build_x(q):
    x = q[[c for c in FEATURES if c in q.columns]].copy()
    for c in x: x[c] = pd.to_numeric(x[c], errors="coerce")
    return x


def policy(y):
    w, g, wh, sh, _ = y.T
    score = np.maximum.reduce([w/25., g/35., wh/3., sh/2.])
    return np.select([score >= 1., score >= .72, score >= .45], [3,2,1], default=0).astype(int)


def degrade(x, scenario, seed):
    out = x.copy().astype(float); rng = np.random.default_rng(seed)
    groups = {"wind":[c for c in ["wind_speed_kts","wind_gust_kts","wind_direction_deg"] if c in out], "sea":[c for c in ["wave_height_m","wave_period_s","wave_direction_deg","swell_height_m","swell_period_s","swell_direction_deg"] if c in out], "atm":[c for c in ["air_pressure_hpa","air_temperature_c","precipitation_mm"] if c in out]}
    if scenario.startswith("random_missing_"): out = out.mask(rng.random(out.shape) < int(scenario.rsplit('_',1)[1])/100)
    elif scenario == "wind_outage": out.loc[:,groups['wind']] = np.nan
    elif scenario == "sea_state_outage": out.loc[:,groups['sea']] = np.nan
    elif scenario == "atmospheric_outage": out.loc[:,groups['atm']] = np.nan
    elif scenario == "mixed_degradation":
        for cols in groups.values():
            if cols: out.loc[:,cols] = out[cols].mask(rng.random((len(out),len(cols))) < .25)
    elif scenario == "stale_wind": out.loc[:,groups['wind']] = out[groups['wind']].shift(1)
    elif scenario == "stale_sea_state": out.loc[:,groups['sea']] = out[groups['sea']].shift(1)
    return out


def fit(x, y, seed):
    med = x.median(numeric_only=True); a = x.fillna(med).fillna(0.).astype(np.float32); members=[]
    for s in [seed, seed+17, seed+31]:
        ms=[]
        for j in range(len(TARGETS)):
            m=XGBRegressor(n_estimators=400,max_depth=6,learning_rate=.05,subsample=.85,colsample_bytree=.85,objective='reg:squarederror',tree_method='hist',device=os.getenv('ORCA_X_DEVICE','cuda'),n_jobs=int(os.getenv('ORCA_X_N_JOBS','2')),random_state=s+j)
            m.fit(a,y[:,j]); ms.append(m)
        members.append(ms)
    return members,med


def predict(members,x,med):
    a=x.fillna(med).fillna(0.).astype(np.float32); cupy_x=None; cp=None
    if os.getenv('ORCA_X_DEVICE','cuda') == 'cuda':
        try:
            import cupy as _cp; cp=_cp; cupy_x=cp.asarray(a.to_numpy(dtype=np.float32))
        except Exception: pass
    out=[]
    for ms in members:
        cols=[]
        for m in ms:
            col=cp.asnumpy(m.get_booster().inplace_predict(cupy_x)) if cupy_x is not None else m.predict(a)
            cols.append(np.asarray(col,dtype=np.float64))
        out.append(np.column_stack(cols))
    return np.stack(out,axis=0)


def uncertainty(member_pred, calibration, weights, gate_type):
    sigma=member_pred.std(axis=0); z=sigma[:,[TARGETS.index(c) for c in DRIVERS]]/np.maximum(calibration[[TARGETS.index(c) for c in DRIVERS]],1e-6)
    if gate_type=='max': return z.max(axis=1)
    if gate_type=='top2_mean': return np.sort(z,axis=1)[:,-2:].mean(axis=1)
    return z @ weights


def evaluate(member_pred, truth, u, threshold, boundary_factor):
    base=policy(member_pred.mean(axis=0)); actual=policy(truth)
    boundary=(base>=1)&(base<=2); active=(u>=threshold)|(boundary&(u>=threshold*boundary_factor))
    gated=base.copy(); gated[active]=np.minimum(3,gated[active]+1)
    crit=(actual>=2); false=(gated>actual)&(actual<3)
    return dict(point_accuracy=float(np.mean(base==actual)),gated_accuracy=float(np.mean(gated==actual)),point_critical_recall=float(np.sum(crit&(base>=2))/max(1,crit.sum())),gated_critical_recall=float(np.sum(crit&(gated>=2))/max(1,crit.sum())),gate_rate=float(active.mean()),false_escalation_rate=float(false.mean()),over_escalation_rate=float(np.mean(gated>actual)),mean_uncertainty=float(u.mean()))


def score(rows):
    rec=np.mean([r['gated_critical_recall'] for r in rows]); acc=np.mean([r['gated_accuracy'] for r in rows]); false=np.mean([r['false_escalation_rate'] for r in rows]); gate=np.mean([r['gate_rate'] for r in rows])
    # Safety dominates, then accuracy; explicitly penalize false escalation and excessive gating.
    return float(.55*rec+.35*acc-.08*false-.02*gate), float(acc), float(rec), float(false), float(gate)


def main():
    started=time.perf_counter(); print('='*78); print('ORCA-X REFINEMENT 30 — TARGET-AWARE FINAL SAFETY OPTIMIZATION'); print('='*78)
    print('Read-only benchmark | production artifacts are NOT modified')
    df=pd.read_parquet(DATA); loc=location_col(df); q,ts=pairs(df,loc); X=build_x(q); Y=q[['future_'+c for c in TARGETS]].to_numpy(float); locations=sorted(q[loc].astype(str).unique())
    print(f'Rows source: {len(df):,} | complete +6h pairs: {len(q):,} | locations: {len(locations)} | features: {X.shape[1]}')
    cache=[]
    for li,hold in enumerate(locations):
        te=q[loc].astype(str).eq(hold).to_numpy(); tr=~te; print(f'[{li+1}/{len(locations)}] location holdout={hold} ...',flush=True)
        members,med=fit(X.loc[tr],Y[tr],9000+li*100); train=predict(members,X.loc[tr],med); test={}
        for si,sc in enumerate(SCENARIOS):
            xin=X.loc[te] if sc=='clean' else degrade(X.loc[te],sc,20000+li*100+si); test[sc]=predict(members,xin,med)
        cache.append((hold,tr,te,train,test))
    configs=[]; best=None; rows_all=[]
    for level in CAL_LEVELS:
        for weights_name,weights in WEIGHT_SETS.items():
            for gate_type in GATE_TYPES:
                for threshold in THRESHOLDS:
                    for bf in BOUNDARY_FACTORS:
                        rows=[]
                        for hold,tr,te,train,test in cache:
                            cal=np.quantile(np.abs(Y[tr]-train.mean(axis=0)),level,axis=0)
                            for sc,mp in test.items():
                                u=uncertainty(mp,cal,weights,gate_type); r=evaluate(mp,Y[te],u,threshold,bf); r.update(location=hold,scenario=sc,calibration_level=level,weights=weights_name,gate_type=gate_type,threshold=threshold,boundary_factor=bf); rows.append(r)
                        stress=[r for r in rows if r['scenario']!='clean']; value,acc,rec,false,gate=score(stress)
                        cfg={'calibration_level':level,'weights':weights_name,'gate_type':gate_type,'threshold':threshold,'boundary_factor':bf,'objective':value,'stress_accuracy':acc,'stress_critical_recall':rec,'stress_false_escalation_rate':false,'stress_gate_rate':gate}
                        configs.append(cfg); rows_all.extend(rows)
                        if best is None or value>best['objective']: best=cfg
    # Temporal validation of the winner.
    years=pd.to_datetime(q[ts],utc=True).dt.year.to_numpy(); temporal=None
    if 2024 in years and 2025 in years:
        tr,te=years==2024,years==2025; print('Temporal validation: training 2024 -> testing 2025 ...',flush=True)
        members,med=fit(X.loc[tr],Y[tr],29001); train=predict(members,X.loc[tr],med); test=predict(members,X.loc[te],med); cal=np.quantile(np.abs(Y[tr]-train.mean(axis=0)),best['calibration_level'],axis=0); u=uncertainty(test,cal,WEIGHT_SETS[best['weights']],best['gate_type']); temporal=evaluate(test,Y[te],u,best['threshold'],best['boundary_factor']); temporal.update(mean_mae=float(mean_absolute_error(Y[te],test.mean(axis=0))),mean_r2=float(r2_score(Y[te],test.mean(axis=0),multioutput='uniform_average')),rows=int(te.sum()))
    configs_df=pd.DataFrame(configs).sort_values(['objective','stress_critical_recall','stress_accuracy'],ascending=False).reset_index(drop=True); OUT.mkdir(parents=True,exist_ok=True); configs_df.to_csv(OUT/'refinement30_configurations.csv',index=False); pd.DataFrame(rows_all).to_csv(OUT/'refinement30_by_scenario.csv',index=False)
    elapsed=time.perf_counter()-started; result={'refinement':'30','purpose':'target_aware_final_safety_optimization','best':best,'top10':configs_df.head(10).to_dict(orient='records'),'temporal':temporal,'locations':locations,'scenarios':SCENARIOS,'source_rows':int(len(df)),'complete_pairs':int(len(q)),'production_modified':False,'model_reuse':True,'configurations':int(len(configs)),'elapsed_seconds':elapsed}
    (OUT/'refinement30_results.json').write_text(json.dumps(result,indent=2),encoding='utf-8'); print('='*78); print('REFINEMENT 30 COMPLETE'); print('='*78); print(json.dumps(result,indent=2)); print(f'Elapsed: {elapsed/60:.2f} minutes'); print(f'Saved: {OUT/"refinement30_results.json"}'); print('Production model, risk policy, thresholds, and source dataset were NOT modified.')

if __name__=='__main__': main()
