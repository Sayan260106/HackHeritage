"""Leave-one-station-out geographic evaluation for ORCA-X."""

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


def load_dataset() -> pd.DataFrame:
    path = PROCESSED_DIR / "ndbc_marine_risk.parquet"

    if not path.exists():
        raise FileNotFoundError(
            f"Dataset not found: {path}"
        )

    df = pd.read_parquet(path).copy()

    required = [
        "station_id",
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
            "station_id",
            "timestamp",
            TARGET_COLUMN,
        ]
    )

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


def print_distribution(
    name: str,
    y: pd.Series,
) -> None:

    counts = (
        y.value_counts()
        .sort_index()
    )

    percentages = (
        y.value_counts(
            normalize=True
        )
        .sort_index()
        * 100
    )

    print()
    print(f"{name} distribution:")

    for class_id in range(4):

        count = int(
            counts.get(
                class_id,
                0,
            )
        )

        percentage = float(
            percentages.get(
                class_id,
                0.0,
            )
        )

        print(
            f"  {class_id} "
            f"{RISK_CLASS_NAMES[class_id]:<10} "
            f"{count:>8,} "
            f"({percentage:>6.2f}%)"
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
        verbose=False,
    )

    return model


def evaluate_model(
    model: xgb.XGBClassifier,
    X_test: pd.DataFrame,
    y_test: pd.Series,
) -> dict:

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

    return {
        "accuracy": float(accuracy),
        "macro_f1": float(macro_f1),
        "weighted_f1": float(weighted_f1),
        "classification_report": report,
        "confusion_matrix": confusion.tolist(),
    }


def main() -> None:

    print("=" * 70)
    print("ORCA-X GEOGRAPHIC GENERALIZATION EVALUATION")
    print("=" * 70)

    df = load_dataset()

    stations = sorted(
        df["station_id"]
        .unique()
        .tolist()
    )

    print()
    print(
        f"Total rows: {len(df):,}"
    )

    print(
        f"Stations: {stations}"
    )

    print()
    print("Station distribution:")

    print(
        df["station_id"]
        .value_counts()
        .sort_index()
        .to_string()
    )

    all_results = {}

    # --------------------------------------------------------------
    # Leave-one-station-out evaluation
    # --------------------------------------------------------------

    for test_station in stations:

        train_stations = [
            station
            for station in stations
            if station != test_station
        ]

        print()
        print("=" * 70)
        print(
            f"TEST STATION: {test_station}"
        )
        print("=" * 70)

        print()
        print(
            f"Training stations: "
            f"{train_stations}"
        )

        print(
            f"Held-out station: "
            f"{test_station}"
        )

        train_df = df[
            df["station_id"].isin(
                train_stations
            )
        ].copy()

        test_df = df[
            df["station_id"] == test_station
        ].copy()

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
            f"{len(train_df):,}"
        )

        print(
            f"Test rows: "
            f"{len(test_df):,}"
        )

        print_distribution(
            "TRAINING",
            y_train,
        )

        print_distribution(
            "HELD-OUT TEST",
            y_test,
        )

        print()
        print(
            "Training XGBoost..."
        )

        model = train_model(
            X_train,
            y_train,
        )

        metrics = evaluate_model(
            model,
            X_test,
            y_test,
        )

        print()
        print(
            "RESULTS"
        )

        print(
            f"Accuracy:    "
            f"{metrics['accuracy']:.4f}"
        )

        print(
            f"Macro F1:    "
            f"{metrics['macro_f1']:.4f}"
        )

        print(
            f"Weighted F1: "
            f"{metrics['weighted_f1']:.4f}"
        )

        print()
        print(
            "Classification report:"
        )

        print(
            classification_report(
                y_test,
                model.predict(X_test),
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

        print(
            "Confusion matrix:"
        )

        print(
            np.asarray(
                metrics["confusion_matrix"]
            )
        )

        print()
        print(
            "Risk-class recall:"
        )

        report = metrics[
            "classification_report"
        ]

        for class_id in range(4):

            label = (
                RISK_CLASS_NAMES[
                    class_id
                ]
            )

            recall = report[
                label
            ]["recall"]

            print(
                f"  {label:<10}: "
                f"{recall:.4f}"
            )

        all_results[test_station] = {
            "training_stations":
                train_stations,

            "test_station":
                test_station,

            "training_rows":
                int(len(train_df)),

            "test_rows":
                int(len(test_df)),

            "metrics":
                metrics,
        }

    # --------------------------------------------------------------
    # Aggregate results
    # --------------------------------------------------------------

    accuracies = [
        result["metrics"]["accuracy"]
        for result in all_results.values()
    ]

    macro_f1_scores = [
        result["metrics"]["macro_f1"]
        for result in all_results.values()
    ]

    weighted_f1_scores = [
        result["metrics"]["weighted_f1"]
        for result in all_results.values()
    ]

    summary = {
        "evaluation":
            "leave_one_station_out",

        "stations":
            stations,

        "experiments":
            all_results,

        "aggregate": {
            "mean_accuracy":
                float(np.mean(accuracies)),

            "mean_macro_f1":
                float(np.mean(macro_f1_scores)),

            "mean_weighted_f1":
                float(np.mean(weighted_f1_scores)),

            "min_accuracy":
                float(np.min(accuracies)),

            "min_macro_f1":
                float(np.min(macro_f1_scores)),
        },

        "features":
            FEATURE_COLUMNS,

        "target":
            TARGET_COLUMN,

        "interpretation": (
            "Each station is completely held out "
            "from training and used as an unseen "
            "geographic test location. Labels are "
            "threshold-derived operational proxy "
            "labels rather than historical incident "
            "outcomes."
        ),
    }

    evaluation_dir = (
        MODELS_DIR / "evaluation"
    )

    evaluation_dir.mkdir(
        parents=True,
        exist_ok=True,
    )

    output_path = (
        evaluation_dir /
        "station_holdout_evaluation.json"
    )

    output_path.write_text(
        json.dumps(
            summary,
            indent=2,
        ),
        encoding="utf-8",
    )

    # --------------------------------------------------------------
    # Final summary
    # --------------------------------------------------------------

    print()
    print("=" * 70)
    print("GEOGRAPHIC GENERALIZATION SUMMARY")
    print("=" * 70)

    for station, result in all_results.items():

        metrics = result["metrics"]

        print()
        print(
            f"Held-out station {station}:"
        )

        print(
            f"  Accuracy: "
            f"{metrics['accuracy']:.4f}"
        )

        print(
            f"  Macro F1: "
            f"{metrics['macro_f1']:.4f}"
        )

        print(
            f"  Weighted F1: "
            f"{metrics['weighted_f1']:.4f}"
        )

    print()
    print(
        f"Mean accuracy: "
        f"{np.mean(accuracies):.4f}"
    )

    print(
        f"Mean Macro F1: "
        f"{np.mean(macro_f1_scores):.4f}"
    )

    print(
        f"Minimum accuracy: "
        f"{np.min(accuracies):.4f}"
    )

    print(
        f"Minimum Macro F1: "
        f"{np.min(macro_f1_scores):.4f}"
    )

    print()
    print(
        f"Evaluation saved: "
        f"{output_path}"
    )

    print()
    print("=" * 70)
    print(
        "ORCA-X GEOGRAPHIC EVALUATION COMPLETE"
    )
    print("=" * 70)


if __name__ == "__main__":
    main()