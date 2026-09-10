"""Auditable ORCA-X operational marine-risk labels.

These labels are project-specific operational proxies, NOT observed incident
labels and NOT official IMD/INCOIS warning categories.

Policy design principles:
- sustained wind is the primary wind-severity signal;
- wind gust is a secondary escalation signal and cannot create EXTREME alone;
- significant wave height is the primary sea-state signal;
- swell is a supporting modifier, not an independent EXTREME trigger;
- EXTREME requires a severe sustained/sea-state factor or a documented
  compound gale + rough-sea condition.

Reference anchors:
- IMD/RSMC marine products use 25 kt and 34 kt wind exceedance bands.
- WMO/Douglas sea-state terminology uses rough = 2.5-4 m, very rough =
  4-6 m, high = 6-9 m.

The policy is intentionally documented as an ORCA-X operational
classification. It must not be presented as an official warning category.
"""
from __future__ import annotations

import pandas as pd

POLICY_VERSION = "orca-operational-risk-v3-sustained-wind-sea-state"
RISK_CLASS_NAMES = {0: "LOW", 1: "MODERATE", 2: "HIGH", 3: "EXTREME"}

WIND_CAUTION_KTS = 25.0
WIND_GALE_KTS = 34.0
WIND_EXTREME_KTS = 48.0

SEA_SLIGHT_MAX_M = 1.25
SEA_MODERATE_MAX_M = 2.50
SEA_ROUGH_MAX_M = 4.00
SEA_VERY_ROUGH_MAX_M = 6.00

SWELL_MODERATE_M = 2.00
SWELL_HEAVY_M = 4.00


def _value(value: float | None) -> float | None:
    if value is None or pd.isna(value):
        return None
    return float(value)


def _sustained_wind_severity(wind: float | None) -> int:
    value = _value(wind)
    if value is None:
        return 0
    if value >= WIND_EXTREME_KTS:
        return 3
    if value >= WIND_GALE_KTS:
        return 2
    if value >= WIND_CAUTION_KTS:
        return 1
    return 0


def _sea_severity(wave: float | None, swell: float | None) -> int:
    """Return significant-sea severity with swell as a supporting modifier."""
    wave_value = _value(wave)
    swell_value = _value(swell)
    severity = 0

    if wave_value is not None:
        if wave_value >= SEA_VERY_ROUGH_MAX_M:
            severity = 3
        elif wave_value >= SEA_ROUGH_MAX_M:
            severity = 2
        elif wave_value >= SEA_MODERATE_MAX_M:
            severity = 1
        elif wave_value >= SEA_SLIGHT_MAX_M:
            severity = 1

    if swell_value is not None:
        if swell_value >= SWELL_HEAVY_M:
            severity = max(severity, 2)
        elif swell_value >= SWELL_MODERATE_M:
            severity = max(severity, 1)

    return severity


def assign_operational_risk(row: pd.Series) -> int:
    """Return ORCA-X operational class: 0 LOW, 1 MODERATE, 2 HIGH, 3 EXTREME.

    Wind gusts are deliberately not treated as sustained wind. This prevents a
    gust-heavy archive from turning routine observations into EXTREME labels.
    A gust can contribute to HIGH only when sustained wind is already at least
    caution-level. EXTREME requires sustained wind >=48 kt, wave >=6 m, or
    sustained gale wind (>=34 kt) together with rough sea (>=4 m).
    """
    sustained_wind = _value(row.get("wind_speed_kts"))
    gust = _value(row.get("wind_gust_kts"))
    wind = _sustained_wind_severity(sustained_wind)
    sea = _sea_severity(row.get("wave_height_m"), row.get("swell_height_m"))

    # Severe single-factor conditions. Gust alone is intentionally excluded.
    if (sustained_wind is not None and sustained_wind >= WIND_EXTREME_KTS) or sea >= 3:
        return 3

    # Compound sustained gale + rough sea.
    wave = _value(row.get("wave_height_m"))
    if sustained_wind is not None and sustained_wind >= WIND_GALE_KTS and wave is not None and wave >= SEA_ROUGH_MAX_M:
        return 3

    # Primary high-risk conditions.
    if wind >= 2 or sea >= 2:
        return 2

    # Gusts are secondary: a caution-level sustained wind plus a gale/extreme
    # gust is escalated to HIGH, but a gust by itself cannot make HIGH/EXTREME.
    if wind >= 1 and gust is not None and gust >= WIND_GALE_KTS:
        return 2

    if wind >= 1 or sea >= 1:
        return 1

    return 0


# Backward-compatible import name for existing scripts.
assign_proxy_risk = assign_operational_risk
