"""Small regression suite for the safety-critical ORCA-X label policy."""
from __future__ import annotations

import pandas as pd

from label_policy import assign_operational_risk


def risk(**kwargs):
    base = {
        "wind_speed_kts": 10.0,
        "wind_gust_kts": 20.0,
        "wave_height_m": 1.0,
        "swell_height_m": 1.0,
    }
    base.update(kwargs)
    return assign_operational_risk(pd.Series(base))


def main() -> None:
    checks = {
        "calm_is_low": risk() == 0,
        "caution_wind_is_moderate": risk(wind_speed_kts=25.0, wind_gust_kts=30.0) == 1,
        "gale_is_high": risk(wind_speed_kts=34.0, wind_gust_kts=40.0) == 2,
        "extreme_sustained_wind": risk(wind_speed_kts=48.0, wind_gust_kts=60.0) == 3,
        "extreme_wave": risk(wave_height_m=6.0) == 3,
        "compound_extreme": risk(wind_speed_kts=34.0, wave_height_m=4.0) == 3,
        "gust_alone_cannot_be_extreme": risk(wind_speed_kts=15.0, wind_gust_kts=80.0) != 3,
        "gust_alone_cannot_be_high": risk(wind_speed_kts=15.0, wind_gust_kts=80.0) == 0,
        "caution_wind_plus_gale_gust_is_high": risk(wind_speed_kts=25.0, wind_gust_kts=34.0) == 2,
    }
    failed = [name for name, ok in checks.items() if not ok]
    for name, ok in checks.items():
        print(f"{'PASS' if ok else 'FAIL'}: {name}")
    if failed:
        raise SystemExit(f"Policy regression checks failed: {failed}")
    print("All ORCA-X label-policy checks passed.")


if __name__ == "__main__":
    main()
