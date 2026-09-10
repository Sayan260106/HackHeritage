"""Frozen ORCA-X model error analysis for the current Refinement 4 pipeline.

Reuses the exact dataset/target/feature construction from train.py. It never
re-trains the model, changes the label policy, or overwrites the production
model.

Run from the repository root:
    python ml/src/analyze_model_errors.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import xgboost as xgb
from sklearn.metrics import (
    accuracy_score,
    balanced_accuracy_score,
    classification_report,
    confusion_matrix,
    f1_score,
    precision_recall_fscore_support,
)

SRC_DIR = Path(__file__).resolve().parent
if str(SRC_DIR) not in sys.path:
    sys.path.insert(0, str(SRC_DIR))

from config import MODELS_DIR, PROCESSED_DIR, RISK_CLASS_NAMES, TARGET_COLUMN  # noqa: E402
from train import HOLDOUT_LOCATION, add_dynamic_features, load_dataset  # noqa: E402

RANDOM_STATE = 42
CLASSES = [0, 1, 2, 3]
RISK_ORDER = [RISK_CLASS_NAMES[i] for i in CLASSES]
SHAP_SAMPLE_SIZE = 5000


def label(class_id: int) -> str:
    return RISK_CLASS_NAMES.get(int(class_id), str(class_id))


def load_model() -> xgb.XGBClassifier:
    path = MODELS_DIR / "orca_xgb_risk.json"
    if not path.exists():
        raise FileNotFoundError(
            f"Production model not found: {path}\nRun train.py first."
        )
    model = xgb.XGBClassifier()
    model.load_model(path)
    return model


def native_feature_importance(model: xgb.XGBClassifier, feature_columns: list[str]) -> pd.DataFrame:
    booster = model.get_booster()
    gain = booster.get_score(importance_type="gain")
    weight = booster.get_score(importance_type="weight")
    rows = []
    for index, feature in enumerate(feature_columns):
        gain_value = gain.get(feature, gain.get(f"f{index}", 0.0))
        weight_value = weight.get(feature, weight.get(f"f{index}", 0.0))
        rows.append({"feature": feature, "gain": float(gain_value), "split_count": int(weight_value)})
    result = pd.DataFrame(rows)
    total = result["gain"].sum()
    result["gain_fraction"] = result["gain"] / total if total else 0.0
    return result.sort_values("gain", ascending=False).reset_index(drop=True)


def compute_shap(model: xgb.XGBClassifier, X: pd.DataFrame, feature_columns: list[str]):
    import shap

    sample = X.sample(min(SHAP_SAMPLE_SIZE, len(X)), random_state=RANDOM_STATE)
    explainer = shap.TreeExplainer(model)
    values = explainer.shap_values(sample)

    if isinstance(values, list):
        class_values = [np.asarray(v) for v in values]
    else:
        arr = np.asarray(values)
        if arr.ndim == 3 and arr.shape[0] == len(sample) and arr.shape[1] == len(feature_columns):
            class_values = [arr[:, :, c] for c in range(arr.shape[2])]
        elif arr.ndim == 3 and arr.shape[1] == len(sample) and arr.shape[2] == len(feature_columns):
            class_values = [arr[c, :, :] for c in range(arr.shape[0])]
        else:
            raise RuntimeError(f"Unsupported SHAP output shape: {arr.shape}")

    class_values = class_values[: len(CLASSES)]
    global_scores = np.zeros(len(feature_columns), dtype=float)
    class_rows = []
    for class_id, matrix in enumerate(class_values):
        scores = np.mean(np.abs(matrix), axis=0)
        global_scores += scores
        for feature, score in zip(feature_columns, scores):
            class_rows.append({"class_id": class_id, "class": label(class_id), "feature": feature, "mean_abs_shap": float(score)})
    global_scores /= max(len(class_values), 1)
    global_df = pd.DataFrame({"feature": feature_columns, "mean_abs_shap": global_scores}).sort_values("mean_abs_shap", ascending=False).reset_index(drop=True)
    class_df = pd.DataFrame(class_rows).sort_values(["class_id", "mean_abs_shap"], ascending=[True, False]).reset_index(drop=True)
    return global_df, class_df


def make_error_table(df: pd.DataFrame, predictions: np.ndarray, probabilities: np.ndarray) -> pd.DataFrame:
    """Attach predictions to a split without assuming a non-existent future_risk column.

    train.load_dataset() constructs the forward target and stores it in
    config.TARGET_COLUMN (currently risk_class). Keeping this reference tied to
    TARGET_COLUMN prevents analyzer/train target-name drift.
    """
    out = df.reset_index(drop=True).copy()
    if TARGET_COLUMN not in out.columns:
        raise RuntimeError(
            f"Target column {TARGET_COLUMN!r} is missing after train.py dataset construction."
        )
    out["actual_class"] = out[TARGET_COLUMN].astype(int)
    out["actual_label"] = out["actual_class"].map(label)
    out["predicted_class"] = predictions.astype(int)
    out["predicted_label"] = out["predicted_class"].map(label)
    out["correct"] = out["actual_class"] == out["predicted_class"]
    out["predicted_probability"] = probabilities.max(axis=1)
    out["actual_probability"] = probabilities[np.arange(len(out)), out["actual_class"].to_numpy()]
    sorted_probs = np.sort(probabilities, axis=1)
    out["margin_top1_top2"] = sorted_probs[:, -1] - sorted_probs[:, -2]
    out["severity_gap"] = out["predicted_class"] - out["actual_class"]
    out["underprediction"] = out["severity_gap"] < 0
    out["overprediction"] = out["severity_gap"] > 0
    out["critical_underprediction"] = (
        (out["actual_class"] >= 2) & (out["predicted_class"] < out["actual_class"])
    )
    return out


def evaluate_split(name: str, y: pd.Series, probabilities: np.ndarray) -> dict:
    pred = probabilities.argmax(axis=1)
    return {
        "split": name,
        "rows": int(len(y)),
        "accuracy": float(accuracy_score(y, pred)),
        "balanced_accuracy": float(balanced_accuracy_score(y, pred)),
        "macro_f1": float(f1_score(y, pred, average="macro", zero_division=0)),
        "weighted_f1": float(f1_score(y, pred, average="weighted", zero_division=0)),
        "classification_report": classification_report(y, pred, labels=CLASSES, target_names=RISK_ORDER, output_dict=True, zero_division=0),
        "confusion_matrix": confusion_matrix(y, pred, labels=CLASSES).tolist(),
    }


def main() -> None:
    print("=" * 78)
    print("ORCA-X MODEL ERROR ANALYSIS — REFINEMENT 4")
    print("=" * 78)
    print("Using the exact forward-target and point-in-time feature contract from train.py.")
    print("No retraining, label-policy changes, or production-model changes are performed.")

    raw = load_dataset()
    df, feature_columns = add_dynamic_features(raw)
    model = load_model()

    expected = int(model.get_booster().num_features())
    if expected != len(feature_columns):
        raise RuntimeError(
            f"Feature contract mismatch: model expects {expected} features, but train.py currently constructs {len(feature_columns)}. "
            "Do not analyze until the production model and training code are aligned."
        )

    train_pool = df[df["location_id"] != HOLDOUT_LOCATION].sort_values("timestamp").copy()
    digha = df[df["location_id"] == HOLDOUT_LOCATION].copy()
    if digha.empty:
        raise ValueError(f"Spatial holdout {HOLDOUT_LOCATION!r} is missing.")

    n = len(train_pool)
    validation_start = int(n * 0.70)
    validation_end = int(n * 0.85)
    temporal_validation = train_pool.iloc[validation_start:validation_end].copy()

    splits = {"all_data": df, "temporal_validation": temporal_validation, "digha_spatial_holdout": digha}
    split_results = {}
    error_frames = []

    for name, split in splits.items():
        X = split[feature_columns]
        y = split[TARGET_COLUMN].astype(int)
        probabilities = model.predict_proba(X)
        predictions = probabilities.argmax(axis=1)
        split_results[name] = evaluate_split(name, y, probabilities)
        errors = make_error_table(split, predictions, probabilities)
        errors["evaluation_split"] = name
        error_frames.append(errors)

    errors_all = pd.concat(error_frames, ignore_index=True)
    misclassified = errors_all[~errors_all["correct"]].copy().sort_values(
        ["critical_underprediction", "margin_top1_top2", "predicted_probability"],
        ascending=[False, True, True],
    )

    output_dir = MODELS_DIR / "error_analysis"
    output_dir.mkdir(parents=True, exist_ok=True)
    misclassified.to_csv(output_dir / "misclassified_rows.csv", index=False)

    native = native_feature_importance(model, feature_columns)
    native.to_csv(output_dir / "feature_importance.csv", index=False)

    digha_errors = errors_all[errors_all["evaluation_split"] == "digha_spatial_holdout"]
    severe = digha_errors["actual_class"] >= 2
    critical = digha_errors["critical_underprediction"]
    error_summary = {
        "all_rows_analyzed": int(len(df)),
        "all_misclassified_rows": int((~errors_all["correct"]).sum()),
        "digha_misclassified_rows": int((~digha_errors["correct"]).sum()),
        "digha_critical_underpredictions": int(critical.sum()),
        "digha_critical_underprediction_rate": float(critical.sum() / max(severe.sum(), 1)),
        "digha_underpredictions": int(digha_errors["underprediction"].sum()),
        "digha_overpredictions": int(digha_errors["overprediction"].sum()),
    }

    precision, recall, f1, support = precision_recall_fscore_support(
        digha_errors["actual_class"], digha_errors["predicted_class"], labels=CLASSES, zero_division=0,
    )
    error_summary["digha_per_class"] = {
        label(c): {"precision": float(precision[i]), "recall": float(recall[i]), "f1": float(f1[i]), "support": int(support[i])}
        for i, c in enumerate(CLASSES)
    }

    shap_status = {"available": False, "error": None}
    try:
        shap_global, shap_class = compute_shap(model, df[feature_columns], feature_columns)
        shap_global.to_csv(output_dir / "shap_feature_importance.csv", index=False)
        shap_class.to_csv(output_dir / "shap_class_importance.csv", index=False)
        shap_status["available"] = True
    except Exception as exc:
        shap_status["error"] = f"{type(exc).__name__}: {exc}"
        print(f"SHAP analysis skipped: {shap_status['error']}")

    results = {
        "analysis": "frozen_model_error_analysis_refinement_4",
        "dataset_file": str(PROCESSED_DIR / "orca_historical_marine_risk.parquet"),
        "model_file": str(MODELS_DIR / "orca_xgb_risk.json"),
        "target_column": TARGET_COLUMN,
        "feature_count": len(feature_columns),
        "features": feature_columns,
        "holdout_location": HOLDOUT_LOCATION,
        "splits": split_results,
        "error_summary": error_summary,
        "native_feature_importance": native.to_dict(orient="records"),
        "shap": shap_status,
        "safety_note": "Diagnostic only. Do not change the operational label policy solely to improve class balance. Prioritize HIGH/EXTREME underprediction on unseen holdouts.",
    }
    if shap_status["available"]:
        results["shap_global_importance"] = shap_global.to_dict(orient="records")
        results["shap_class_importance"] = shap_class.to_dict(orient="records")

    (output_dir / "error_analysis.json").write_text(json.dumps(results, indent=2, default=float), encoding="utf-8")

    print()
    for name, metrics in split_results.items():
        print(f"{name:24s}: rows={metrics['rows']:,} accuracy={metrics['accuracy']:.4f} balanced_accuracy={metrics['balanced_accuracy']:.4f} macro_f1={metrics['macro_f1']:.4f}")
    print(f"Digha critical underpredictions: {error_summary['digha_critical_underpredictions']:,}")
    print(f"Digha critical-underprediction rate: {error_summary['digha_critical_underprediction_rate']:.4f}")

    print("\nTop native feature importance by gain:")
    for row in native.head(10).itertuples(index=False):
        print(f"  {row.feature:<34} gain_fraction={row.gain_fraction:.6f}")

    print("\nArtifacts:")
    for path in sorted(output_dir.iterdir()):
        print(f"  {path}")
    print("\nAnalysis complete. Production model and risk policy were not modified.")


if __name__ == "__main__":
    main()
