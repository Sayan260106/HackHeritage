"""Evaluate the live-trained XGBoost candidate without touching production.

The candidate is trained from historical 2020-2024 data plus matured 2026+
telemetry. This evaluator deliberately scores it only on locked evaluation
periods that were not used for candidate fitting:
  * 2025 temporal test, all non-Digha locations
  * Digha spatial holdout, all available dates

No model promotion happens here. A PASS means the candidate is technically
eligible for manual review, not that it is a safety guarantee.
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd
import xgboost as xgb
from sklearn.metrics import accuracy_score, balanced_accuracy_score, f1_score, log_loss, recall_score

from config import FEATURE_COLUMNS, MODELS_DIR, RISK_CLASS_NAMES
from train import HOLDOUT_LOCATION, TEMPORAL_TEST_END, VALIDATION_END, add_dynamic_features, load_dataset, metrics

CANDIDATE_PATH = MODELS_DIR / "orca_xgb_risk_live_candidate.json"
CANDIDATE_METADATA_PATH = MODELS_DIR / "orca_xgb_risk_live_candidate_metadata.json"
PRODUCTION_PATH = MODELS_DIR / "orca_xgb_risk.json"
PRODUCTION_METADATA_PATH = MODELS_DIR / "orca_xgb_risk_metadata.json"
REPORT_PATH = MODELS_DIR / "orca_xgb_risk_live_candidate_evaluation.json"

MAX_DROPS = {
    "balanced_accuracy": float(__import__("os").getenv("ORCA_CANDIDATE_MAX_BALANCED_ACCURACY_DROP", "0.00")),
    "macro_f1": float(__import__("os").getenv("ORCA_CANDIDATE_MAX_MACRO_F1_DROP", "0.00")),
    "critical_recall": float(__import__("os").getenv("ORCA_CANDIDATE_MAX_CRITICAL_RECALL_DROP", "0.03")),
}


def _load_metadata(path: Path) -> dict:
    if not path.exists():
        raise FileNotFoundError(f"Missing metadata: {path}")
    return json.loads(path.read_text(encoding="utf-8"))


def _metadata_features(metadata: dict) -> list[str]:
    features = metadata.get("features")
    if not isinstance(features, list) or not features or not all(isinstance(x, str) for x in features):
        raise ValueError("Model metadata does not contain a valid feature list.")
    return features


def _score(model: xgb.XGBClassifier, frame: pd.DataFrame, features: list[str]) -> dict:
    x = frame[features]
    y = frame["risk_class"].astype(int)
    pred = model.predict(x).astype(int)
    probability = model.predict_proba(x)
    result = metrics(y, pred)
    result["log_loss"] = float(log_loss(y, probability, labels=[0, 1, 2, 3]))
    result["extreme_recall"] = float(recall_score(y, pred, labels=[3], average="macro", zero_division=0))
    return result


def _compare(candidate: dict, production: dict) -> dict:
    return {
        "balanced_accuracy_delta": float(candidate["balanced_accuracy"] - production["balanced_accuracy"]),
        "macro_f1_delta": float(candidate["macro_f1"] - production["macro_f1"]),
        "critical_recall_delta": float(candidate["critical_recall"] - production["critical_recall"]),
        "accuracy_delta": float(candidate["accuracy"] - production["accuracy"]),
        "log_loss_delta": float(candidate["log_loss"] - production["log_loss"]),
    }


def main() -> None:
    for path in (CANDIDATE_PATH, CANDIDATE_METADATA_PATH, PRODUCTION_PATH, PRODUCTION_METADATA_PATH):
        if not path.exists():
            raise SystemExit(f"Required artifact missing: {path}")

    candidate_metadata = _load_metadata(CANDIDATE_METADATA_PATH)
    production_metadata = _load_metadata(PRODUCTION_METADATA_PATH)
    candidate_features = _metadata_features(candidate_metadata)
    production_features = _metadata_features(production_metadata)

    historical = load_dataset()
    dynamic, dynamic_features = add_dynamic_features(historical)
    if candidate_features != dynamic_features:
        raise SystemExit(
            "Candidate feature contract mismatch: metadata does not exactly match the current point-in-time feature builder."
        )
    if any(feature not in [*FEATURE_COLUMNS, *[f"{c}_missing" for c in FEATURE_COLUMNS],
                           "wind_direction_sin", "wind_direction_cos", "wave_direction_sin",
                           "wave_direction_cos", "swell_direction_sin", "swell_direction_cos",
                           "gust_excess_kts", "gust_to_wind_ratio", "gust_above_gale_kts",
                           "gust_above_extreme_kts"] for feature in candidate_features):
        raise SystemExit("Candidate contains an unsupported feature outside the approved point-in-time contract.")

    temporal = dynamic[
        (dynamic["location_id"] != HOLDOUT_LOCATION)
        & (dynamic["timestamp"] >= VALIDATION_END)
        & (dynamic["timestamp"] < TEMPORAL_TEST_END)
    ].copy()
    digha = dynamic[dynamic["location_id"] == HOLDOUT_LOCATION].copy()
    if temporal.empty or digha.empty:
        raise SystemExit("Locked temporal or spatial evaluation split is empty.")

    candidate = xgb.XGBClassifier()
    candidate.load_model(CANDIDATE_PATH)
    production = xgb.XGBClassifier()
    production.load_model(PRODUCTION_PATH)

    # Legacy production artifacts may still expose the old 14-feature contract;
    # this evaluator honors their metadata rather than silently forcing 44 features.
    for feature in production_features:
        if feature not in dynamic.columns:
            raise SystemExit(f"Production feature {feature!r} is unavailable from the current dataset builder.")

    candidate_temporal = _score(candidate, temporal, candidate_features)
    candidate_digha = _score(candidate, digha, candidate_features)
    production_temporal = _score(production, temporal, production_features)
    production_digha = _score(production, digha, production_features)

    temporal_delta = _compare(candidate_temporal, production_temporal)
    digha_delta = _compare(candidate_digha, production_digha)

    gates = {
        "temporal_balanced_accuracy_not_worse": temporal_delta["balanced_accuracy_delta"] >= -MAX_DROPS["balanced_accuracy"],
        "temporal_macro_f1_not_worse": temporal_delta["macro_f1_delta"] >= -MAX_DROPS["macro_f1"],
        "temporal_extreme_recall_not_worse": temporal_delta["critical_recall_delta"] >= -MAX_DROPS["critical_recall"],
        "digha_balanced_accuracy_not_worse": digha_delta["balanced_accuracy_delta"] >= -MAX_DROPS["balanced_accuracy"],
        "digha_macro_f1_not_worse": digha_delta["macro_f1_delta"] >= -MAX_DROPS["macro_f1"],
        "feature_contract_exact": candidate_features == dynamic_features,
        "candidate_is_not_production_path": CANDIDATE_PATH.name != PRODUCTION_PATH.name,
    }

    report = {
        "candidate": {
            "path": str(CANDIDATE_PATH),
            "metadata": candidate_metadata,
            "features": candidate_features,
        },
        "production": {
            "path": str(PRODUCTION_PATH),
            "metadata": production_metadata,
            "features": production_features,
        },
        "evaluation_protocol": {
            "temporal_test": "2025 non-Digha locations; not used for candidate training",
            "spatial_holdout": "Digha all available dates; excluded from candidate training",
            "promotion": "MANUAL_REVIEW_ONLY",
        },
        "metrics": {
            "temporal_2025": {"candidate": candidate_temporal, "production": production_temporal, "delta": temporal_delta},
            "digha_spatial": {"candidate": candidate_digha, "production": production_digha, "delta": digha_delta},
        },
        "gates": gates,
        "ready_for_manual_promotion_review": bool(all(gates.values())),
        "promotion_performed": False,
        "warning": "Risk labels are operational severity proxies, not incident outcomes or official warnings. Gate PASS does not establish safety guarantees.",
    }
    REPORT_PATH.write_text(json.dumps(report, indent=2, default=float), encoding="utf-8")
    print(json.dumps(report, indent=2, sort_keys=True))
    print(f"Saved candidate evaluation: {REPORT_PATH}")
    if not all(gates.values()):
        raise SystemExit("CANDIDATE EVALUATION: BLOCKED — at least one locked evaluation gate failed.")
    print("CANDIDATE EVALUATION: PASS — candidate is eligible for manual promotion review; production artifact unchanged.")


if __name__ == "__main__":
    main()
