"""Class-aware XGBoost optimization for ORCA-X Refinement 4.

Searches class-weight multipliers on the leak-free temporal validation split.
Digha remains a final spatial holdout and is never used for selection.
"""
from __future__ import annotations
import json
import sys
from pathlib import Path
import numpy as np
import pandas as pd
from sklearn.metrics import balanced_accuracy_score, f1_score, recall_score, confusion_matrix
from xgboost import XGBClassifier
SRC_DIR = Path(__file__).resolve().parent
if str(SRC_DIR) not in sys.path: sys.path.insert(0, str(SRC_DIR))
from config import MODELS_DIR, TARGET_COLUMN  # noqa: E402
from train import HOLDOUT_LOCATION, RANDOM_STATE, add_dynamic_features, class_weights, load_dataset  # noqa: E402

CANDIDATE_PARAMS = {"n_estimators":1000,"learning_rate":0.05,"max_depth":6,"min_child_weight":12,"subsample":0.75,"colsample_bytree":0.75,"reg_alpha":0.15,"reg_lambda":1.0,"gamma":0.0}
BASELINE_PARAMS = {"n_estimators":900,"learning_rate":0.035,"max_depth":6,"min_child_weight":8,"subsample":0.85,"colsample_bytree":0.85,"reg_alpha":0.15,"reg_lambda":2.0,"gamma":0.05}
WEIGHT_TRIALS = [
{"low":.90,"moderate":1.00,"high":1.00,"extreme":1.15},{"low":.90,"moderate":1.05,"high":1.00,"extreme":1.25},{"low":.90,"moderate":1.10,"high":1.00,"extreme":1.35},{"low":.95,"moderate":1.10,"high":1.05,"extreme":1.25},
{"low":1.00,"moderate":1.10,"high":1.05,"extreme":1.35},{"low":.90,"moderate":1.15,"high":1.10,"extreme":1.35},{"low":.95,"moderate":1.20,"high":1.10,"extreme":1.45},{"low":.90,"moderate":1.00,"high":1.10,"extreme":1.45},
{"low":.95,"moderate":1.05,"high":1.15,"extreme":1.50},{"low":.90,"moderate":1.15,"high":1.15,"extreme":1.55},{"low":1.00,"moderate":1.20,"high":1.15,"extreme":1.55},{"low":.85,"moderate":1.10,"high":1.10,"extreme":1.65},
{"low":.90,"moderate":1.20,"high":1.20,"extreme":1.70},{"low":.95,"moderate":1.15,"high":1.20,"extreme":1.80},{"low":.85,"moderate":1.20,"high":1.15,"extreme":1.80},{"low":.90,"moderate":1.25,"high":1.20,"extreme":1.90}]
LABELS={0:"low",1:"moderate",2:"high",3:"extreme"}

def make_model(params):
    return XGBClassifier(objective="multi:softprob",num_class=4,tree_method="hist",eval_metric="mlogloss",random_state=RANDOM_STATE,n_jobs=-1,**params)

def metrics(y_true, proba):
    y=np.asarray(y_true,dtype=int); p=proba.argmax(axis=1)
    cm=confusion_matrix(y,p,labels=[0,1,2,3])
    recalls=np.diag(cm)/np.maximum(cm.sum(axis=1),1)
    return {"accuracy":float((y==p).mean()),"balanced_accuracy":float(balanced_accuracy_score(y,p)),"macro_f1":float(f1_score(y,p,average="macro",zero_division=0)),"weighted_f1":float(f1_score(y,p,average="weighted",zero_division=0)),"low_recall":float(recalls[0]),"moderate_recall":float(recalls[1]),"high_recall":float(recalls[2]),"extreme_recall":float(recalls[3]),"high_extreme_recall":float(recall_score((y>=2).astype(int),(p>=2).astype(int),zero_division=0)),"confusion_matrix":cm.tolist()}

def main():
    print("="*78); print("ORCA-X CLASS-AWARE XGBOOST SEARCH — REFINEMENT 4"); print("="*78)
    print("Selection: temporal validation only | Digha: untouched spatial holdout")
    raw=load_dataset(); df,features=add_dynamic_features(raw)
    pool=df[df.location_id!=HOLDOUT_LOCATION].sort_values("timestamp").copy(); n=len(pool)
    train_df=pool.iloc[:int(n*.70)].copy(); val_df=pool.iloc[int(n*.70):int(n*.85)].copy()
    base=class_weights(train_df[TARGET_COLUMN]); print(f"Training rows: {len(train_df):,}"); print(f"Temporal validation rows: {len(val_df):,}")
    def run(params,mults=None):
        mults=mults or {v:1.0 for v in LABELS.values()}
        weights={c:base[c]*float(mults[LABELS[c]]) for c in range(4)}
        m=make_model(params); m.fit(train_df[features],train_df[TARGET_COLUMN],sample_weight=train_df[TARGET_COLUMN].map(weights).to_numpy(dtype=np.float32),eval_set=[(val_df[features],val_df[TARGET_COLUMN])],verbose=False)
        return metrics(val_df[TARGET_COLUMN],m.predict_proba(val_df[features]))
    baseline=run(BASELINE_PARAMS); candidate=run(CANDIDATE_PARAMS)
    print("\nBaseline:"); print(json.dumps(baseline,indent=2)); print("\nTrial-12:"); print(json.dumps(candidate,indent=2))
    floors={k:max(0.0,baseline[k]-.015) for k in ["extreme_recall","high_recall","high_extreme_recall"]}
    results=[]
    for i,mults in enumerate(WEIGHT_TRIALS,1):
        m=run(CANDIDATE_PARAMS,mults); ok=all(m[k]>=v for k,v in floors.items()); obj=.45*m["macro_f1"]+.35*m["balanced_accuracy"]+.20*m["extreme_recall"]
        r={"trial":i,"weight_multipliers":mults,"objective":float(obj),"safety_ok":bool(ok),"guardrails":floors,**m}; results.append(r)
        print(f"[{i:02d}/16] objective={obj:.5f} macro_f1={m['macro_f1']:.5f} balanced_accuracy={m['balanced_accuracy']:.5f} HIGH={m['high_recall']:.5f} EXTREME={m['extreme_recall']:.5f} HIGH+EXTREME={m['high_extreme_recall']:.5f} safety_ok={ok}")
    feasible=[r for r in results if r["safety_ok"]]
    if not feasible: raise RuntimeError("No class-aware candidate satisfied the safety guardrails.")
    best=max(feasible,key=lambda r:(r["objective"],r["macro_f1"],r["balanced_accuracy"],r["extreme_recall"]))
    out=MODELS_DIR/"tuning"/"class_aware"; out.mkdir(parents=True,exist_ok=True)
    payload={"selection_rule":"maximize 0.45*macro_F1 + 0.35*balanced_accuracy + 0.20*EXTREME_recall subject to HIGH, EXTREME and HIGH+EXTREME recall guardrails","digha_used_for_selection":False,"tree_parameters":CANDIDATE_PARAMS,"baseline_tree_parameters":BASELINE_PARAMS,"training_rows":len(train_df),"validation_rows":len(val_df),"feature_count":len(features),"baseline":baseline,"trial_12":candidate,"guardrails":floors,"best":best,"leaderboard":sorted(results,key=lambda r:(r["safety_ok"],r["objective"]),reverse=True)}
    (out/"class_aware_results.json").write_text(json.dumps(payload,indent=2),encoding="utf-8")
    (out/"best_class_aware_config.json").write_text(json.dumps({"tree_params":CANDIDATE_PARAMS,"weight_multipliers":best["weight_multipliers"]},indent=2),encoding="utf-8")
    print("\n"+"="*78); print("BEST CLASS-AWARE CANDIDATE"); print("="*78); print(json.dumps(best,indent=2)); print(f"\nSaved: {out/'class_aware_results.json'}"); print(f"Saved: {out/'best_class_aware_config.json'}"); print("Production model was NOT modified."); print("Digha was NOT used for selection.")

if __name__=="__main__": main()
