"""Sweep defensible ORCA-X operational label boundaries before retraining.

This script does NOT optimize labels for ML accuracy. It compares policy
variants using class prevalence and trigger diagnostics so a human can choose
a physically defensible operational policy before training.
"""
from __future__ import annotations

import json
from pathlib import Path
import pandas as pd

from config import MODELS_DIR, PROCESSED_DIR

# Search space deliberately excludes arbitrary EXTREME thresholds. EXTREME
# remains anchored at severe sustained wind/sea-state conditions.
CANDIDATES = [
    {"name": "v3_current", "caution": 25.0, "gale": 34.0, "extreme_wind": 48.0, "moderate_wave": 2.5, "rough_wave": 4.0, "extreme_wave": 6.0, "moderate_swell": 2.0, "heavy_swell": 4.0},
    {"name": "balanced_01", "caution": 25.0, "gale": 34.0, "extreme_wind": 48.0, "moderate_wave": 2.0, "rough_wave": 4.0, "extreme_wave": 6.0, "moderate_swell": 2.0, "heavy_swell": 4.0},
    {"name": "balanced_02", "caution": 27.0, "gale": 34.0, "extreme_wind": 48.0, "moderate_wave": 2.0, "rough_wave": 4.0, "extreme_wave": 6.0, "moderate_swell": 2.0, "heavy_swell": 4.0},
    {"name": "balanced_03", "caution": 25.0, "gale": 36.0, "extreme_wind": 48.0, "moderate_wave": 2.0, "rough_wave": 4.0, "extreme_wave": 6.0, "moderate_swell": 2.0, "heavy_swell": 4.0},
    {"name": "balanced_04", "caution": 25.0, "gale": 34.0, "extreme_wind": 48.0, "moderate_wave": 2.5, "rough_wave": 3.5, "extreme_wave": 6.0, "moderate_swell": 2.0, "heavy_swell": 4.0},
    {"name": "conservative_small_craft", "caution": 25.0, "gale": 34.0, "extreme_wind": 48.0, "moderate_wave": 2.0, "rough_wave": 3.5, "extreme_wave": 6.0, "moderate_swell": 2.0, "heavy_swell": 4.0},
]


def classify(row: pd.Series, p: dict) -> int:
    wind = row["wind_speed_kts"]
    gust = row["wind_gust_kts"]
    wave = row["wave_height_m"]
    swell = row["swell_height_m"]

    wind = None if pd.isna(wind) else float(wind)
    gust = None if pd.isna(gust) else float(gust)
    wave = None if pd.isna(wave) else float(wave)
    swell = None if pd.isna(swell) else float(swell)

    # Severe single factor / compound extreme. Gust alone is never extreme.
    if (wind is not None and wind >= p["extreme_wind"]) or (wave is not None and wave >= p["extreme_wave"]):
        return 3
    if wind is not None and wave is not None and wind >= p["gale"] and wave >= p["rough_wave"]:
        return 3

    wave_high = wave is not None and wave >= p["rough_wave"]
    swell_high = swell is not None and swell >= p["heavy_swell"]
    wind_high = wind is not None and wind >= p["gale"]
    if wind_high or wave_high or swell_high:
        return 2

    # Gust is only an escalation when sustained wind has already crossed caution.
    if wind is not None and wind >= p["caution"] and gust is not None and gust >= p["gale"]:
        return 2

    moderate_wave = wave is not None and wave >= p["moderate_wave"]
    moderate_swell = swell is not None and swell >= p["moderate_swell"]
    moderate_wind = wind is not None and wind >= p["caution"]
    if moderate_wind or moderate_wave or moderate_swell:
        return 1
    return 0


def evaluate(df: pd.DataFrame, p: dict) -> dict:
    labels = df.apply(lambda r: classify(r, p), axis=1)
    counts = labels.value_counts().reindex([0, 1, 2, 3], fill_value=0)
    pct = (counts / len(df) * 100).round(3)
    return {
        "policy": p,
        "class_counts": {str(i): int(counts[i]) for i in range(4)},
        "class_percent": {str(i): float(pct[i]) for i in range(4)},
        "extreme_share": float(pct[3]),
        "high_or_extreme_share": float(pct[2] + pct[3]),
        "moderate_share": float(pct[1]),
    }


def main() -> None:
    path = PROCESSED_DIR / "orca_historical_marine_risk.parquet"
    if not path.exists():
        raise FileNotFoundError("Run prepare_dataset.py first.")
    df = pd.read_parquet(path, columns=["wind_speed_kts", "wind_gust_kts", "wave_height_m", "swell_height_m"])
    results = [evaluate(df, p) for p in CANDIDATES]

    # Diagnostic ranking only. Prefer policies with a meaningful MODERATE class
    # and a narrow EXTREME class; no ML metric is used here.
    def diagnostic_score(r: dict) -> float:
        moderate = r["moderate_share"]
        extreme = r["extreme_share"]
        return abs(moderate - 15.0) + 2.0 * abs(extreme - 5.0)

    ranked = sorted(results, key=diagnostic_score)
    output = {
        "purpose": "Policy diagnostics before model retraining; not ML hyperparameter optimization.",
        "rows": int(len(df)),
        "ranking": [
            {
                **r,
                "diagnostic_score": float(diagnostic_score(r)),
            }
            for r in ranked
        ],
        "selection_warning": "The lowest diagnostic score is only a review aid. Final policy selection must remain physically and operationally defensible and must not be chosen solely for class balance.",
    }
    MODELS_DIR.mkdir(parents=True, exist_ok=True)
    out_path = MODELS_DIR / "risk_policy_sweep.json"
    out_path.write_text(json.dumps(output, indent=2), encoding="utf-8")

    print("ORCA-X RISK POLICY SWEEP")
    print(f"Rows: {len(df):,}")
    print("Name | LOW | MODERATE | HIGH | EXTREME | HIGH+EXTREME")
    print("-" * 72)
    for r in ranked:
        p = r["policy"]
        cp = r["class_percent"]
        print(f"{p['name']} | {cp['0']:.3f}% | {cp['1']:.3f}% | {cp['2']:.3f}% | {cp['3']:.3f}% | {r['high_or_extreme_share']:.3f}%")
    print(f"Saved policy sweep: {out_path}")


if __name__ == "__main__":
    main()
