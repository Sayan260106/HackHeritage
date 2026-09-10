"""Temporal evaluation for the ORCA-X XGBoost marine-risk model.

Training:
    2024 observations

Unseen test:
    2025 observations

This evaluation is intentionally separate from train.py so that the
baseline model remains untouched.
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
    classification_report,
    confusion_matrix,
    f1_score,
)

# Allow imports from ml/src when running:
# python ml/src/evaluate_temporal.py
SRC_DIR = Path(__file__).resolve().parent

if str(SRC_DIR) not in sys.path:
    sys.path.insert(0, str(SRC_DIR))

from config import (  # noqa: E402
    FEATURE_COLUMNS,
    PROCESSED_DIR,
    TARGET_COLUMN,
    MODELS_DIR,
)
from label_policy import RISK_CLASS_NAMES  # noqa: E402


RANDOM_STATE = 42

TRAIN_YEAR = 2024
TEST_YEAR = 2025


def load_dataset() -> pd.DataFrame:
    """Load and validate the processed dataset."""

    path = PROCESSED_DIR / "ndbc_marine_risk.parquet"

    if not path.exists():
        raise FileNotFoundError(
            f"Dataset not found: {path}\n"
            "Run prepare_dataset.py first."
        )

    print(f"Loading dataset: {path}")

    df = pd.read_parquet(path)

    required_columns = [
        "timestamp",
        *FEATURE_COLUMNS,
        TARGET_COLUMN,
    ]

    missing = [
        column
        for column in required_columns
        if column not in df.columns
    ]

    if missing:
        raise ValueError(
            f"Dataset is missing required columns: {missing}"
        )

    df = df.copy()

    df["timestamp"] = pd.to_datetime(
        df["timestamp"],
        errors="coerce",
        utc=True,
    )

    df = df.dropna(
        subset=["timestamp", TARGET_COLUMN]
    )

    df["year"] = df["timestamp"].dt.year

    return df


def print_distribution(
    name: str,
    y: pd.Series,
) -> None:
    """Print class counts and percentages."""

    counts = (
        y.value_counts()
        .sort_index()
    )

    percentages = (
        y.value_counts(normalize=True)
        .sort_index()
        * 100
    )

    print()
    print(f"{name} distribution:")

    for class_id in [0, 1, 2, 3]:

        count = int(
            counts.get(class_id, 0)
        )

        percentage = float(
            percentages.get(class_id, 0.0)
        )

        label = RISK_CLASS_NAMES[class_id]

        print(
            f"  {class_id} "
            f"{label:<10} "
            f"{count:>8,} "
            f"({percentage:>6.2f}%)"
        )


def calculate_class_weights(
    y: pd.Series,
) -> dict[int, float]:
    """Calculate balanced class weights from training data."""

    counts = (
        y.value_counts()
        .sort_index()
    )

    total = len(y)
    n_classes = len(counts)

    return {
        int(class_id): total / (n_classes * count)
        for class_id, count in counts.items()
    }


def make_sample_weights(
    y: pd.Series,
    class_weights: dict[int, float],
) -> np.ndarray:
    return np.asarray(
        [
            class_weights[int(label)]
            for label in y
        ],
        dtype=np.float32,
    )


def evaluate(
    model: xgb.XGBClassifier,
    X_test: pd.DataFrame,
    y_test: pd.Series,
) -> dict:
    """Evaluate the temporally unseen test set."""

    predictions = model.predict(X_test)

    accuracy = accuracy_score(
        y_test,
        predictions,
    )

    macro_f1 = f1_score(
        y_test,
        predictions,
        average="macro",
        zero_division=0,
    )

    weighted_f1 = f1_score(
        y_test,
        predictions,
        average="weighted",
        zero_division=0,
    )

    report = classification_report(
        y_test,
        predictions,
        labels=[0, 1, 2, 3],
        target_names=[
            RISK_CLASS_NAMES[0],
            RISK_CLASS_NAMES[1],
            RISK_CLASS_NAMES[2],
            RISK_CLASS_NAMES[3],
        ],
        output_dict=True,
        zero_division=0,
    )

    confusion = confusion_matrix(
        y_test,
        predictions,
        labels=[0, 1, 2, 3],
    )

    print()
    print("=" * 70)
    print("TEMPORAL TEST EVALUATION")
    print("=" * 70)

    print()
    print(f"Accuracy:    {accuracy:.4f}")
    print(f"Macro F1:    {macro_f1:.4f}")
    print(f"Weighted F1: {weighted_f1:.4f}")

    print()
    print("Classification report:")
    print(
        classification_report(
            y_test,
            predictions,
            labels=[0, 1, 2, 3],
            target_names=[
                RISK_CLASS_NAMES[0],
                RISK_CLASS_NAMES[1],
                RISK_CLASS_NAMES[2],
                RISK_CLASS_NAMES[3],
            ],
            zero_division=0,
        )
    )

    print("Confusion matrix:")
    print(confusion)

    print()
    print("Risk-class recall:")

    for class_id in [0, 1, 2, 3]:

        label = RISK_CLASS_NAMES[class_id]

        recall = report[label]["recall"]

        print(
            f"  {label:<10}: "
            f"{recall:.4f}"
        )

    return {
        "accuracy": float(accuracy),
        "macro_f1": float(macro_f1),
        "weighted_f1": float(weighted_f1),
        "classification_report": report,
        "confusion_matrix": confusion.tolist(),
    }


def main() -> None:

    print("=" * 70)
    print("ORCA-X TEMPORAL MODEL EVALUATION")
    print("=" * 70)

    print()
    print(
        f"Training period: {TRAIN_YEAR}"
    )

    print(
        f"Unseen test period: {TEST_YEAR}"
    )

    # --------------------------------------------------------------
    # Load data
    # --------------------------------------------------------------

    df = load_dataset()

    print()
    print(
        f"Total dataset rows: {len(df):,}"
    )

    print()
    print("Available years:")

    print(
        df["year"]
        .value_counts()
        .sort_index()
        .to_string()
    )

    # --------------------------------------------------------------
    # Temporal split
    # --------------------------------------------------------------

    train_df = df[
        df["year"] == TRAIN_YEAR
    ].copy()

    test_df = df[
        df["year"] == TEST_YEAR
    ].copy()

    if train_df.empty:
        raise ValueError(
            f"No training observations found for {TRAIN_YEAR}."
        )

    if test_df.empty:
        raise ValueError(
            f"No test observations found for {TEST_YEAR}."
        )

    X_train = train_df[
        FEATURE_COLUMNS
    ]

    y_train = train_df[
        TARGET_COLUMN
    ].astype(int)

    X_test = test_df[
        FEATURE_COLUMNS
    ]

    y_test = test_df[
        TARGET_COLUMN
    ].astype(int)

    print()
    print(
        f"Training rows ({TRAIN_YEAR}): "
        f"{len(X_train):,}"
    )

    print(
        f"Test rows ({TEST_YEAR}): "
        f"{len(X_test):,}"
    )

    print_distribution(
        f"TRAIN {TRAIN_YEAR}",
        y_train,
    )

    print_distribution(
        f"TEST {TEST_YEAR}",
        y_test,
    )

    # --------------------------------------------------------------
    # Class weighting
    # --------------------------------------------------------------

    class_weights = calculate_class_weights(
        y_train
    )

    print()
    print("Training class weights:")

    for class_id, weight in class_weights.items():

        print(
            f"  {class_id} "
            f"{RISK_CLASS_NAMES[class_id]:<10} "
            f"{weight:.4f}"
        )

    sample_weights = make_sample_weights(
        y_train,
        class_weights,
    )

    # --------------------------------------------------------------
    # Train temporal evaluation model
    # --------------------------------------------------------------

    print()
    print("=" * 70)
    print("TRAINING TEMPORAL EVALUATION MODEL")
    print("=" * 70)

    model = xgb.XGBClassifier(
        objective="multi:softprob",
        num_class=4,

        n_estimators=700,

        learning_rate=0.05,

        max_depth=8,

        min_child_weight=3,

        subsample=0.85,

        colsample_bytree=0.85,

        reg_alpha=0.05,

        reg_lambda=1.0,

        gamma=0.0,

        tree_method="hist",

        eval_metric="mlogloss",

        random_state=RANDOM_STATE,

        n_jobs=-1,
    )

    model.fit(
        X_train,
        y_train,
        sample_weight=sample_weights,
        verbose=50,
    )

    # --------------------------------------------------------------
    # Evaluate
    # --------------------------------------------------------------

    metrics = evaluate(
        model,
        X_test,
        y_test,
    )

    # --------------------------------------------------------------
    # Feature importance
    # --------------------------------------------------------------

    importance = model.feature_importances_

    feature_importance = sorted(
        zip(
            FEATURE_COLUMNS,
            importance,
        ),
        key=lambda item: item[1],
        reverse=True,
    )

    print()
    print("Feature importance:")

    for feature, score in feature_importance:

        print(
            f"  {feature:<28} "
            f"{score:.6f}"
        )

    # --------------------------------------------------------------
    # Save evaluation artifacts
    # --------------------------------------------------------------

    evaluation_dir = (
        MODELS_DIR / "evaluation"
    )

    evaluation_dir.mkdir(
        parents=True,
        exist_ok=True,
    )

    results = {
        "evaluation": "temporal_holdout",

        "training_year": TRAIN_YEAR,
        "test_year": TEST_YEAR,

        "training_rows": int(
            len(X_train)
        ),

        "test_rows": int(
            len(X_test)
        ),

        "features": FEATURE_COLUMNS,

        "target": TARGET_COLUMN,

        "classes": {
            str(k): v
            for k, v in RISK_CLASS_NAMES.items()
        },

        "class_weights": {
            str(k): float(v)
            for k, v in class_weights.items()
        },

        "hyperparameters": {
            "n_estimators": 700,
            "learning_rate": 0.05,
            "max_depth": 8,
            "min_child_weight": 3,
            "subsample": 0.85,
            "colsample_bytree": 0.85,
            "reg_alpha": 0.05,
            "reg_lambda": 1.0,
            "gamma": 0.0,
        },

        "metrics": metrics,

        "feature_importance": {
            feature: float(score)
            for feature, score
            in feature_importance
        },

        "interpretation": (
            "The model was trained exclusively on "
            f"{TRAIN_YEAR} observations and evaluated "
            f"on unseen {TEST_YEAR} observations. "
            "Labels are threshold-derived operational "
            "proxy labels, not historical incident outcomes."
        ),
    }

    output_path = (
        evaluation_dir /
        "temporal_evaluation.json"
    )

    output_path.write_text(
        json.dumps(
            results,
            indent=2,
        ),
        encoding="utf-8",
    )

    print()
    print(
        f"Evaluation saved: {output_path}"
    )

    print()
    print("=" * 70)
    print("ORCA-X TEMPORAL EVALUATION COMPLETE")
    print("=" * 70)


if __name__ == "__main__":
    main()