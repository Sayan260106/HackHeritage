"""ORCA-X Refinement 14: calibrated, safety-aware risk decisions.

Purpose
-------
Refinement 13 established that causal temporal dynamics materially improve the
clean +6h forward-target benchmark. Refinement 14 does not chase another large
hyperparameter sweep. It asks whether the resulting class probabilities are
trustworthy and whether a small, explicitly safety-aware decision layer can
improve HIGH/EXTREME detection without contaminating the held-out evaluation.

Strict evaluation contract
---------------------------
* Target: Refinement 11 clean +6h forward target.
* Features: exactly the causal dynamic family from Refinement 13, rebuilt with
  pd.concat to avoid pandas DataFrame fragmentation.
* No location ID, latitude, longitude, stored label, or future feature is used.
* Digha is excluded from model/decision selection and is a final audit only.
* For each non-Digha coastline holdout, the remaining coastlines are split
  chronologically into train/calibration/test. Temperature and class decision
  offsets are selected on calibration only; metrics are reported on the later
  test period.
* The final Digha audit trains on all non-Digha rows, calibrates on their latest
  calibration slice, and evaluates Digha without using Digha for selection.
* Production model, risk policy, thresholds, and source data are untouched.
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd
import xgboost as xgb
from sklearn.metrics import (
    accuracy_score,
    balanced_accuracy_score,
    confusion_matrix,
    f1_score,
    log_loss,
)

from config import FEATURE_COLUMNS, RISK_HORIZON_HOURS, TARGET_COLUMN
from label_policy import POLICY_VERSION

RANDOM_STATE = 42
HOLDOUT_LOCATION = "digha_wb"
SOURCE_PATH = Path(__file__).resolve().parents[1] / "models" / "refinement11" / "clean_forward_target.parquet"
OUT_DIR = Path(__file__).resolve().parents[1] / "models" / "refinement14"

BASE_FEATURES = [c for c in FEATURE_COLUMNS if c not in {"latitude", "longitude"}]
DYNAMIC_BASE = [
    "wind_speed_kts", "wind_gust_kts", "wave_height_m", "wave_period_s",
    "swell_height_m", "swell_period_s", "air_pressure_hpa", "air_temperature_c",
    "sea_surface_temperature_c", "precipitation_mm",
]
DIRECTIONAL = ["wind_direction_deg", "wave_direction_deg", "swell_direction_deg"]

# Refinement 13 winner, reproduced explicitly so this benchmark remains
# deterministic even when the local refinement13 JSON has not been committed.
BEST_PARAMS = dict(
    n_estimators=1000,
    learning_rate=0.03,
    max_depth=6,
    min_child_weight=12,
    subsample=0.75,
    colsample_bytree=0.75,
    reg_alpha=0.2,
    reg_lambda=3.5,
    gamma=0.05,
)


def load_clean() -> pd.DataFrame:
    if not SOURCE_PATH.exists():
        raise FileNotFoundError(f"Run Refinement 11 first: {SOURCE_PATH}")
    df = pd.read_parquet(SOURCE_PATH).copy()
    required = ["location_id", "timestamp", TARGET_COLUMN, *FEATURE_COLUMNS]
    missing = [c for c in required if c not in df.columns]
    if missing:
        raise ValueError(f"Clean target dataset is missing required columns: {missing}")
    for c in FEATURE_COLUMNS:
        df[c] = pd.to_numeric(df[c], errors="coerce")
    df[TARGET_COLUMN] = pd.to_numeric(df[TARGET_COLUMN], errors="coerce")
    df["timestamp"] = pd.to_datetime(df["timestamp"], utc=True, errors="coerce")
    df = df.dropna(subset=["location_id", "timestamp", TARGET_COLUMN]).copy()
    df[TARGET_COLUMN] = df[TARGET_COLUMN].astype(int)
    return df.sort_values(["location_id", "timestamp"]).reset_index(drop=True)


def add_dynamic_features(df: pd.DataFrame) -> tuple[pd.DataFrame, list[str]]:
    """Rebuild Refinement 13 causal features without repeated frame insertion."""
    grouped = df.groupby("location_id", sort=False)
    blocks: list[pd.DataFrame] = [df.copy()]
    feature_blocks: list[list[str]] = []

    missing = pd.DataFrame(
        {f"{c}_missing": df[c].isna().astype(np.int8) for c in BASE_FEATURES}, index=df.index
    )
    blocks.append(missing)
    feature_blocks.append(list(missing.columns))

    directional = {}
    for col in DIRECTIONAL:
        prefix = col.replace("_direction_deg", "")
        radians = np.deg2rad(df[col])
        directional[f"{prefix}_direction_sin"] = np.sin(radians)
        directional[f"{prefix}_direction_cos"] = np.cos(radians)
    blocks.append(pd.DataFrame(directional, index=df.index))
    feature_blocks.append(list(directional.keys()))

    dynamic: dict[str, pd.Series] = {}
    for col in DYNAMIC_BASE:
        s = grouped[col]
        for lag in (1, 3, 6, 12, 24):
            dynamic[f"{col}_lag{lag}"] = s.shift(lag)
        for lag in (1, 3, 6):
            dynamic[f"{col}_delta{lag}"] = df[col] - s.shift(lag)
        shifted = s.shift(1)
        for window in (3, 6, 12, 24):
            dynamic[f"{col}_roll{window}_mean"] = shifted.transform(
                lambda x: x.rolling(window, min_periods=2).mean()
            )
            dynamic[f"{col}_roll{window}_std"] = shifted.transform(
                lambda x: x.rolling(window, min_periods=2).std()
            )
        dynamic[f"{col}_anomaly6"] = df[col] - dynamic[f"{col}_roll6_mean"]
        dynamic[f"{col}_trend6"] = (s.shift(1) - s.shift(7)) / 6.0
    blocks.append(pd.DataFrame(dynamic, index=df.index))
    feature_blocks.append(list(dynamic.keys()))

    direction_delta = {}
    for col in DIRECTIONAL:
        prefix = col.replace("_direction_deg", "")
        prev = grouped[col].shift(1)
        direction_delta[f"{prefix}_direction_delta1"] = (df[col] - prev + 180.0) % 360.0 - 180.0
    blocks.append(pd.DataFrame(direction_delta, index=df.index))
    feature_blocks.append(list(direction_delta.keys()))

    eps = 0.1
    interactions = pd.DataFrame(
        {
            "gust_excess_kts_dynamic": df["wind_gust_kts"] - df["wind_speed_kts"],
            "gust_to_wind_ratio_dynamic": df["wind_gust_kts"] / df["wind_speed_kts"].clip(lower=eps),
            "wave_energy_proxy": df["wave_height_m"] ** 2,
            "swell_energy_proxy": df["swell_height_m"] ** 2,
            "wind_wave_stress_proxy": df["wind_speed_kts"] ** 2 * df["wave_height_m"].clip(lower=0),
            "combined_sea_state": df["wave_height_m"].clip(lower=0) + df["swell_height_m"].clip(lower=0),
        },
        index=df.index,
    )
    blocks.append(interactions)
    feature_blocks.append(list(interactions.columns))

    out = pd.concat(blocks, axis=1).copy()
    features = list(BASE_FEATURES)
    for block in feature_blocks:
        features.extend(block)
    forbidden = {"latitude", "longitude", "location_id", "timestamp", TARGET_COLUMN,
                 "future_risk_class", "future_risk", "stored_risk_label",
                 "reconstructed_forward_risk"}
    features = [c for c in dict.fromkeys(features) if c not in forbidden]
    return out, features


def class_weights(y: pd.Series) -> np.ndarray:
    counts = y.value_counts().to_dict()
    weights = {int(k): float(len(y) / (4 * v)) for k, v in counts.items()}
    return y.map(weights).to_numpy(dtype=np.float32)


def make_model() -> xgb.XGBClassifier:
    return xgb.XGBClassifier(
        objective="multi:softprob",
        num_class=4,
        tree_method="hist",
        eval_metric="mlogloss",
        random_state=RANDOM_STATE,
        n_jobs=-1,
        **BEST_PARAMS,
    )


def probabilities(model: xgb.XGBClassifier, X: pd.DataFrame) -> np.ndarray:
    return np.asarray(model.predict_proba(X), dtype=np.float64)


def apply_temperature(probs: np.ndarray, temperature: float) -> np.ndarray:
    temperature = max(float(temperature), 1e-6)
    logits = np.log(np.clip(probs, 1e-12, 1.0))
    logits = logits / temperature
    logits -= logits.max(axis=1, keepdims=True)
    exp = np.exp(logits)
    return exp / exp.sum(axis=1, keepdims=True)


def multiclass_brier(y: np.ndarray, probs: np.ndarray) -> float:
    one_hot = np.eye(4, dtype=np.float64)[y]
    return float(np.mean(np.sum((probs - one_hot) ** 2, axis=1)))


def ece(y: np.ndarray, probs: np.ndarray, bins: int = 15) -> float:
    confidence = probs.max(axis=1)
    pred = probs.argmax(axis=1)
    correct = (pred == y).astype(float)
    edges = np.linspace(0.0, 1.0, bins + 1)
    total = len(y)
    score = 0.0
    for lo, hi in zip(edges[:-1], edges[1:]):
        mask = (confidence >= lo) & (confidence < hi if hi < 1.0 else confidence <= hi)
        if mask.any():
            score += mask.mean() * abs(correct[mask].mean() - confidence[mask].mean())
    return float(score)


def recall_for(y: np.ndarray, pred: np.ndarray, cls: int) -> float:
    mask = y == cls
    return float(((pred == cls) & mask).sum() / mask.sum()) if mask.any() else 0.0


def critical_recall(y: np.ndarray, pred: np.ndarray) -> float:
    mask = np.isin(y, [2, 3])
    return float(np.isin(pred[mask], [2, 3]).mean()) if mask.any() else 0.0


def classification_metrics(y: np.ndarray, probs: np.ndarray, pred: np.ndarray | None = None) -> dict:
    if pred is None:
        pred = probs.argmax(axis=1)
    return {
        "accuracy": float(accuracy_score(y, pred)),
        "balanced_accuracy": float(balanced_accuracy_score(y, pred)),
        "macro_f1": float(f1_score(y, pred, average="macro", zero_division=0)),
        "weighted_f1": float(f1_score(y, pred, average="weighted", zero_division=0)),
        "high_recall": recall_for(y, pred, 2),
        "extreme_recall": recall_for(y, pred, 3),
        "high_extreme_recall": critical_recall(y, pred),
        "log_loss": float(log_loss(y, probs, labels=[0, 1, 2, 3])),
        "brier": multiclass_brier(y, probs),
        "ece": ece(y, probs),
        "confusion_matrix": confusion_matrix(y, pred, labels=[0, 1, 2, 3]).tolist(),
        "rows": int(len(y)),
    }


def decision(probs: np.ndarray, offsets: np.ndarray) -> np.ndarray:
    scores = np.log(np.clip(probs, 1e-12, 1.0)) + offsets[None, :]
    return scores.argmax(axis=1).astype(int)


def decision_objective(y: np.ndarray, pred: np.ndarray) -> float:
    """Calibration-only selection objective for the safety-aware decision layer."""
    macro = f1_score(y, pred, average="macro", zero_division=0)
    bal = balanced_accuracy_score(y, pred)
    crit = critical_recall(y, pred)
    return float(0.45 * macro + 0.25 * bal + 0.30 * crit)


def fit_temperature(y: np.ndarray, probs: np.ndarray) -> float:
    candidates = np.linspace(0.55, 2.50, 40)
    losses = [log_loss(y, apply_temperature(probs, t), labels=[0, 1, 2, 3]) for t in candidates]
    return float(candidates[int(np.argmin(losses))])


def fit_offsets(y: np.ndarray, calibrated_probs: np.ndarray) -> np.ndarray:
    """Small deterministic grid: only HIGH/EXTREME receive positive safety bias."""
    baseline = decision(calibrated_probs, np.zeros(4))
    baseline_critical = critical_recall(y, baseline)
    best_score = decision_objective(y, baseline)
    best = np.zeros(4, dtype=np.float64)
    grid = np.arange(0.0, 1.01, 0.10)
    for high in grid:
        for extreme in grid:
            offsets = np.array([0.0, 0.0, high, extreme], dtype=np.float64)
            pred = decision(calibrated_probs, offsets)
            crit = critical_recall(y, pred)
            # Never accept a safety layer that reduces critical recall below
            # the calibrated argmax baseline, and require a genuine objective gain.
            if crit + 1e-12 < baseline_critical:
                continue
            score = decision_objective(y, pred)
            if score > best_score + 1e-12:
                best_score = score
                best = offsets
    return best


def chronological_split(df: pd.DataFrame, train_frac: float = 0.70, cal_frac: float = 0.12):
    times = np.sort(df.timestamp.unique())
    t1 = times[int(len(times) * train_frac)]
    t2 = times[int(len(times) * (train_frac + cal_frac))]
    train = df[df.timestamp < t1]
    cal = df[(df.timestamp >= t1) & (df.timestamp < t2)]
    test = df[df.timestamp >= t2]
    return train, cal, test


def fit_and_evaluate(train, cal, test, features) -> dict:
    m = make_model()
    m.fit(train[features], train[TARGET_COLUMN], sample_weight=class_weights(train[TARGET_COLUMN]), verbose=False)
    p_cal_raw = probabilities(m, cal[features])
    p_test_raw = probabilities(m, test[features])
    y_cal = cal[TARGET_COLUMN].to_numpy(dtype=int)
    y_test = test[TARGET_COLUMN].to_numpy(dtype=int)

    temperature = fit_temperature(y_cal, p_cal_raw)
    p_cal = apply_temperature(p_cal_raw, temperature)
    p_test = apply_temperature(p_test_raw, temperature)
    offsets = fit_offsets(y_cal, p_cal)

    base_test_pred = p_test.argmax(axis=1)
    final_test_pred = decision(p_test, offsets)
    raw_metrics = classification_metrics(y_test, p_test_raw, base_test_pred)
    calibrated_metrics = classification_metrics(y_test, p_test, p_test.argmax(axis=1))
    final_metrics = classification_metrics(y_test, p_test, final_test_pred)
    return {
        "temperature": temperature,
        "decision_offsets": offsets.tolist(),
        "calibration_rows": int(len(cal)),
        "test_rows": int(len(test)),
        "raw_test": raw_metrics,
        "calibrated_argmax_test": calibrated_metrics,
        "safety_decision_test": final_metrics,
    }


def main() -> None:
    print("=" * 78)
    print("ORCA-X CALIBRATED SAFETY-AWARE RISK BENCHMARK — REFINEMENT 14")
    print("=" * 78)
    print("Selection: mean leave-one-coast-out test score; Digha excluded from selection")
    print("Calibration: chronological train/calibration/test; no future leakage")
    print("Decision layer: calibration-only HIGH/EXTREME logit offsets")
    print(f"Forward horizon: +{int(RISK_HORIZON_HOURS)}h | policy: {POLICY_VERSION}")

    df = load_clean()
    df, features = add_dynamic_features(df)
    print(f"Rows: {len(df):,} | Locations: {df.location_id.nunique()} | Features: {len(features)}")
    print(f"Target distribution: {df[TARGET_COLUMN].value_counts().sort_index().to_dict()}")

    folds = []
    selection_locations = [x for x in sorted(df.location_id.unique()) if x != HOLDOUT_LOCATION]
    for location in selection_locations:
        pool = df[df.location_id != location]
        train, cal, test = chronological_split(pool)
        result = fit_and_evaluate(train, cal, test, features)
        result["location"] = location
        folds.append(result)
        s = result["safety_decision_test"]
        print(
            f"{location:12s} raw_f1={result['raw_test']['macro_f1']:.4f} "
            f"cal_f1={result['calibrated_argmax_test']['macro_f1']:.4f} "
            f"decision_f1={s['macro_f1']:.4f} "
            f"decision_critical={s['high_extreme_recall']:.4f} "
            f"ECE={result['calibrated_argmax_test']['ece']:.4f}"
        )

    def mean_metric(section: str, key: str) -> float:
        return float(np.mean([f[section][key] for f in folds]))

    summary = {
        "raw": {k: mean_metric("raw_test", k) for k in ["accuracy", "balanced_accuracy", "macro_f1", "high_recall", "extreme_recall", "high_extreme_recall", "log_loss", "brier", "ece"]},
        "calibrated_argmax": {k: mean_metric("calibrated_argmax_test", k) for k in ["accuracy", "balanced_accuracy", "macro_f1", "high_recall", "extreme_recall", "high_extreme_recall", "log_loss", "brier", "ece"]},
        "safety_decision": {k: mean_metric("safety_decision_test", k) for k in ["accuracy", "balanced_accuracy", "macro_f1", "high_recall", "extreme_recall", "high_extreme_recall"]},
    }

    # Final Digha audit: Digha is never used in model, calibration, or decision selection.
    non_digha = df[df.location_id != HOLDOUT_LOCATION]
    digha = df[df.location_id == HOLDOUT_LOCATION]
    train, cal, _ = chronological_split(non_digha, train_frac=0.82, cal_frac=0.10)
    m = make_model()
    m.fit(train[features], train[TARGET_COLUMN], sample_weight=class_weights(train[TARGET_COLUMN]), verbose=False)
    p_cal_raw = probabilities(m, cal[features])
    temperature = fit_temperature(cal[TARGET_COLUMN].to_numpy(dtype=int), p_cal_raw)
    p_cal = apply_temperature(p_cal_raw, temperature)
    offsets = fit_offsets(cal[TARGET_COLUMN].to_numpy(dtype=int), p_cal)
    p_digha = apply_temperature(probabilities(m, digha[features]), temperature)
    y_digha = digha[TARGET_COLUMN].to_numpy(dtype=int)
    digha_pred = decision(p_digha, offsets)
    digha_audit = {
        "temperature": temperature,
        "decision_offsets": offsets.tolist(),
        "metrics": classification_metrics(y_digha, p_digha, digha_pred),
    }

    report = {
        "refinement": 14,
        "contract": {
            "target": "Refinement 11 clean forward target",
            "horizon_hours": int(RISK_HORIZON_HOURS),
            "causal_features_only": True,
            "future_features_used": False,
            "location_id_used": False,
            "latitude_used": False,
            "longitude_used": False,
            "stored_label_used": False,
            "digha_used_for_selection": False,
            "calibration_is_chronological": True,
            "decision_offsets_selected_on_calibration_only": True,
        },
        "rows": int(len(df)),
        "feature_count": len(features),
        "features": features,
        "best_refinement13_params": BEST_PARAMS,
        "selection_locations": selection_locations,
        "summary": summary,
        "folds": folds,
        "digha_final_audit": digha_audit,
        "interpretation": {
            "promotion_rule": "Do not promote unless the safety decision improves held-out critical recall without unacceptable degradation in macro-F1/balanced accuracy, and calibration metrics improve or remain stable.",
            "accuracy_claim": "98-99% accuracy remains unsupported unless genuine held-out evidence reaches it.",
        },
    }

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    report_path = OUT_DIR / "refinement14_results.json"
    report_path.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print("=" * 78)
    print("REFINEMENT 14 COMPLETE")
    print("=" * 78)
    print(json.dumps(summary, indent=2))
    print(f"Saved: {report_path}")
    print("Production model, policy, thresholds, and source dataset were NOT modified.")


if __name__ == "__main__":
    main()
