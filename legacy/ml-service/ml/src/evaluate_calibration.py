"""Evaluate probability calibration of the ORCA-X XGBoost risk model.

The model is trained on 2024 observations and evaluated on unseen 2025
observations.

This measures whether predicted probabilities correspond reasonably
well to actual proxy-label frequencies.
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
    brier_score_loss,
    log_loss,
)

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

N_CLASSES = 4

CONFIDENCE_BUCKETS = [
    (0.00, 0.50),
    (0.50, 0.60),
    (0.60, 0.70),
    (0.70, 0.80),
    (0.80, 0.90),
    (0.90, 0.95),
    (0.95, 1.00),
]


def load_dataset() -> pd.DataFrame:
    path = PROCESSED_DIR / "ndbc_marine_risk.parquet"

    if not path.exists():
        raise FileNotFoundError(
            f"Dataset not found: {path}"
        )

    df = pd.read_parquet(path).copy()

    required = [
        "timestamp",
        *FEATURE_COLUMNS,
        TARGET_COLUMN,
    ]

    missing = [
        column
        for column in required
        if column not in df.columns
    ]

    if missing:
        raise ValueError(
            f"Dataset is missing required columns: {missing}"
        )

    df["timestamp"] = pd.to_datetime(
        df["timestamp"],
        errors="coerce",
        utc=True,
    )

    df = df.dropna(
        subset=[
            "timestamp",
            TARGET_COLUMN,
        ]
    )

    df["year"] = df["timestamp"].dt.year

    df[TARGET_COLUMN] = (
        df[TARGET_COLUMN]
        .astype(int)
    )

    return df


def calculate_class_weights(
    y: pd.Series,
) -> dict[int, float]:

    counts = (
        y.value_counts()
        .sort_index()
    )

    total = len(y)
    n_classes = len(counts)

    return {
        int(class_id):
            total / (n_classes * count)
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


def train_model(
    X_train: pd.DataFrame,
    y_train: pd.Series,
) -> xgb.XGBClassifier:

    class_weights = calculate_class_weights(
        y_train
    )

    sample_weights = make_sample_weights(
        y_train,
        class_weights,
    )

    model = xgb.XGBClassifier(
        objective="multi:softprob",
        num_class=N_CLASSES,

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
        verbose=False,
    )

    return model


def expected_calibration_error(
    y_true: np.ndarray,
    probabilities: np.ndarray,
    n_bins: int = 10,
) -> float:
    """Calculate multiclass ECE using maximum predicted confidence."""

    predictions = np.argmax(
        probabilities,
        axis=1,
    )

    confidence = np.max(
        probabilities,
        axis=1,
    )

    correctness = (
        predictions == y_true
    ).astype(float)

    bin_edges = np.linspace(
        0.0,
        1.0,
        n_bins + 1,
    )

    ece = 0.0

    total = len(y_true)

    for i in range(n_bins):

        lower = bin_edges[i]
        upper = bin_edges[i + 1]

        if i == n_bins - 1:
            mask = (
                (confidence >= lower)
                & (confidence <= upper)
            )
        else:
            mask = (
                (confidence >= lower)
                & (confidence < upper)
            )

        if not np.any(mask):
            continue

        bucket_confidence = float(
            confidence[mask].mean()
        )

        bucket_accuracy = float(
            correctness[mask].mean()
        )

        bucket_fraction = (
            mask.sum() / total
        )

        ece += (
            bucket_fraction
            * abs(
                bucket_accuracy
                - bucket_confidence
            )
        )

    return float(ece)


def confidence_buckets(
    y_true: np.ndarray,
    probabilities: np.ndarray,
) -> list[dict]:

    predictions = np.argmax(
        probabilities,
        axis=1,
    )

    confidence = np.max(
        probabilities,
        axis=1,
    )

    correctness = (
        predictions == y_true
    )

    results = []

    for lower, upper in CONFIDENCE_BUCKETS:

        if upper == 1.00:
            mask = (
                (confidence >= lower)
                & (confidence <= upper)
            )
        else:
            mask = (
                (confidence >= lower)
                & (confidence < upper)
            )

        count = int(mask.sum())

        if count == 0:
            results.append(
                {
                    "range": (
                        f"{lower:.2f}-{upper:.2f}"
                    ),
                    "count": 0,
                    "accuracy": None,
                    "mean_confidence": None,
                }
            )

            continue

        results.append(
            {
                "range": (
                    f"{lower:.2f}-{upper:.2f}"
                ),
                "count": count,
                "accuracy": float(
                    correctness[mask].mean()
                ),
                "mean_confidence": float(
                    confidence[mask].mean()
                ),
            }
        )

    return results


def class_probability_metrics(
    y_true: np.ndarray,
    probabilities: np.ndarray,
) -> dict:

    results = {}

    for class_id in range(N_CLASSES):

        y_binary = (
            y_true == class_id
        ).astype(int)

        class_probabilities = (
            probabilities[:, class_id]
        )

        score = brier_score_loss(
            y_binary,
            class_probabilities,
        )

        results[
            RISK_CLASS_NAMES[class_id]
        ] = {
            "brier_score": float(score),
            "mean_predicted_probability": float(
                class_probabilities.mean()
            ),
            "actual_frequency": float(
                y_binary.mean()
            ),
        }

    return results


def main() -> None:

    print("=" * 70)
    print("ORCA-X PROBABILITY CALIBRATION EVALUATION")
    print("=" * 70)

    print()
    print(
        f"Training period: {TRAIN_YEAR}"
    )

    print(
        f"Calibration test period: {TEST_YEAR}"
    )

    # --------------------------------------------------------------
    # Load data
    # --------------------------------------------------------------

    df = load_dataset()

    train_df = df[
        df["year"] == TRAIN_YEAR
    ].copy()

    test_df = df[
        df["year"] == TEST_YEAR
    ].copy()

    if train_df.empty:
        raise ValueError(
            f"No data found for {TRAIN_YEAR}."
        )

    if test_df.empty:
        raise ValueError(
            f"No data found for {TEST_YEAR}."
        )

    X_train = train_df[
        FEATURE_COLUMNS
    ]

    y_train = train_df[
        TARGET_COLUMN
    ]

    X_test = test_df[
        FEATURE_COLUMNS
    ]

    y_test = test_df[
        TARGET_COLUMN
    ]

    print()
    print(
        f"Training rows: "
        f"{len(X_train):,}"
    )

    print(
        f"Calibration test rows: "
        f"{len(X_test):,}"
    )

    # --------------------------------------------------------------
    # Train strictly on 2024
    # --------------------------------------------------------------

    print()
    print("=" * 70)
    print("TRAINING CALIBRATION EVALUATION MODEL")
    print("=" * 70)

    model = train_model(
        X_train,
        y_train,
    )

    # --------------------------------------------------------------
    # Probability predictions
    # --------------------------------------------------------------

    print()
    print(
        "Generating probability predictions..."
    )

    probabilities = model.predict_proba(
        X_test
    )

    predictions = np.argmax(
        probabilities,
        axis=1,
    )

    y_true = y_test.to_numpy()

    # --------------------------------------------------------------
    # Basic metrics
    # --------------------------------------------------------------

    accuracy = accuracy_score(
        y_true,
        predictions,
    )

    multiclass_log_loss = log_loss(
        y_true,
        probabilities,
        labels=list(range(N_CLASSES)),
    )

    ece = expected_calibration_error(
        y_true,
        probabilities,
        n_bins=10,
    )

    print()
    print("=" * 70)
    print("CALIBRATION RESULTS")
    print("=" * 70)

    print()
    print(
        f"Accuracy:              "
        f"{accuracy:.6f}"
    )

    print(
        f"Multiclass Log Loss:   "
        f"{multiclass_log_loss:.6f}"
    )

    print(
        f"Expected Calibration Error (ECE): "
        f"{ece:.6f}"
    )

    # --------------------------------------------------------------
    # Confidence statistics
    # --------------------------------------------------------------

    confidence = np.max(
        probabilities,
        axis=1,
    )

    print()
    print(
        "CONFIDENCE STATISTICS"
    )

    print(
        f"Mean confidence: "
        f"{confidence.mean():.6f}"
    )

    print(
        f"Median confidence: "
        f"{np.median(confidence):.6f}"
    )

    print(
        f"Minimum confidence: "
        f"{confidence.min():.6f}"
    )

    print(
        f"Maximum confidence: "
        f"{confidence.max():.6f}"
    )

    print(
        f"Confidence >= 0.90: "
        f"{(confidence >= 0.90).mean() * 100:.2f}%"
    )

    print(
        f"Confidence >= 0.95: "
        f"{(confidence >= 0.95).mean() * 100:.2f}%"
    )

    print(
        f"Confidence >= 0.99: "
        f"{(confidence >= 0.99).mean() * 100:.2f}%"
    )

    # --------------------------------------------------------------
    # Confidence buckets
    # --------------------------------------------------------------

    buckets = confidence_buckets(
        y_true,
        probabilities,
    )

    print()
    print(
        "CONFIDENCE BUCKETS"
    )

    print(
        f"{'Range':<15}"
        f"{'Count':>12}"
        f"{'Accuracy':>15}"
        f"{'Mean Confidence':>20}"
    )

    for bucket in buckets:

        if bucket["count"] == 0:

            print(
                f"{bucket['range']:<15}"
                f"{0:>12}"
                f"{'N/A':>15}"
                f"{'N/A':>20}"
            )

        else:

            print(
                f"{bucket['range']:<15}"
                f"{bucket['count']:>12,}"
                f"{bucket['accuracy']:>15.6f}"
                f"{bucket['mean_confidence']:>20.6f}"
            )

    # --------------------------------------------------------------
    # Per-class probability metrics
    # --------------------------------------------------------------

    per_class = class_probability_metrics(
        y_true,
        probabilities,
    )

    print()
    print(
        "PER-CLASS PROBABILITY METRICS"
    )

    for label, metrics in per_class.items():

        print()
        print(label)

        print(
            f"  Brier score: "
            f"{metrics['brier_score']:.6f}"
        )

        print(
            f"  Mean predicted probability: "
            f"{metrics['mean_predicted_probability']:.6f}"
        )

        print(
            f"  Actual frequency: "
            f"{metrics['actual_frequency']:.6f}"
        )

    # --------------------------------------------------------------
    # Show uncertain examples
    # --------------------------------------------------------------

    lowest_indices = np.argsort(
        confidence
    )[:10]

    print()
    print(
        "10 LEAST-CONFIDENT PREDICTIONS"
    )

    for index in lowest_indices:

        predicted_class = int(
            predictions[index]
        )

        actual_class = int(
            y_true[index]
        )

        print(
            f"  Confidence={confidence[index]:.4f} "
            f"Predicted="
            f"{RISK_CLASS_NAMES[predicted_class]} "
            f"Actual="
            f"{RISK_CLASS_NAMES[actual_class]} "
            f"Probabilities="
            f"{np.round(probabilities[index], 4).tolist()}"
        )

    # --------------------------------------------------------------
    # Save results
    # --------------------------------------------------------------

    evaluation_dir = (
        MODELS_DIR / "evaluation"
    )

    evaluation_dir.mkdir(
        parents=True,
        exist_ok=True,
    )

    results = {
        "evaluation":
            "probability_calibration",

        "training_year":
            TRAIN_YEAR,

        "test_year":
            TEST_YEAR,

        "training_rows":
            int(len(X_train)),

        "test_rows":
            int(len(X_test)),

        "metrics": {
            "accuracy":
                float(accuracy),

            "multiclass_log_loss":
                float(multiclass_log_loss),

            "expected_calibration_error":
                float(ece),
        },

        "confidence_statistics": {
            "mean":
                float(confidence.mean()),

            "median":
                float(np.median(confidence)),

            "minimum":
                float(confidence.min()),

            "maximum":
                float(confidence.max()),

            "fraction_ge_0.90":
                float(
                    (confidence >= 0.90).mean()
                ),

            "fraction_ge_0.95":
                float(
                    (confidence >= 0.95).mean()
                ),

            "fraction_ge_0.99":
                float(
                    (confidence >= 0.99).mean()
                ),
        },

        "confidence_buckets":
            buckets,

        "per_class":
            per_class,

        "features":
            FEATURE_COLUMNS,

        "target":
            TARGET_COLUMN,

        "warning": (
            "Risk labels are threshold-derived "
            "operational proxy labels and do not "
            "represent historical accident outcomes."
        ),
    }

    output_path = (
        evaluation_dir /
        "calibration_evaluation.json"
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
        f"Evaluation saved: "
        f"{output_path}"
    )

    print()
    print("=" * 70)
    print(
        "ORCA-X CALIBRATION EVALUATION COMPLETE"
    )
    print("=" * 70)


if __name__ == "__main__":
    main()