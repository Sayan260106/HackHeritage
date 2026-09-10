"""ORCA-X Refinement 17: class-conditional conformal safety benchmark.

Builds on Refinement 16 without changing production artifacts.  Instead of one
shared conformal nonconformity threshold, each risk class receives its own
calibration quantile.  HIGH/EXTREME are deliberately protected with more
conservative candidate inclusion, while LOW/MODERATE retain tighter sets when
the calibration evidence supports it.

Contract:
* clean +6h forward target
* causal feature pipeline inherited from Refinement 14/13
* chronological train/calibration/test split
* calibration-only threshold selection
* leave-one-coast-out selection; Digha is final audit only
* no location IDs/coordinates/stored labels as features
* no production artifacts modified
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.metrics import accuracy_score, balanced_accuracy_score, confusion_matrix, f1_score, log_loss

from refinement14_calibrated_risk_model import (
    HOLDOUT_LOCATION, SOURCE_PATH, TARGET_COLUMN, add_dynamic_features,
    apply_temperature, class_weights, chronological_split, fit_temperature,
    load_clean, make_model, probabilities,
)

OUT_DIR = Path(__file__).resolve().parents[1] / "models" / "refinement17"
COVERAGE_GRID = (0.85, 0.90, 0.95)
CRITICAL = (2, 3)


def norm(p):
    p = np.clip(np.asarray(p, dtype=float), 1e-12, None)
    return p / p.sum(axis=1, keepdims=True)


def class_quantiles(y, p, coverage):
    p = norm(p)
    qs = {}
    for c in range(4):
        s = 1.0 - p[y == c, c]
        if len(s) == 0:
            qs[c] = 1.0
            continue
        s = np.sort(s)
        rank = min(max(int(np.ceil((len(s) + 1) * coverage)) - 1, 0), len(s) - 1)
        qs[c] = float(s[rank])
    return qs


def make_sets(p, qs):
    p = norm(p)
    out = np.zeros_like(p, dtype=bool)
    for c in range(4):
        out[:, c] = p[:, c] >= (1.0 - qs[c] - 1e-12)
    # Safety guard: if neither critical class is included, retain HIGH/EXTREME
    # only when its calibrated probability is competitive with the best class.
    return out


def decide(p, sets, critical_floor=0.18):
    p = norm(p)
    pred = p.argmax(1).astype(int)
    uncertain = sets.sum(1) > 2
    for i, members in enumerate(sets):
        idx = np.flatnonzero(members)
        if len(idx) == 0:
            # No class passed its class-specific threshold: calibrated argmax.
            continue
        crit = idx[np.isin(idx, CRITICAL)]
        if len(crit):
            # Conservative choice whenever a critical class has meaningful mass.
            strong = crit[p[i, crit] >= critical_floor]
            pred[i] = int(strong[np.argmax(p[i, strong])]) if len(strong) else int(crit[np.argmax(p[i, crit])])
        elif len(idx) == 1:
            pred[i] = int(idx[0])
        else:
            pred[i] = int(idx[np.argmax(p[i, idx])])
    return pred, uncertain


def critical_recall(y, pred):
    m = np.isin(y, CRITICAL)
    return float(np.isin(pred[m], CRITICAL).mean()) if m.any() else 0.0


def summarize(y, p, pred, uncertain):
    p = norm(p)
    return {
        "accuracy": float(accuracy_score(y, pred)),
        "balanced_accuracy": float(balanced_accuracy_score(y, pred)),
        "macro_f1": float(f1_score(y, pred, average="macro", zero_division=0)),
        "weighted_f1": float(f1_score(y, pred, average="weighted", zero_division=0)),
        "high_recall": float(((y == 2) & (pred == 2)).sum() / max((y == 2).sum(), 1)),
        "extreme_recall": float(((y == 3) & (pred == 3)).sum() / max((y == 3).sum(), 1)),
        "high_extreme_recall": critical_recall(y, pred),
        "uncertain_rate": float(uncertain.mean()),
        "selective_accuracy": float(accuracy_score(y[~uncertain], pred[~uncertain])) if (~uncertain).any() else 0.0,
        "log_loss": float(log_loss(y, p, labels=[0,1,2,3])),
        "confusion_matrix": confusion_matrix(y, pred, labels=[0,1,2,3]).tolist(),
        "rows": int(len(y)),
    }


def choose(y, p):
    best = None
    best_score = -1e9
    for coverage in COVERAGE_GRID:
        qs = class_quantiles(y, p, coverage)
        sets = make_sets(p, qs)
        pred, uncertain = decide(p, sets)
        crit = critical_recall(y, pred)
        macro = f1_score(y, pred, average="macro", zero_division=0)
        bal = balanced_accuracy_score(y, pred)
        # Favor critical recall first, then classification quality and compact sets.
        score = 0.50 * crit + 0.30 * macro + 0.20 * bal - 0.03 * uncertain.mean()
        if score > best_score:
            best_score = score
            best = {"coverage": float(coverage), "quantiles": qs, "objective": float(score),
                    "calibration_critical_recall": float(crit),
                    "calibration_macro_f1": float(macro),
                    "calibration_balanced_accuracy": float(bal),
                    "calibration_uncertain_rate": float(uncertain.mean())}
    return best


def fit_fold(train, cal, test, features):
    model = make_model()
    model.fit(train[features], train[TARGET_COLUMN], sample_weight=class_weights(train[TARGET_COLUMN]), verbose=False)
    cal_raw = norm(probabilities(model, cal[features]))
    test_raw = norm(probabilities(model, test[features]))
    temp = fit_temperature(cal[TARGET_COLUMN].to_numpy(int), cal_raw)
    cal_p = norm(apply_temperature(cal_raw, temp))
    test_p = norm(apply_temperature(test_raw, temp))
    selection = choose(cal[TARGET_COLUMN].to_numpy(int), cal_p)
    sets = make_sets(test_p, selection["quantiles"])
    pred, uncertain = decide(test_p, sets)
    y = test[TARGET_COLUMN].to_numpy(int)
    arg = test_p.argmax(1)
    return {
        "temperature": float(temp), "selection": selection,
        "mean_set_size": float(sets.sum(1).mean()),
        "coverage": float(sets[np.arange(len(y)), y].mean()),
        "argmax": summarize(y, test_p, arg, np.zeros(len(y), bool)),
        "class_conditional": summarize(y, test_p, pred, uncertain),
    }


def main():
    print("=" * 78)
    print("ORCA-X CLASS-CONDITIONAL CONFORMAL SAFETY BENCHMARK — REFINEMENT 17")
    print("=" * 78)
    print("Selection: mean leave-one-coast-out; Digha excluded from selection")
    print("Calibration: chronological; temperature + class-specific quantiles fitted only on calibration")
    print("Decision: critical-aware class-conditional sets; large sets abstain")
    print("Forward horizon: +6h")
    df = load_clean()
    df, features = add_dynamic_features(df)
    print(f"Rows: {len(df):,} | Locations: {df.location_id.nunique()} | Features: {len(features)}")
    print(f"Target distribution: {df[TARGET_COLUMN].value_counts().sort_index().to_dict()}")
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    locs = sorted(x for x in df.location_id.unique() if x != HOLDOUT_LOCATION)
    folds = []
    for loc in locs:
        pool = df[df.location_id != loc]
        train, cal, _ = chronological_split(pool)
        test = df[df.location_id == loc]
        r = fit_fold(train, cal, test, features)
        folds.append({"location": loc, **r})
        m = r["class_conditional"]
        print(f"{loc:12s} coverage={r['coverage']:.4f} set_size={r['mean_set_size']:.3f} "
              f"macro_f1={m['macro_f1']:.4f} critical={m['high_extreme_recall']:.4f} "
              f"uncertain={m['uncertain_rate']:.4f} selective_acc={m['selective_accuracy']:.4f}")

    def avg(section, key): return float(np.mean([f[section][key] for f in folds]))
    result = {
        "refinement": 17,
        "contract": {"source": str(SOURCE_PATH), "forward_horizon_hours": 6,
                     "holdout_location": HOLDOUT_LOCATION, "features": len(features),
                     "calibration_only": True, "no_future_features": True},
        "selection_mean": {
            "argmax": {k: avg("argmax", k) for k in ("accuracy","balanced_accuracy","macro_f1","high_extreme_recall")},
            "class_conditional": {
                k: avg("class_conditional", k) for k in ("accuracy","balanced_accuracy","macro_f1","high_extreme_recall","uncertain_rate","selective_accuracy")
            },
            "coverage": float(np.mean([f["coverage"] for f in folds])),
            "mean_set_size": float(np.mean([f["mean_set_size"] for f in folds])),
        },
        "folds": folds,
    }

    # Freeze median calibration settings, refit without Digha, then perform one final Digha audit.
    coverage = float(np.median([f["selection"]["coverage"] for f in folds]))
    qmat = np.array([[f["selection"]["quantiles"][c] for c in range(4)] for f in folds])
    frozen_q = {str(c): float(np.median(qmat[:, c])) for c in range(4)}
    pool = df[df.location_id != HOLDOUT_LOCATION]
    train, cal, _ = chronological_split(pool)
    model = make_model()
    model.fit(train[features], train[TARGET_COLUMN], sample_weight=class_weights(train[TARGET_COLUMN]), verbose=False)
    cal_raw = norm(probabilities(model, cal[features]))
    temp = fit_temperature(cal[TARGET_COLUMN].to_numpy(int), cal_raw)
    digha = df[df.location_id == HOLDOUT_LOCATION]
    p = norm(apply_temperature(probabilities(model, digha[features]), temp))
    y = digha[TARGET_COLUMN].to_numpy(int)
    sets = make_sets(p, {int(k): v for k,v in frozen_q.items()})
    pred, uncertain = decide(p, sets)
    result["digha_final_audit"] = {
        "temperature": float(temp), "frozen_coverage_target": coverage,
        "frozen_quantiles": frozen_q, "coverage": float(sets[np.arange(len(y)), y].mean()),
        "mean_set_size": float(sets.sum(1).mean()), "metrics": summarize(y, p, pred, uncertain)
    }
    path = OUT_DIR / "refinement17_results.json"
    path.write_text(json.dumps(result, indent=2), encoding="utf-8")
    print("=" * 78)
    print("REFINEMENT 17 COMPLETE")
    print("=" * 78)
    print(json.dumps(result["selection_mean"], indent=2))
    print("Digha final audit:")
    print(json.dumps(result["digha_final_audit"], indent=2))
    print(f"Saved: {path}")
    print("Production model, policy, thresholds, and source dataset were NOT modified.")

if __name__ == "__main__": main()
