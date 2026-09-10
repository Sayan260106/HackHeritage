"""Audit ORCA-X operational labels and their trigger composition."""
from __future__ import annotations
import json
from pathlib import Path
import pandas as pd
from config import PROCESSED_DIR
from label_policy import (
    POLICY_VERSION,
    assign_operational_risk,
    RISK_CLASS_NAMES,
    WIND_CAUTION_KTS,
    WIND_GALE_KTS,
    WIND_EXTREME_KTS,
    SEA_SLIGHT_MAX_M,
    SEA_MODERATE_MAX_M,
    SEA_ROUGH_MAX_M,
    SEA_VERY_ROUGH_MAX_M,
    SWELL_MODERATE_M,
    SWELL_HEAVY_M,
)


def _percent(mask, total):
    return round(float(mask.mean() * 100), 3) if total else 0.0


def main():
    path = PROCESSED_DIR / "orca_historical_marine_risk.parquet"
    df = pd.read_parquet(path)
    required = ["wind_speed_kts", "wind_gust_kts", "wave_height_m", "swell_height_m"]
    missing = [c for c in required if c not in df]
    if missing:
        raise ValueError(f"Missing label inputs: {missing}")

    for column in required:
        df[column] = pd.to_numeric(df[column], errors="coerce")

    labels = df.apply(assign_operational_risk, axis=1)
    counts = labels.value_counts().sort_index()
    wind = df["wind_speed_kts"]
    gust = df["wind_gust_kts"]
    wave = df["wave_height_m"]

    severe_single_wind = wind >= WIND_EXTREME_KTS
    severe_single_wave = wave >= SEA_VERY_ROUGH_MAX_M
    compound_gale_rough = (wind >= WIND_GALE_KTS) & (wave >= SEA_ROUGH_MAX_M)
    caution_wind_gale_gust = (wind >= WIND_CAUTION_KTS) & (gust >= WIND_GALE_KTS)
    gust_only_extreme = (gust >= WIND_EXTREME_KTS) & (wind < WIND_EXTREME_KTS)
    high_or_extreme = labels >= 2
    extreme = labels == 3

    report = {
        "rows": int(len(df)),
        "policy_version": POLICY_VERSION,
        "class_counts": {RISK_CLASS_NAMES[int(k)]: int(v) for k, v in counts.items()},
        "class_percent": {RISK_CLASS_NAMES[int(k)]: round(float(v / len(df) * 100), 3) for k, v in counts.items()},
        "thresholds": {
            "wind_caution_kts": WIND_CAUTION_KTS,
            "wind_gale_kts": WIND_GALE_KTS,
            "wind_extreme_kts": WIND_EXTREME_KTS,
            "wave_slight_max_m": SEA_SLIGHT_MAX_M,
            "wave_moderate_max_m": SEA_MODERATE_MAX_M,
            "wave_rough_max_m": SEA_ROUGH_MAX_M,
            "wave_extreme_single_factor_m": SEA_VERY_ROUGH_MAX_M,
            "swell_moderate_m": SWELL_MODERATE_M,
            "swell_heavy_m": SWELL_HEAVY_M,
        },
        "trigger_audit_percent": {
            "sustained_wind_ge_48kt": _percent(severe_single_wind, len(df)),
            "significant_wave_ge_6m": _percent(severe_single_wave, len(df)),
            "sustained_gale_ge_34kt_and_wave_ge_4m": _percent(compound_gale_rough, len(df)),
            "caution_wind_ge_25kt_and_gust_ge_34kt": _percent(caution_wind_gale_gust, len(df)),
            "gust_ge_48kt_without_sustained_extreme": _percent(gust_only_extreme, len(df)),
            "final_extreme_labels": _percent(extreme, len(df)),
            "final_high_or_extreme_labels": _percent(high_or_extreme, len(df)),
        },
        "input_summary": {
            "wind_speed_median_kts": round(float(wind.median()), 3),
            "wind_gust_median_kts": round(float(gust.median()), 3),
            "wind_speed_p95_kts": round(float(wind.quantile(0.95)), 3),
            "wind_gust_p95_kts": round(float(gust.quantile(0.95)), 3),
            "wind_speed_max_kts": round(float(wind.max()), 3),
            "wind_gust_max_kts": round(float(gust.max()), 3),
        },
        "missing_inputs_percent": {c: round(float(df[c].isna().mean() * 100), 3) for c in required},
        "note": (
            "Labels are ORCA-X operational proxies, not observed incidents or official warning labels. "
            "Sustained wind is the primary wind signal; gusts are secondary and cannot independently create EXTREME. "
            "EXTREME requires sustained wind >=48 kt, significant wave >=6 m, or sustained gale + rough sea."
        ),
    }
    out = Path(__file__).resolve().parents[1] / "models" / "risk_label_audit.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report, indent=2))
    print(f"Saved label audit: {out}")


if __name__ == "__main__":
    main()
