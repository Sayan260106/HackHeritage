from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]
ML_ROOT = PROJECT_ROOT / "ml"
RAW_DIR = ML_ROOT / "data" / "raw" / "ndbc"
RAW_HISTORICAL_DIR = ML_ROOT / "data" / "raw" / "open_meteo"
PROCESSED_DIR = ML_ROOT / "data" / "processed"
MODELS_DIR = ML_ROOT / "models"

DEFAULT_STATIONS = ["41001", "41002", "42002"]
DEFAULT_YEARS = [2024, 2025]
NDBC_BASE = "https://www.ndbc.noaa.gov/data/historical/stdmet"

DATASET_NAME = "ORCA-X Historical Marine Risk Dataset"
DATASET_VERSION = "2.3-operational-risk-policy-v3-forward-6h"
TARGET_COLUMN = "risk_class"

FEATURE_COLUMNS = [
    "wind_speed_kts", "wind_gust_kts", "wave_height_m", "wave_period_s",
    "swell_height_m", "swell_period_s", "wind_direction_deg", "wave_direction_deg",
    "swell_direction_deg", "air_pressure_hpa", "air_temperature_c",
    "sea_surface_temperature_c", "precipitation_mm", "latitude", "longitude",
    "month", "season",
]

HISTORICAL_LOCATIONS = [
    {"id": "digha_wb", "name": "Digha Coast", "region": "West Bengal", "latitude": 21.626, "longitude": 87.508},
    {"id": "paradip_od", "name": "Paradip Coast", "region": "Odisha", "latitude": 20.264, "longitude": 86.679},
    {"id": "vizag_ap", "name": "Visakhapatnam Coast", "region": "Andhra Pradesh", "latitude": 17.686, "longitude": 83.218},
    {"id": "chennai_tn", "name": "Chennai Coast", "region": "Tamil Nadu", "latitude": 13.082, "longitude": 80.271},
    {"id": "goa", "name": "Goa Coast", "region": "Goa", "latitude": 15.300, "longitude": 73.800},
    {"id": "kochi_kl", "name": "Kochi Coast", "region": "Kerala", "latitude": 9.931, "longitude": 76.267},
]

HISTORICAL_START_DATE = "2020-01-01"
HISTORICAL_END_DATE = "2025-12-31"

RISK_CLASS_NAMES = {0: "LOW", 1: "MODERATE", 2: "HIGH", 3: "EXTREME"}
RISK_HORIZON_HOURS = 6
RISK_POLICY_VERSION = "orca-operational-risk-v3-sustained-wind-sea-state"
