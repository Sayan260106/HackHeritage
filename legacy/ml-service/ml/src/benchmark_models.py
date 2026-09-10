"""Benchmark ORCA-X risk models without touching the production artifact.

Runs on the same leakage-audited +6h target and the same Digha spatial holdout
used by train.py. The benchmark is intentionally conservative: it compares
CPU-friendly tree models and selects on Digha macro-F1 first.
"""
from __future__ import annotations
import json
from pathlib import Path
import numpy as np
import pandas as pd
from sklearn.ensemble import ExtraTreesClassifier, HistGradientBoostingClassifier
from sklearn.metrics import accuracy_score, balanced_accuracy_score, f1_score
from xgboost import XGBClassifier
from train import load_dataset, add_dynamic_features, class_weights, HOLDOUT_LOCATION, RANDOM_STATE
from config import TARGET_COLUMN

RISK_NAMES = ["LOW", "MODERATE", "HIGH", "EXTREME"]


def score(y, pred):
    return {
        "accuracy": float(accuracy_score(y, pred)),
        "balanced_accuracy": float(balanced_accuracy_score(y, pred)),
        "macro_f1": float(f1_score(y, pred, average="macro", zero_division=0)),
        "weighted_f1": float(f1_score(y, pred, average="weighted", zero_division=0)),
    }


def main():
    df = load_dataset()
    df, features = add_dynamic_features(df)
    pool = df[df.location_id != HOLDOUT_LOCATION].sort_values(["timestamp", "location_id"]).copy()
    digha = df[df.location_id == HOLDOUT_LOCATION].copy()
    n = len(pool)
    train_end, val_end = int(n * .70), int(n * .85)
    train, val = pool.iloc[:train_end], pool.iloc[train_end:val_end]
    weights = class_weights(train[TARGET_COLUMN])
    sw = train[TARGET_COLUMN].map(weights).to_numpy(dtype=np.float32)

    models = {
        "xgboost": XGBClassifier(objective="multi:softprob", num_class=4, n_estimators=900, learning_rate=.035, max_depth=6, min_child_weight=8, subsample=.85, colsample_bytree=.85, reg_alpha=.15, reg_lambda=2.0, gamma=.05, tree_method="hist", eval_metric="mlogloss", random_state=RANDOM_STATE, n_jobs=-1),
        "extra_trees": ExtraTreesClassifier(n_estimators=500, max_features="sqrt", min_samples_leaf=2, class_weight="balanced", random_state=RANDOM_STATE, n_jobs=-1),
        "hist_gradient_boosting": HistGradientBoostingClassifier(max_iter=500, learning_rate=.06, max_leaf_nodes=31, min_samples_leaf=30, l2_regularization=1.0, random_state=RANDOM_STATE),
    }
    results = {}
    for name, model in models.items():
        print(f"\n=== {name} ===")
        if name == "xgboost":
            model.fit(train[features], train[TARGET_COLUMN], sample_weight=sw, eval_set=[(val[features], val[TARGET_COLUMN])], verbose=False)
        elif name == "extra_trees":
            model.fit(train[features], train[TARGET_COLUMN])
        else:
            model.fit(train[features], train[TARGET_COLUMN], sample_weight=sw)
        vp = model.predict(val[features]).astype(int)
        dp = model.predict(digha[features]).astype(int)
        results[name] = {"temporal": score(val[TARGET_COLUMN], vp), "digha": score(digha[TARGET_COLUMN], dp)}
        print("Temporal:", results[name]["temporal"])
        print("Digha:", results[name]["digha"])

    ranked = sorted(results, key=lambda k: (results[k]["digha"]["macro_f1"], results[k]["digha"]["balanced_accuracy"], results[k]["temporal"]["macro_f1"]), reverse=True)
    output = {"selection_rule": "Digha macro-F1, then Digha balanced accuracy, then temporal macro-F1", "ranking": ranked, "results": results}
    path = Path(__file__).resolve().parents[1] / "models" / "benchmark_results.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(output, indent=2), encoding="utf-8")
    print("\nMODEL RANKING:")
    for i, name in enumerate(ranked, 1):
        print(f"{i}. {name}: Digha macro-F1={results[name]['digha']['macro_f1']:.4f}, balanced_accuracy={results[name]['digha']['balanced_accuracy']:.4f}; temporal macro-F1={results[name]['temporal']['macro_f1']:.4f}")
    print(f"Saved benchmark: {path}")


if __name__ == "__main__":
    main()
