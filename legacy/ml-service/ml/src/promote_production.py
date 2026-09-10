"""Promote the reviewed ORCA-X v2.6 model without touching held-out test data.

This script is intentionally separate from train.py evaluation. It uses the
already selected estimator count from the R38 2024 validation run, then fits
production on every operational location through the end of 2024. The 2025
temporal test and Digha spatial evaluation remain completely outside this fit.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np

ML_SRC = Path(__file__).resolve().parent
if str(ML_SRC) not in sys.path:
    sys.path.insert(0, str(ML_SRC))

from config import MODELS_DIR, RISK_HORIZON_HOURS  # noqa: E402
from train import (  # noqa: E402
    MODEL_VERSION,
    VALIDATION_END,
    _production_metadata,
    _training_device,
    _training_n_jobs,
    class_weights,
    load_dataset,
    add_dynamic_features,
    make_model,
)

EVALUATION_PATH = MODELS_DIR / "orca_xgb_risk_evaluation.json"
MODEL_PATH = MODELS_DIR / "orca_xgb_risk.json"
METADATA_PATH = MODELS_DIR / "orca_xgb_risk_metadata.json"


def main() -> None:
    if not EVALUATION_PATH.exists():
        raise FileNotFoundError(
            "R38 evaluation report is missing. Run train.py in evaluation-only mode first."
        )

    evaluation = json.loads(EVALUATION_PATH.read_text(encoding="utf-8"))
    selected_estimators = int(evaluation["selected_estimators"])
    if selected_estimators < 100:
        raise ValueError(f"Invalid selected estimator count: {selected_estimators}")

    final_test = evaluation["model_metrics"]["temporal_test_2025"]
    digha_test = evaluation["model_metrics"]["digha_spatial_holdout"]
    if evaluation.get("final_temporal_test_period") != "2025":
        raise ValueError("Promotion requires the R38 2025 final temporal test record.")
    if evaluation.get("model_selection_period") != "2024":
        raise ValueError("Promotion requires model selection to be based on 2024 validation.")

    print("ORCA-X production promotion")
    print(f"Model version: {MODEL_VERSION}")
    print(f"Selected estimators: {selected_estimators}")
    print(f"R38 2025 temporal-test accuracy: {final_test['accuracy']:.4f}")
    print(f"R38 2025 temporal-test macro F1: {final_test['macro_f1']:.4f}")
    print(f"R38 2025 critical recall: {final_test['critical_recall']:.4f}")
    print(f"R38 Digha spatial-holdout accuracy: {digha_test['accuracy']:.4f}")

    df = load_dataset()
    df, feature_columns = add_dynamic_features(df)

    # Production fit uses all operational locations, but only labels whose
    # six-hour target is still inside the 2020-2024 training horizon.
    production_cutoff = VALIDATION_END - __import__("pandas").Timedelta(
        hours=int(RISK_HORIZON_HOURS)
    )
    production_df = df[df["timestamp"] < production_cutoff].copy()
    if production_df.empty:
        raise ValueError("No production rows remain before the 2025 boundary.")

    expected_locations = sorted(df["location_id"].unique().tolist())
    actual_locations = sorted(production_df["location_id"].unique().tolist())
    if actual_locations != expected_locations:
        raise ValueError(
            f"Production fit does not contain all locations: expected {expected_locations}, got {actual_locations}"
        )
    if production_df["timestamp"].max() >= VALIDATION_END:
        raise ValueError("Production fit contains post-2024 prediction origins.")

    print(f"Production rows: {len(production_df):,}")
    print(f"Production locations: {actual_locations}")
    print(
        "Production target-origin period: "
        f"{production_df['timestamp'].min().isoformat()} through "
        f"{production_df['timestamp'].max().isoformat()}"
    )

    weights = class_weights(production_df["risk_class"])
    model = make_model(n_estimators=selected_estimators)
    model.fit(
        production_df[feature_columns],
        production_df["risk_class"],
        sample_weight=production_df["risk_class"]
        .map(weights)
        .to_numpy(dtype=np.float32),
        verbose=100,
    )

    MODELS_DIR.mkdir(parents=True, exist_ok=True)
    model.save_model(MODEL_PATH)

    metadata = _production_metadata(
        feature_columns=feature_columns,
        production_weights=weights,
        final_model=model,
        evaluation=evaluation,
        training_locations=actual_locations,
        device=_training_device(),
    )
    metadata["production_training_period"] = (
        "2020-01-01 through 2024-12-31 17:00 UTC"
    )
    metadata["production_training_rows"] = int(len(production_df))
    metadata["digha_excluded_from_training"] = False
    metadata["production_includes_all_operational_locations"] = True
    metadata["production_promotion_source"] = "R38 reviewed evaluation; 2025 temporal test and Digha holdout excluded from fit"

    METADATA_PATH.write_text(json.dumps(metadata, indent=2, default=float), encoding="utf-8")

    print(f"PROMOTED: {MODEL_PATH}")
    print(f"METADATA: {METADATA_PATH}")
    print("Production model includes all six operational locations through 2024.")
    print("2025 temporal test and Digha holdout were not used for fitting.")


if __name__ == "__main__":
    main()
