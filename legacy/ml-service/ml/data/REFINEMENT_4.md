# ORCA-X Refinement 4 — Real Marine Risk Model

## Objective

Upgrade the XGBoost model from the original NOAA NDBC-only 14-feature contract to a reproducible historical environmental dataset covering representative Indian coastal regions.

## Historical source

The v2 pipeline uses Open-Meteo Historical Weather and Marine APIs. The marine API provides wave height/direction/period, wind-wave and swell components, and sea-surface temperature; the historical weather API provides variables such as wind, gusts, precipitation, visibility and pressure.

- https://open-meteo.com/en/docs/historical-weather-api
- https://open-meteo.com/en/docs/marine-weather-api

The repository does **not** commit the generated raw/processed dataset. The downloader recreates it locally.

## Locations

- Digha Coast, West Bengal
- Paradip Coast, Odisha
- Visakhapatnam Coast, Andhra Pradesh
- Chennai Coast, Tamil Nadu
- Goa Coast, Goa
- Kochi Coast, Kerala

Default historical period: 2020-01-01 through 2025-12-31.

## Feature contract

18 features are used by v2:

`wind_speed_kts`, `wind_gust_kts`, `wave_height_m`, `wave_period_s`, `swell_height_m`, `swell_period_s`, `wind_direction_deg`, `wave_direction_deg`, `swell_direction_deg`, `air_pressure_hpa`, `air_temperature_c`, `sea_surface_temperature_c`, `precipitation_mm`, `visibility_km`, `latitude`, `longitude`, `month`, `season`.

## Label policy

The target is an **ORCA-X operational risk proxy**, not an observed accident label and not an official warning class.

The policy is anchored to:

1. IMD/RSMC marine products that explicitly publish probability/warning thresholds around 25 kt and 34 kt.
2. WMO Douglas sea-state terminology: slight 0.5–1.25 m, moderate 1.25–2.5 m, rough 2.5–4 m, very rough 4–6 m.

ORCA-X then maps the maximum wind/gust and sea/swell severity into LOW, MODERATE, HIGH and EXTREME. This mapping is project-specific and must remain visibly documented.

Authoritative IMD/INCOIS warnings remain higher-priority evidence for operational decisions.

## Evaluation design

The v2 trainer performs:

- temporal validation on the non-Digha locations;
- a complete spatial holdout of Digha;
- a final production fit on all historical observations after evaluation.

The metadata records accuracy, macro-F1, weighted-F1, classification reports and confusion matrices.

## Run locally

```bash
python ml/src/download_historical_marine.py
python ml/src/prepare_dataset.py
python ml/src/train.py
python -m unittest ml/tests/test_inference_contract.py
```

For a smaller first download:

```bash
python ml/src/download_historical_marine.py --start 2024-01-01 --end 2025-12-31
```

The generated dataset is ignored by Git. The model metadata records the exact feature contract and evaluation results.
