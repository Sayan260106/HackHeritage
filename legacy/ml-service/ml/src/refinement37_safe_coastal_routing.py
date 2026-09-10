"""ORCA-X Refinement 37 — Safe Coastal Expert Routing.

Benchmark-only follow-up to R36.

R36 established that a coast-specific expert was better than the pooled global
model on most held-out coasts, but also showed that adaptation did not beat the
local expert and that Goa was a counterexample. R37 therefore asks the safer
production question: can we route to a local expert only when a frozen,
pre-test calibration set says the expert is safe to use?

Protocol
--------
* Fit global and coast-specific experts on the first 80% of 2024.
* Use only the final 20% of 2024 for routing calibration.
* Freeze every route before 2025 is evaluated.
* Route scope is coast x degradation scenario.
* Unknown coasts and unknown scenarios always use the global model.
* The safe gate requires expert utility to improve over global while also
  satisfying explicit critical-recall, false-escalation, and MAE guardrails.
* A pre-registered R36-informed fixed policy is reported as a reference only;
  it is not used to select the production candidate because its membership was
  motivated by R36's 2025 benchmark results.
* The 2025 period is touched only for final evaluation.

No production model, threshold, risk policy, inference path, or artifact is
modified by this script.
"""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path

import numpy as np
import pandas as pd

HERE = Path(__file__).resolve()
ML_ROOT = HERE.parents[1]
SRC = HERE.parent
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

import refinement34_hybrid_coastal_routing as r34

OUTPUT_DIR = ML_ROOT / "models" / "refinement37"
RANDOM_STATE = 3700
MIN_CALIBRATION_ROWS = 200
MIN_UTILITY_GAIN = 0.0
CRITICAL_RECALL_TOLERANCE = 0.01
FALSE_ESCALATION_TOLERANCE = 0.02
MAE_MULTIPLIER = 1.10

# This is deliberately treated as a reference diagnostic, not a selection rule.
R36_REFERENCE_GLOBAL = {"goa"}


def safe_gate(global_m: dict, expert_m: dict) -> tuple[bool, dict]:
    global_u = r34.router_utility(global_m)
    expert_u = r34.router_utility(expert_m)
    checks = {
        "utility_gain": expert_u - global_u,
        "critical_recall_delta": expert_m["critical_recall"] - global_m["critical_recall"],
        "false_escalation_delta": expert_m["false_escalation_rate"] - global_m["false_escalation_rate"],
        "mae_ratio": expert_m["mean_mae"] / max(global_m["mean_mae"], 1e-12),
    }
    checks["utility_ok"] = checks["utility_gain"] >= MIN_UTILITY_GAIN
    checks["critical_recall_ok"] = checks["critical_recall_delta"] >= -CRITICAL_RECALL_TOLERANCE
    checks["false_escalation_ok"] = checks["false_escalation_delta"] <= FALSE_ESCALATION_TOLERANCE
    checks["mae_ok"] = checks["mae_ratio"] <= MAE_MULTIPLIER
    checks["safe"] = all(checks[k] for k in ("utility_ok", "critical_recall_ok", "false_escalation_ok", "mae_ok"))
    return bool(checks["safe"]), checks


def calibrate_safe_routes(global_models, experts, calibration: pd.DataFrame):
    routes = {}
    rows = []
    for si, scenario in enumerate(r34.SCENARIOS):
        frame = r34.degrade(calibration, scenario, 137000 + si)
        actual = r34.target_values(frame)
        gp = r34.predict_multioutput(global_models, frame)
        ep, known = r34.predict_experts(experts, frame)
        for location in sorted(frame[r34.LOCATION_COLUMN].astype(str).unique()):
            mask = (frame[r34.LOCATION_COLUMN].astype(str).to_numpy() == location) & known
            if int(mask.sum()) < MIN_CALIBRATION_ROWS:
                routes[(location, scenario)] = "global"
                rows.append({"location": location, "scenario": scenario, "selected": "global",
                             "reason": "insufficient_calibration_rows", "calibration_rows": int(mask.sum())})
                continue
            gm = r34.metrics(actual[mask], gp[mask])
            em = r34.metrics(actual[mask], ep[mask])
            safe, checks = safe_gate(gm, em)
            selected = "expert" if safe else "global"
            routes[(location, scenario)] = selected
            rows.append({
                "location": location, "scenario": scenario, "selected": selected,
                "calibration_rows": int(mask.sum()),
                "global_utility": r34.router_utility(gm),
                "expert_utility": r34.router_utility(em),
                **checks,
                "global_critical_recall": gm["critical_recall"],
                "expert_critical_recall": em["critical_recall"],
                "global_false_escalation_rate": gm["false_escalation_rate"],
                "expert_false_escalation_rate": em["false_escalation_rate"],
                "global_mean_mae": gm["mean_mae"],
                "expert_mean_mae": em["mean_mae"],
            })
    return routes, pd.DataFrame(rows)


def apply_safe_router(global_models, experts, frame, scenario, routes):
    gp = r34.predict_multioutput(global_models, frame)
    ep, known = r34.predict_experts(experts, frame)
    out = gp.copy()
    used = np.zeros(len(frame), dtype=bool)
    locations = frame[r34.LOCATION_COLUMN].astype(str).to_numpy()
    for i, location in enumerate(locations):
        if known[i] and routes.get((location, scenario), "global") == "expert":
            out[i] = ep[i]
            used[i] = True
    return out, used


def apply_fixed_reference(global_models, experts, frame, scenario):
    """R36-informed reference policy; never used for calibration/model selection."""
    gp = r34.predict_multioutput(global_models, frame)
    ep, known = r34.predict_experts(experts, frame)
    out = gp.copy()
    used = np.zeros(len(frame), dtype=bool)
    locations = frame[r34.LOCATION_COLUMN].astype(str).to_numpy()
    for i, location in enumerate(locations):
        if known[i] and location not in R36_REFERENCE_GLOBAL:
            out[i] = ep[i]
            used[i] = True
    return out, used


def evaluate(test, global_models, experts, safe_routes):
    rows = []
    for si, scenario in enumerate(r34.SCENARIOS):
        frame = r34.degrade(test, scenario, 139000 + si)
        actual = r34.target_values(frame)
        gp = r34.predict_multioutput(global_models, frame)
        ep, _ = r34.predict_experts(experts, frame)
        sp, safe_used = apply_safe_router(global_models, experts, frame, scenario, safe_routes)
        fp, fixed_used = apply_fixed_reference(global_models, experts, frame, scenario)
        for strategy, pred, used in [
            ("global", gp, np.zeros(len(frame), dtype=bool)),
            ("local_expert", ep, np.ones(len(frame), dtype=bool)),
            ("fixed_r36_reference", fp, fixed_used),
            ("safe_router", sp, safe_used),
        ]:
            m = r34.metrics(actual, pred)
            rows.append({"scope": "temporal_2025", "strategy": strategy,
                         "scenario": scenario, "route_expert_rate": float(used.mean()), **m})
            if strategy == "safe_router":
                locations = frame[r34.LOCATION_COLUMN].astype(str).to_numpy()
                for location in sorted(set(locations)):
                    mask = locations == location
                    lm = r34.metrics(actual[mask], pred[mask])
                    rows.append({"scope": "temporal_2025_by_location", "strategy": strategy,
                                 "scenario": scenario, "location": location,
                                 "route_expert_rate": float(used[mask].mean()), **lm})
    return pd.DataFrame(rows)


def summary(table: pd.DataFrame) -> pd.DataFrame:
    out = []
    for strategy in ["global", "local_expert", "fixed_r36_reference", "safe_router"]:
        sub = table[(table.scope == "temporal_2025") & (table.strategy == strategy)]
        if sub.empty:
            continue
        clean = sub[sub.scenario == "clean"].iloc[0]
        stress = sub[sub.scenario != "clean"]
        a = stress.mean(numeric_only=True)
        score = r34.router_utility({"critical_recall": a.critical_recall,
                                    "balanced_accuracy": a.balanced_accuracy,
                                    "accuracy": a.accuracy,
                                    "false_escalation_rate": a.false_escalation_rate,
                                    "mean_mae": a.mean_mae})
        out.append({"strategy": strategy,
                    "clean_accuracy": clean.accuracy,
                    "clean_critical_recall": clean.critical_recall,
                    "clean_mean_mae": clean.mean_mae,
                    "stress_accuracy": a.accuracy,
                    "stress_balanced_accuracy": a.balanced_accuracy,
                    "stress_macro_f1": a.macro_f1,
                    "stress_critical_recall": a.critical_recall,
                    "stress_critical_miss_rate": a.critical_miss_rate,
                    "stress_false_escalation_rate": a.false_escalation_rate,
                    "stress_mean_mae": a.mean_mae,
                    "stress_mean_r2": a.mean_r2,
                    "benchmark_score": score,
                    "mean_route_expert_rate": a.route_expert_rate})
    return pd.DataFrame(out).sort_values("benchmark_score", ascending=False).reset_index(drop=True)


def main() -> None:
    started = time.perf_counter()
    print("=" * 92)
    print("ORCA-X REFINEMENT 37 — SAFE COASTAL EXPERT ROUTING")
    print(f"Device={r34.device_name()} | n_jobs={r34.n_jobs()}")
    print("Safety gate:", {
        "min_utility_gain": MIN_UTILITY_GAIN,
        "critical_recall_tolerance": CRITICAL_RECALL_TOLERANCE,
        "false_escalation_tolerance": FALSE_ESCALATION_TOLERANCE,
        "mae_multiplier": MAE_MULTIPLIER,
        "min_calibration_rows": MIN_CALIBRATION_ROWS,
    })

    df = r34.load_pairs()
    fit, calibration, test = r34.chronological_splits(df)
    print(f"Rows={len(df):,} | fit_2024={len(fit):,} | calibration_2024={len(calibration):,} | test_2025={len(test):,}")
    locations = sorted(df[r34.LOCATION_COLUMN].astype(str).unique())
    print(f"Locations={locations}")
    print(f"Scenarios={len(r34.SCENARIOS)}")

    print("[1/4] Training global model...")
    global_models = r34.fit_multioutput(fit, 0)
    print("[2/4] Training coast-specific experts...")
    experts = r34.fit_experts(fit)
    print("[3/4] Calibrating frozen safety-gated routes on late 2024...")
    routes, calibration_table = calibrate_safe_routes(global_models, experts, calibration)
    print("[4/4] Evaluating frozen policies on untouched 2025...")
    results = evaluate(test, global_models, experts, routes)
    summaries = summary(results)

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    results.to_csv(OUTPUT_DIR / "temporal_2025_routing_results.csv", index=False)
    calibration_table.to_csv(OUTPUT_DIR / "routing_calibration.csv", index=False)
    summaries.to_csv(OUTPUT_DIR / "strategy_summary.csv", index=False)
    route_rows = [{"location": k[0], "scenario": k[1], "selected": v} for k, v in sorted(routes.items())]
    pd.DataFrame(route_rows).to_csv(OUTPUT_DIR / "frozen_routes.csv", index=False)
    metadata = {
        "refinement": "R37",
        "name": "safe_coastal_expert_routing",
        "production_modified": False,
        "test_period": "2025",
        "fit_period": "first_80_percent_of_2024",
        "calibration_period": "last_20_percent_of_2024",
        "routing_scope": "location_x_scenario",
        "unknown_location_fallback": "global",
        "unknown_scenario_fallback": "global",
        "safety_gate": {
            "min_utility_gain": MIN_UTILITY_GAIN,
            "critical_recall_tolerance": CRITICAL_RECALL_TOLERANCE,
            "false_escalation_tolerance": FALSE_ESCALATION_TOLERANCE,
            "mae_multiplier": MAE_MULTIPLIER,
            "min_calibration_rows": MIN_CALIBRATION_ROWS,
        },
        "reference_policy": "local_expert_except_goa",
        "reference_policy_selection_allowed": False,
    }
    (OUTPUT_DIR / "benchmark_metadata.json").write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")

    print("\nR37 STRATEGY SUMMARY")
    print(summaries.to_string(index=False))
    print("\nFrozen route counts:")
    print(calibration_table["selected"].value_counts(dropna=False).to_string())
    print(f"\nREFINEMENT 37 COMPLETE in {time.perf_counter() - started:.1f}s")
    print(f"Outputs: {OUTPUT_DIR}")


if __name__ == "__main__":
    main()
