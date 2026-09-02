"""Train and evaluate ORCA-X with a leakage-audited forward marine-risk target.

Evaluation protocol
-------------------
* 2020-01-01 through 2023-12-31: training
* 2024-01-01 through 2024-12-31: validation/model selection
* 2025-01-01 through 2025-12-31: final temporal test
* Digha (all available dates): spatial holdout

A six-hour temporal embargo is applied at the 2023/2024 and 2024/2025
boundaries so a training/validation prediction origin cannot have a forward
six-hour target window crossing the next evaluation period.

The final test is never used for model selection. Production model promotion
is opt-in via ORCA_PROMOTE_MODEL=true and, when enabled, retrains only on the
approved non-Digha 2020-2024 data using the estimator count selected on 2024.
"""
from __future__ import annotations

import json
import os

import numpy as np
import pandas as pd
import xgboost as xgb
from sklearn.metrics import (
    accuracy_score,
    balanced_accuracy_score,
    classification_report,
    confusion_matrix,
    f1_score,
)

from config import (
    DATASET_NAME,
    DATASET_VERSION,
    FEATURE_COLUMNS,
    MODELS_DIR,
    PROCESSED_DIR,
    RISK_CLASS_NAMES,
    RISK_HORIZON_HOURS,
    TARGET_COLUMN,
)
from label_policy import POLICY_VERSION, assign_operational_risk

RANDOM_STATE = 42
HOLDOUT_LOCATION = "digha_wb"
TRAIN_END = pd.Timestamp("2024-01-01", tz="UTC")
VALIDATION_END = pd.Timestamp("2025-01-01", tz="UTC")
TEMPORAL_TEST_END = pd.Timestamp("2026-01-01", tz="UTC")
RISK_ORDER = [RISK_CLASS_NAMES[i] for i in range(4)]
MODEL_VERSION = "orca-xgb-risk-v2.6"


def _training_device() -> str:
    """Return the XGBoost device requested by the environment."""
    value = os.getenv("ORCA_X_DEVICE", "cpu").strip().lower()
    aliases = {"gpu": "cuda", "cuda:0": "cuda", "cpu": "cpu", "cuda": "cuda"}
    if value not in aliases:
        raise ValueError("ORCA_X_DEVICE must be one of: cpu, cuda, gpu, cuda:0")
    return aliases[value]


def _training_n_jobs() -> int:
    value = os.getenv("ORCA_X_N_JOBS", "-1").strip()
    try:
        jobs = int(value)
    except ValueError as exc:
        raise ValueError("ORCA_X_N_JOBS must be an integer") from exc
    return jobs


def _promote_model() -> bool:
    value = os.getenv("ORCA_PROMOTE_MODEL", "false").strip().lower()
    if value not in {"true", "false", "1", "0", "yes", "no"}:
        raise ValueError("ORCA_PROMOTE_MODEL must be true/false")
    return value in {"true", "1", "yes"}


def load_dataset() -> pd.DataFrame:
    path = PROCESSED_DIR / "orca_historical_marine_risk.parquet"
    if not path.exists():
        raise FileNotFoundError("Run download_historical_marine.py and prepare_dataset.py first.")

    df = pd.read_parquet(path)
    required = ["location_id", "timestamp", *FEATURE_COLUMNS, TARGET_COLUMN]
    missing = [c for c in required if c not in df.columns]
    if missing:
        raise ValueError(f"Dataset is missing required columns: {missing}")

    for col in FEATURE_COLUMNS:
        df[col] = pd.to_numeric(df[col], errors="coerce")
    df["timestamp"] = pd.to_datetime(df["timestamp"], utc=True, errors="coerce")
    df = (
        df.dropna(subset=["location_id", "timestamp"])
        .sort_values(["location_id", "timestamp"])
        .copy()
    )

    duplicates = int(df.duplicated(["location_id", "timestamp"]).sum())
    if duplicates:
        raise ValueError(f"Duplicate location/timestamp rows detected: {duplicates}")

    # Construct a genuinely forward target. The contemporaneous stored label is ignored.
    future = df[
        [
            "location_id",
            "timestamp",
            "wind_speed_kts",
            "wind_gust_kts",
            "wave_height_m",
            "swell_height_m",
        ]
    ].copy()
    future_observable = future[
        ["wind_speed_kts", "wave_height_m", "swell_height_m"]
    ].notna().any(axis=1)
    future["future_risk"] = np.nan
    future.loc[future_observable, "future_risk"] = future.loc[
        future_observable
    ].apply(assign_operational_risk, axis=1)

    horizon = pd.Timedelta(hours=int(RISK_HORIZON_HOURS))
    future["prediction_timestamp"] = future["timestamp"] - horizon
    target = future[["location_id", "prediction_timestamp", "future_risk"]].rename(
        columns={"prediction_timestamp": "timestamp"}
    )

    df = df.merge(target, on=["location_id", "timestamp"], how="left")
    df[TARGET_COLUMN] = pd.to_numeric(df["future_risk"], errors="coerce")
    df = df.drop(columns=["future_risk"], errors="ignore").dropna(
        subset=[TARGET_COLUMN]
    )
    df[TARGET_COLUMN] = df[TARGET_COLUMN].astype(int)

    if df.empty:
        raise ValueError(
            "No rows remain after constructing the forward risk target. "
            "Check historical timestamp spacing and the prediction horizon."
        )
    return df


def add_dynamic_features(df: pd.DataFrame) -> tuple[pd.DataFrame, list[str]]:
    """Add only features that can be reproduced from one live observation."""
    out = df.copy()
    base = list(FEATURE_COLUMNS)
    engineered: list[str] = []

    for col in base:
        name = f"{col}_missing"
        out[name] = out[col].isna().astype(np.int8)
        engineered.append(name)

    # Direction is circular; sine/cosine avoids a false 0/360 discontinuity.
    for col, prefix in [
        ("wind_direction_deg", "wind"),
        ("wave_direction_deg", "wave"),
        ("swell_direction_deg", "swell"),
    ]:
        radians = np.deg2rad(out[col])
        sin_name = f"{prefix}_direction_sin"
        cos_name = f"{prefix}_direction_cos"
        out[sin_name] = np.sin(radians)
        out[cos_name] = np.cos(radians)
        engineered.extend([sin_name, cos_name])

    # Gust structure is point-in-time and reproducible by the live API.
    epsilon = 0.1
    out["gust_excess_kts"] = out["wind_gust_kts"] - out["wind_speed_kts"]
    out["gust_to_wind_ratio"] = out["wind_gust_kts"] / out["wind_speed_kts"].clip(
        lower=epsilon
    )
    out["gust_above_gale_kts"] = (out["wind_gust_kts"] - 34.0).clip(lower=0)
    out["gust_above_extreme_kts"] = (out["wind_gust_kts"] - 48.0).clip(lower=0)
    engineered.extend(
        [
            "gust_excess_kts",
            "gust_to_wind_ratio",
            "gust_above_gale_kts",
            "gust_above_extreme_kts",
        ]
    )

    return out, base + engineered


def metrics(y_true: pd.Series | np.ndarray, pred: pd.Series | np.ndarray) -> dict:
    labels = [0, 1, 2, 3]
    report = classification_report(
        y_true,
        pred,
        labels=labels,
        target_names=RISK_ORDER,
        output_dict=True,
        zero_division=0,
    )
    return {
        "accuracy": float(accuracy_score(y_true, pred)),
        "balanced_accuracy": float(balanced_accuracy_score(y_true, pred)),
        "macro_f1": float(f1_score(y_true, pred, average="macro", zero_division=0)),
        "weighted_f1": float(
            f1_score(y_true, pred, average="weighted", zero_division=0)
        ),
        "critical_recall": float(report[RISK_ORDER[3]]["recall"]),
        "critical_miss_rate": float(1.0 - report[RISK_ORDER[3]]["recall"]),
        "classification_report": report,
        "confusion_matrix": confusion_matrix(y_true, pred, labels=labels).tolist(),
        "rows": int(len(y_true)),
    }


def majority_baseline(y: pd.Series) -> dict:
    majority = int(y.mode().iloc[0])
    result = metrics(y, np.full(len(y), majority, dtype=int))
    result["majority_class"] = RISK_ORDER[majority]
    return result


def make_model(
    n_estimators: int = 900, *, early_stopping_rounds: int | None = None
) -> xgb.XGBClassifier:
    device = _training_device()
    n_jobs = _training_n_jobs()
    params = dict(
        objective="multi:softprob",
        num_class=4,
        n_estimators=n_estimators,
        learning_rate=0.035,
        max_depth=6,
        min_child_weight=8,
        subsample=0.85,
        colsample_bytree=0.85,
        reg_alpha=0.15,
        reg_lambda=2.0,
        gamma=0.05,
        tree_method="hist",
        eval_metric="mlogloss",
        random_state=RANDOM_STATE,
        n_jobs=n_jobs,
    )
    if early_stopping_rounds is not None:
        params["early_stopping_rounds"] = early_stopping_rounds
    if device == "cuda":
        params["device"] = "cuda"
    return xgb.XGBClassifier(**params)


def class_weights(y: pd.Series) -> dict[int, float]:
    counts = y.value_counts().sort_index()
    missing_classes = sorted(set(range(4)) - set(counts.index.astype(int)))
    if missing_classes:
        raise ValueError(f"Training split is missing risk classes: {missing_classes}")
    return {int(cls): float(len(y) / (4 * count)) for cls, count in counts.items()}


def _split_temporally(df: pd.DataFrame) -> dict[str, pd.DataFrame]:
    """Create explicit calendar splits with a six-hour boundary embargo."""
    if df["timestamp"].min() >= TRAIN_END:
        raise ValueError("Dataset has no observations before the 2024 validation period.")

    horizon = pd.Timedelta(hours=int(RISK_HORIZON_HOURS))
    train_cutoff = TRAIN_END - horizon
    validation_cutoff = VALIDATION_END - horizon

    train_df = df[df["timestamp"] < train_cutoff].copy()
    validation_df = df[
        (df["timestamp"] >= TRAIN_END) & (df["timestamp"] < validation_cutoff)
    ].copy()
    temporal_test_df = df[
        (df["timestamp"] >= VALIDATION_END) & (df["timestamp"] < TEMPORAL_TEST_END)
    ].copy()

    # Rows immediately before each boundary are the explicit embargo window.
    train_embargo = df[
        (df["timestamp"] >= train_cutoff) & (df["timestamp"] < TRAIN_END)
    ]
    validation_embargo = df[
        (df["timestamp"] >= validation_cutoff) & (df["timestamp"] < VALIDATION_END)
    ]

    if train_df.empty or validation_df.empty or temporal_test_df.empty:
        raise ValueError(
            "One or more temporal splits are empty. Expected 2020-2023 train, "
            "2024 validation and 2025 test data."
        )

    # The data audit established hourly continuity; enforce the intended target-window separation.
    if train_embargo.empty or validation_embargo.empty:
        raise ValueError("Expected six-hour embargo rows at both temporal boundaries.")

    print(
        "Temporal split protocol: "
        f"train < {train_cutoff.isoformat()}, "
        f"validation {TRAIN_END.isoformat()} to < {validation_cutoff.isoformat()}, "
        f"test {VALIDATION_END.isoformat()} to < {TEMPORAL_TEST_END.isoformat()}"
    )
    print(
        "Embargo windows: "
        f"{train_cutoff.isoformat()} to < {TRAIN_END.isoformat()} and "
        f"{validation_cutoff.isoformat()} to < {VALIDATION_END.isoformat()}"
    )

    return {
        "train": train_df,
        "validation": validation_df,
        "temporal_test": temporal_test_df,
        "train_embargo": train_embargo,
        "validation_embargo": validation_embargo,
    }


def _split_summary(name: str, frame: pd.DataFrame) -> dict:
    return {
        "name": name,
        "rows": int(len(frame)),
        "locations": sorted(frame["location_id"].unique().tolist()),
        "location_count": int(frame["location_id"].nunique()),
        "start": frame["timestamp"].min().isoformat(),
        "end": frame["timestamp"].max().isoformat(),
        "class_distribution": {
            str(int(k)): int(v)
            for k, v in frame[TARGET_COLUMN].value_counts().sort_index().items()
        },
    }


def _print_metrics(name: str, result: dict) -> None:
    print(
        f"{name}: accuracy={result['accuracy']:.4f} "
        f"balanced_accuracy={result['balanced_accuracy']:.4f} "
        f"macro_f1={result['macro_f1']:.4f} "
        f"weighted_f1={result['weighted_f1']:.4f} "
        f"critical_recall={result['critical_recall']:.4f} "
        f"rows={result['rows']:,}"
    )


def _save_evaluation_report(report: dict) -> None:
    MODELS_DIR.mkdir(parents=True, exist_ok=True)
    path = MODELS_DIR / "orca_xgb_risk_evaluation.json"
    path.write_text(json.dumps(report, indent=2, default=float), encoding="utf-8")
    print(f"Saved evaluation report: {path}")


def _production_metadata(
    *,
    feature_columns: list[str],
    production_weights: dict[int, float],
    final_model: xgb.XGBClassifier,
    evaluation: dict,
    training_locations: list[str],
    device: str,
) -> dict:
    importance = sorted(
        zip(feature_columns, final_model.feature_importances_),
        key=lambda x: x[1],
        reverse=True,
    )
    return {
        "model": "XGBoost",
        "model_version": MODEL_VERSION,
        "dataset_name": DATASET_NAME,
        "dataset_version": DATASET_VERSION,
        "risk_policy_version": POLICY_VERSION,
        "prediction_horizon_hours": int(RISK_HORIZON_HOURS),
        "target": "future_risk_class",
        "classes": {str(i): name for i, name in RISK_CLASS_NAMES.items()},
        "features": feature_columns,
        "base_features": FEATURE_COLUMNS,
        "feature_count": len(feature_columns),
        "inference_contract": "point-in-time features only; no lag/trend features that require hidden historical state",
        "missing_data_policy": "Native XGBoost missing handling plus explicit missingness indicators; no synthetic visibility imputation.",
        "gust_policy": "Gust is represented as excess, ratio and threshold features; gust alone cannot create EXTREME in the target policy.",
        "evaluation_protocol": {
            "train_period": "2020-01-01 through 2023-12-31 17:00 UTC",
            "validation_period": "2024-01-01 through 2024-12-31 17:00 UTC",
            "temporal_test_period": "2025-01-01 through 2025-12-31 17:00 UTC",
            "temporal_embargo_hours": int(RISK_HORIZON_HOURS),
            "spatial_holdout": HOLDOUT_LOCATION,
            "final_test_used_for_model_selection": False,
        },
        "evaluation": evaluation,
        "class_weights": {str(k): v for k, v in production_weights.items()},
        "feature_importance": {name: float(value) for name, value in importance},
        "training_locations": training_locations,
        "digha_excluded_from_training": True,
        "label_policy": "Six-hour forward ORCA-X operational severity proxy: sustained wind is primary; gust is secondary; EXTREME requires sustained wind >=48 kt, significant wave >=6 m, or sustained gale + rough sea. Not official warning labels or incident outcomes.",
        "warning": "RAG and authoritative IMD/INCOIS/Coast Guard evidence remain higher-priority safety evidence.",
        "training_device": device,
        "training_n_jobs": _training_n_jobs(),
    }


def main() -> None:
    device = _training_device()
    promote = _promote_model()
    print(f"XGBoost execution device: {device}")
    print(f"XGBoost n_jobs: {_training_n_jobs()}")
    print(f"ORCA_PROMOTE_MODEL: {promote}")
    if device == "cuda":
        print("GPU mode enabled. Verify the selected GPU runtime before training.")

    df = load_dataset()
    df, feature_columns = add_dynamic_features(df)
    print(
        f"Dataset rows after forward-target construction: {len(df):,}; "
        f"locations: {df.location_id.nunique()}"
    )
    print(f"Prediction horizon: +{int(RISK_HORIZON_HOURS)}h")
    print(f"Risk policy: {POLICY_VERSION}")
    print(
        f"Feature count: {len(feature_columns)} "
        f"({len(FEATURE_COLUMNS)} base + point-in-time engineered features)"
    )
    print("Missing percentage by feature:")
    print((df[feature_columns].isna().mean() * 100).round(2).to_string())
    print("Forward target distribution:")
    print(
        df[TARGET_COLUMN]
        .map(RISK_CLASS_NAMES)
        .value_counts()
        .reindex(RISK_ORDER, fill_value=0)
    )
    if df[TARGET_COLUMN].nunique() < 4:
        raise ValueError("Forward target does not contain all four risk classes.")

    # Digha is completely excluded from model fitting and temporal model selection.
    train_pool = df[df.location_id != HOLDOUT_LOCATION].copy()
    digha = df[df.location_id == HOLDOUT_LOCATION].copy()
    if digha.empty:
        raise ValueError(f"Spatial holdout {HOLDOUT_LOCATION!r} is missing.")

    splits = _split_temporally(train_pool)
    train_df = splits["train"]
    validation_df = splits["validation"]
    temporal_test_df = splits["temporal_test"]

    if train_df[TARGET_COLUMN].nunique() < 4:
        raise ValueError("Training split does not contain all four risk classes.")
    if validation_df[TARGET_COLUMN].nunique() < 4:
        raise ValueError("Validation split does not contain all four risk classes.")
    if temporal_test_df[TARGET_COLUMN].nunique() < 4:
        raise ValueError("Temporal test split does not contain all four risk classes.")

    print("\nSplit summaries:")
    for name, frame in [
        ("train_2020_2023", train_df),
        ("validation_2024", validation_df),
        ("temporal_test_2025", temporal_test_df),
        ("digha_spatial_holdout", digha),
    ]:
        summary = _split_summary(name, frame)
        print(
            f"{name}: rows={summary['rows']:,}, "
            f"start={summary['start']}, end={summary['end']}, "
            f"locations={summary['location_count']}"
        )
        print(f"  classes={summary['class_distribution']}")

    validation_majority = majority_baseline(validation_df[TARGET_COLUMN])
    temporal_test_majority = majority_baseline(temporal_test_df[TARGET_COLUMN])
    digha_majority = majority_baseline(digha[TARGET_COLUMN])

    print("\nMajority baselines:")
    _print_metrics("2024 validation majority", validation_majority)
    _print_metrics("2025 temporal test majority", temporal_test_majority)
    _print_metrics("Digha spatial holdout majority", digha_majority)

    # Model selection happens only against 2024. The 2025 test remains untouched until this point.
    weights = class_weights(train_df[TARGET_COLUMN])
    model = make_model(n_estimators=900, early_stopping_rounds=50)
    model.fit(
        train_df[feature_columns],
        train_df[TARGET_COLUMN],
        sample_weight=train_df[TARGET_COLUMN]
        .map(weights)
        .to_numpy(dtype=np.float32),
        eval_set=[
            (validation_df[feature_columns], validation_df[TARGET_COLUMN])
        ],
        verbose=100,
    )

    validation_pred = model.predict(validation_df[feature_columns]).astype(int)
    temporal_test_pred = model.predict(temporal_test_df[feature_columns]).astype(int)
    digha_pred = model.predict(digha[feature_columns]).astype(int)

    validation_metrics = metrics(validation_df[TARGET_COLUMN], validation_pred)
    temporal_test_metrics = metrics(temporal_test_df[TARGET_COLUMN], temporal_test_pred)
    digha_metrics = metrics(digha[TARGET_COLUMN], digha_pred)

    print("\nModel evaluation:")
    _print_metrics("2024 validation", validation_metrics)
    _print_metrics("2025 FINAL temporal test", temporal_test_metrics)
    _print_metrics("Digha spatial holdout", digha_metrics)

    best_iteration = getattr(model, "best_iteration", None)
    if best_iteration is None:
        raise RuntimeError("XGBoost did not expose best_iteration after validation training.")
    selected_estimators = max(100, int(best_iteration) + 1)
    print(f"Selected estimator count from 2024 validation: {selected_estimators}")

    evaluation = {
        "protocol": "2020-2023 train / 2024 validation / 2025 final temporal test + Digha spatial holdout",
        "temporal_embargo_hours": int(RISK_HORIZON_HOURS),
        "model_selection_period": "2024",
        "final_temporal_test_period": "2025",
        "selected_estimators": selected_estimators,
        "splits": {
            "train_2020_2023": _split_summary("train_2020_2023", train_df),
            "validation_2024": _split_summary("validation_2024", validation_df),
            "temporal_test_2025": _split_summary("temporal_test_2025", temporal_test_df),
            "digha_spatial_holdout": _split_summary("digha_spatial_holdout", digha),
        },
        "majority_baselines": {
            "validation_2024": validation_majority,
            "temporal_test_2025": temporal_test_majority,
            "digha_spatial_holdout": digha_majority,
        },
        "model_metrics": {
            "validation_2024": validation_metrics,
            "temporal_test_2025": temporal_test_metrics,
            "digha_spatial_holdout": digha_metrics,
        },
    }
    _save_evaluation_report(evaluation)

    if not promote:
        print(
            "\nPROMOTION BLOCKED: evaluation-only mode. "
            "The existing production model artifact was not modified. "
            "Set ORCA_PROMOTE_MODEL=true only after reviewing the saved 2025 "
            "temporal-test and Digha holdout results."
        )
        return

    # Promotion retrains on approved 2020-2024 non-Digha data only. The 2025 test
    # and Digha holdout remain independent from the production fit.
    production_df = pd.concat([train_df, validation_df], ignore_index=True).sort_values(
        ["location_id", "timestamp"]
    )
    production_weights = class_weights(production_df[TARGET_COLUMN])
    final_model = make_model(n_estimators=selected_estimators)
    final_model.fit(
        production_df[feature_columns],
        production_df[TARGET_COLUMN],
        sample_weight=production_df[TARGET_COLUMN]
        .map(production_weights)
        .to_numpy(dtype=np.float32),
        verbose=100,
    )

    MODELS_DIR.mkdir(parents=True, exist_ok=True)
    model_path = MODELS_DIR / "orca_xgb_risk.json"
    metadata_path = MODELS_DIR / "orca_xgb_risk_metadata.json"
    final_model.save_model(model_path)
    metadata = _production_metadata(
        feature_columns=feature_columns,
        production_weights=production_weights,
        final_model=final_model,
        evaluation=evaluation,
        training_locations=sorted(production_df.location_id.unique().tolist()),
        device=device,
    )
    metadata["production_training_period"] = "2020-01-01 through 2024-12-31 17:00 UTC"
    metadata["production_training_rows"] = int(len(production_df))
    metadata_path.write_text(
        json.dumps(metadata, indent=2, default=float), encoding="utf-8"
    )
    print(f"\nPROMOTED production model: {model_path}")
    print(f"Saved production metadata: {metadata_path}")


if __name__ == "__main__":
    main()
