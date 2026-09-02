"""ORCA-X Refinement 39 — final ML validation and hardening audit.

This is the final diagnostic gate before the production XGBoost model is frozen.
It does not retrain or overwrite the production model.

Checks:
* unseen 2025 temporal performance;
* per-location and per-month performance;
* HIGH/EXTREME underprediction and confusion patterns;
* current-to-future risk transition matrix;
* geographic feature dependence via controlled coordinate ablation;
* native and sampled permutation feature importance;
* multiclass probability calibration (Brier score + ECE);
* data/feature leakage and production-training-location metadata checks.

Run from the repository root:
    python ml/src/refinement39_final_audit.py

The script expects the current production model and processed historical dataset.
Outputs are written under ml/models/refinement39_audit/.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import xgboost as xgb
from sklearn.inspection import permutation_importance
from sklearn.metrics import (
    accuracy_score,
    balanced_accuracy_score,
    confusion_matrix,
    f1_score,
    log_loss,
    precision_recall_fscore_support,
)

SRC_DIR = Path(__file__).resolve().parent
if str(SRC_DIR) not in sys.path:
    sys.path.insert(0, str(SRC_DIR))

from config import (  # noqa: E402
    FEATURE_COLUMNS,
    MODELS_DIR,
    PROCESSED_DIR,
    RISK_CLASS_NAMES,
    TARGET_COLUMN,
    RISK_HORIZON_HOURS,
)
from label_policy import assign_operational_risk, POLICY_VERSION  # noqa: E402
from train import add_dynamic_features, load_dataset, HOLDOUT_LOCATION  # noqa: E402

RANDOM_STATE = 42
CLASSES = [0, 1, 2, 3]
CLASS_NAMES = [RISK_CLASS_NAMES[i] for i in CLASSES]
AUDIT_DIR = MODELS_DIR / "refinement39_audit"
MODEL_PATH = MODELS_DIR / "orca_xgb_risk.json"
METADATA_PATH = MODELS_DIR / "orca_xgb_risk_metadata.json"
EVALUATION_PATH = MODELS_DIR / "orca_xgb_risk_evaluation.json"


def _json(path: Path) -> dict:
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


def load_model() -> xgb.XGBClassifier:
    if not MODEL_PATH.exists():
        raise FileNotFoundError(f"Production model not found: {MODEL_PATH}")
    model = xgb.XGBClassifier()
    model.load_model(MODEL_PATH)
    return model


def score(y_true: pd.Series, probabilities: np.ndarray) -> dict:
    pred = probabilities.argmax(axis=1)
    report = precision_recall_fscore_support(
        y_true, pred, labels=CLASSES, zero_division=0
    )
    return {
        "rows": int(len(y_true)),
        "accuracy": float(accuracy_score(y_true, pred)),
        "balanced_accuracy": float(balanced_accuracy_score(y_true, pred)),
        "macro_f1": float(f1_score(y_true, pred, average="macro", zero_division=0)),
        "weighted_f1": float(f1_score(y_true, pred, average="weighted", zero_division=0)),
        "critical_recall": float(report[1][3]),
        "critical_miss_rate": float(1.0 - report[1][3]),
        "per_class": {
            CLASS_NAMES[i]: {
                "precision": float(report[0][i]),
                "recall": float(report[1][i]),
                "f1": float(report[2][i]),
                "support": int(report[3][i]),
            }
            for i in range(4)
        },
        "confusion_matrix": confusion_matrix(y_true, pred, labels=CLASSES).tolist(),
    }


def ece_multiclass(y_true: np.ndarray, probabilities: np.ndarray, bins: int = 10) -> float:
    pred = probabilities.argmax(axis=1)
    confidence = probabilities.max(axis=1)
    correct = (pred == y_true).astype(float)
    edges = np.linspace(0.0, 1.0, bins + 1)
    total = len(y_true)
    ece = 0.0
    for left, right in zip(edges[:-1], edges[1:]):
        mask = (confidence >= left) & (confidence < right)
        if right == 1.0:
            mask = mask | (confidence == right)
        if not mask.any():
            continue
        ece += (mask.sum() / total) * abs(confidence[mask].mean() - correct[mask].mean())
    return float(ece)


def calibration(y_true: pd.Series, probabilities: np.ndarray) -> dict:
    y = y_true.to_numpy(dtype=int)
    one_hot = np.eye(4, dtype=float)[y]
    brier = float(np.mean(np.sum((probabilities - one_hot) ** 2, axis=1)))
    return {
        "multiclass_brier_score": brier,
        "log_loss": float(log_loss(y, probabilities, labels=CLASSES)),
        "expected_calibration_error": ece_multiclass(y, probabilities),
        "confidence_mean": float(probabilities.max(axis=1).mean()),
        "confidence_p90": float(np.quantile(probabilities.max(axis=1), 0.90)),
    }


def current_risk(frame: pd.DataFrame) -> pd.Series:
    required = ["wind_speed_kts", "wind_gust_kts", "wave_height_m", "swell_height_m"]
    obs = frame[required].copy()
    observable = obs[["wind_speed_kts", "wave_height_m", "swell_height_m"]].notna().any(axis=1)
    result = pd.Series(np.nan, index=frame.index, dtype=float)
    if observable.any():
        result.loc[observable] = obs.loc[observable].apply(assign_operational_risk, axis=1)
    return result


def transition_audit(frame: pd.DataFrame) -> dict:
    now = current_risk(frame)
    future = frame[TARGET_COLUMN].astype(int)
    mask = now.notna()
    matrix = pd.crosstab(now[mask].astype(int), future[mask].astype(int), dropna=False)
    matrix = matrix.reindex(index=CLASSES, columns=CLASSES, fill_value=0)
    transitions = {
        CLASS_NAMES[i]: {
            CLASS_NAMES[j]: int(matrix.iloc[i, j]) for j in range(4)
        }
        for i in range(4)
    }
    return {
        "rows_with_current_risk": int(mask.sum()),
        "transition_matrix_current_to_future": transitions,
    }


def by_group(frame: pd.DataFrame, probabilities: np.ndarray, column: str) -> dict:
    pred = probabilities.argmax(axis=1)
    work = frame[[column, TARGET_COLUMN]].reset_index(drop=True).copy()
    work["pred"] = pred
    output = {}
    for key, group in work.groupby(column, dropna=False, sort=True):
        if pd.isna(key):
            name = "NA"
        else:
            name = str(key)
        y = group[TARGET_COLUMN].astype(int).to_numpy()
        p = group["pred"].to_numpy()
        output[name] = {
            "rows": int(len(group)),
            "accuracy": float(accuracy_score(y, p)),
            "balanced_accuracy": float(balanced_accuracy_score(y, p)),
            "macro_f1": float(f1_score(y, p, average="macro", zero_division=0)),
            "critical_recall": float(
                precision_recall_fscore_support(y, p, labels=CLASSES, zero_division=0)[1][3]
            ),
        }
    return output


def error_patterns(frame: pd.DataFrame, probabilities: np.ndarray) -> dict:
    pred = probabilities.argmax(axis=1)
    actual = frame[TARGET_COLUMN].astype(int).to_numpy()
    cm = confusion_matrix(actual, pred, labels=CLASSES)
    rows = []
    for actual_id in CLASSES:
        for pred_id in CLASSES:
            if actual_id == pred_id:
                continue
            count = int(cm[actual_id, pred_id])
            if count:
                rows.append({
                    "actual": CLASS_NAMES[actual_id],
                    "predicted": CLASS_NAMES[pred_id],
                    "count": count,
                    "share_of_actual_class": float(count / max(cm[actual_id].sum(), 1)),
                })
    rows.sort(key=lambda r: r["count"], reverse=True)
    critical = [r for r in rows if r["actual"] in {"HIGH", "EXTREME"} and CLASS_NAMES.index(r["predicted"]) < CLASS_NAMES.index(r["actual"])]
    return {
        "top_confusions": rows[:12],
        "critical_underprediction_patterns": critical,
    }


def coordinate_ablation(frame: pd.DataFrame, feature_columns: list[str], model: xgb.XGBClassifier) -> dict:
    X = frame[feature_columns].copy()
    baseline = model.predict_proba(X)
    base_pred = baseline.argmax(axis=1)
    y = frame[TARGET_COLUMN].astype(int)
    base = score(y, baseline)
    med_lat = float(pd.to_numeric(frame["latitude"], errors="coerce").median())
    med_lon = float(pd.to_numeric(frame["longitude"], errors="coerce").median())
    geo = X.copy()
    geo["latitude"] = med_lat
    geo["longitude"] = med_lon
    ablated = model.predict_proba(geo)
    ablated_score = score(y, ablated)
    changed = float(np.mean(base_pred != ablated.argmax(axis=1)))
    return {
        "baseline": base,
        "coordinate_ablated_to_dataset_medians": ablated_score,
        "prediction_change_rate": changed,
        "median_latitude_used": med_lat,
        "median_longitude_used": med_lon,
        "interpretation": "Large performance degradation or prediction changes indicate geographic dependence; this is diagnostic, not proof of leakage.",
    }


def permutation_audit(frame: pd.DataFrame, feature_columns: list[str], model: xgb.XGBClassifier) -> list[dict]:
    sample = frame.sample(min(3000, len(frame)), random_state=RANDOM_STATE)
    X = sample[feature_columns]
    y = sample[TARGET_COLUMN].astype(int)

    # Accuracy is used only as a diagnostic ranking metric; the locked safety metrics
    # remain the primary acceptance criteria.
    result = permutation_importance(
        model,
        X,
        y,
        scoring="balanced_accuracy",
        n_repeats=2,
        random_state=RANDOM_STATE,
        n_jobs=1,
    )
    rows = [
        {
            "feature": feature_columns[i],
            "importance_mean": float(result.importances_mean[i]),
            "importance_std": float(result.importances_std[i]),
        }
        for i in range(len(feature_columns))
    ]
    return sorted(rows, key=lambda r: r["importance_mean"], reverse=True)


def metadata_audit(metadata: dict) -> dict:
    training_locations = metadata.get("training_locations", [])
    return {
        "model_version": metadata.get("model_version"),
        "dataset_version": metadata.get("dataset_version"),
        "risk_policy_version": metadata.get("risk_policy_version"),
        "prediction_horizon_hours": metadata.get("prediction_horizon_hours"),
        "feature_count": metadata.get("feature_count"),
        "training_locations": training_locations,
        "digha_is_in_final_production_training": HOLDOUT_LOCATION in training_locations,
        "warning": (
            "Digha is not a true spatial holdout for the final production model if it appears in training_locations. "
            "Use the frozen R38 spatial-holdout evaluation artifact as the generalization evidence."
            if HOLDOUT_LOCATION in training_locations else
            "Digha is excluded from final production training according to metadata."
        ),
    }


def main() -> None:
    print("=" * 82)
    print("ORCA-X REFINEMENT 39 — FINAL ML VALIDATION & HARDENING AUDIT")
    print("=" * 82)
    print("Diagnostic only: production model, labels and thresholds will NOT be modified.")

    AUDIT_DIR.mkdir(parents=True, exist_ok=True)
    metadata = _json(METADATA_PATH)
    evaluation = _json(EVALUATION_PATH)
    model = load_model()
    raw = load_dataset()
    df, feature_columns = add_dynamic_features(raw)

    if model.get_booster().num_features() != len(feature_columns):
        raise RuntimeError(
            f"Feature contract mismatch: model={model.get_booster().num_features()} dataset={len(feature_columns)}"
        )

    df["month_number"] = pd.to_datetime(df["timestamp"], utc=True).dt.month
    df["year_number"] = pd.to_datetime(df["timestamp"], utc=True).dt.year

    # The locked final temporal test is the full 2025 period. This mirrors R38.
    temporal_test = df[df["year_number"] == 2025].copy()
    if temporal_test.empty:
        raise ValueError("No 2025 rows found; the final temporal test cannot be audited.")
    temporal_prob = model.predict_proba(temporal_test[feature_columns])

    # Per-location and seasonal diagnostics are deliberately descriptive and do not
    # alter the frozen model selection decision.
    per_location = by_group(temporal_test, temporal_prob, "location_id")
    per_month = by_group(temporal_test, temporal_prob, "month_number")
    temporal_score = score(temporal_test[TARGET_COLUMN], temporal_prob)
    errors = error_patterns(temporal_test, temporal_prob)
    transitions = transition_audit(temporal_test)
    calibration_result = calibration(temporal_test[TARGET_COLUMN], temporal_prob)
    geo = coordinate_ablation(temporal_test, feature_columns, model)
    permutation = permutation_audit(temporal_test, feature_columns, model)

    # R38 evaluation remains authoritative for the historical model-selection record.
    frozen_reference = {
        "evaluation_file_present": bool(evaluation),
        "selected_estimators": evaluation.get("selected_estimators"),
        "reference_temporal_test": evaluation.get("model_metrics", {}).get("temporal_test_2025"),
        "reference_digha_holdout": evaluation.get("model_metrics", {}).get("digha_spatial_holdout"),
    }

    leakage_contract = {
        "point_in_time_feature_contract": metadata.get("inference_contract"),
        "missing_data_policy": metadata.get("missing_data_policy"),
        "gust_policy": metadata.get("gust_policy"),
        "risk_policy_version": POLICY_VERSION,
        "forward_target_horizon_hours": int(RISK_HORIZON_HOURS),
        "target_column": TARGET_COLUMN,
        "feature_count": len(feature_columns),
        "target_not_used_as_feature": TARGET_COLUMN not in feature_columns,
        "future_risk_not_used_as_feature": "future_risk" not in feature_columns,
    }

    report = {
        "audit": "ORCA-X Refinement 39 — Final ML Validation & Hardening",
        "status": "DIAGNOSTIC_COMPLETE",
        "model_file": str(MODEL_PATH),
        "model_version": metadata.get("model_version"),
        "dataset_version": metadata.get("dataset_version"),
        "temporal_test_period": "2025-01-01 through 2025-12-31",
        "temporal_test": temporal_score,
        "per_location_2025": per_location,
        "per_month_2025": per_month,
        "error_patterns_2025": errors,
        "risk_transitions_2025": transitions,
        "calibration_2025": calibration_result,
        "coordinate_dependence_audit": geo,
        "sampled_permutation_importance_2025": permutation,
        "metadata_audit": metadata_audit(metadata),
        "leakage_contract_audit": leakage_contract,
        "frozen_r38_reference": frozen_reference,
        "acceptance_guidance": {
            "do_not_optimize_on_2025": True,
            "do_not_change_operational_label_policy": True,
            "primary_safety_metric": "HIGH/EXTREME underprediction on unseen data",
            "finalization_rule": "Freeze the model if no material leakage/generalization defect is found; otherwise make one targeted corrective change and rerun the locked protocol.",
        },
    }

    (AUDIT_DIR / "refinement39_audit.json").write_text(
        json.dumps(report, indent=2, default=float), encoding="utf-8"
    )
    pd.DataFrame(permutation).to_csv(AUDIT_DIR / "permutation_importance_2025.csv", index=False)

    print(f"2025 accuracy:          {temporal_score['accuracy']:.4f}")
    print(f"2025 balanced accuracy: {temporal_score['balanced_accuracy']:.4f}")
    print(f"2025 macro F1:          {temporal_score['macro_f1']:.4f}")
    print(f"2025 critical recall:   {temporal_score['critical_recall']:.4f}")
    print(f"2025 critical miss:     {temporal_score['critical_miss_rate']:.4f}")
    print(f"2025 Brier score:       {calibration_result['multiclass_brier_score']:.6f}")
    print(f"2025 ECE:               {calibration_result['expected_calibration_error']:.6f}")
    print(f"Coordinate ablation prediction change: {geo['prediction_change_rate']:.4f}")
    print(f"Digha in final production training: {metadata_audit(metadata)['digha_is_in_final_production_training']}")

    print("\nTop sampled permutation importance:")
    for row in permutation[:12]:
        print(f"  {row['feature']:<34} mean={row['importance_mean']:.6f} std={row['importance_std']:.6f}")

    print("\nArtifacts:")
    print(f"  {AUDIT_DIR / 'refinement39_audit.json'}")
    print(f"  {AUDIT_DIR / 'permutation_importance_2025.csv'}")
    print("\nRefinement 39 audit complete. No production model changes were made.")


if __name__ == "__main__":
    main()
