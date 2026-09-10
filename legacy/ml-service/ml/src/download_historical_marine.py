"""Download reproducible historical marine + weather observations for ORCA-X.

Source: Open-Meteo Historical Weather + Marine APIs. The script stores the raw
JSON responses unchanged enough to audit/recreate the processed dataset.
"""
from __future__ import annotations

import argparse
import json
import time
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from config import HISTORICAL_LOCATIONS, HISTORICAL_START_DATE, HISTORICAL_END_DATE, RAW_HISTORICAL_DIR

WEATHER_ENDPOINT = "https://archive-api.open-meteo.com/v1/archive"
MARINE_ENDPOINT = "https://marine-api.open-meteo.com/v1/marine"

WEATHER_VARIABLES = [
    "wind_speed_10m",
    "wind_gusts_10m",
    "wind_direction_10m",
    "temperature_2m",
    "precipitation",
    "visibility",
    "pressure_msl",
]

MARINE_VARIABLES = [
    "wave_height",
    "wave_direction",
    "wave_period",
    "swell_wave_height",
    "swell_wave_direction",
    "swell_wave_period",
    "sea_surface_temperature",
]


def get_json(endpoint: str, params: dict) -> dict:
    url = f"{endpoint}?{urlencode(params)}"
    request = Request(url, headers={"User-Agent": "ORCA-X/2.0 research dataset downloader"})
    with urlopen(request, timeout=120) as response:
        return json.loads(response.read().decode("utf-8"))


def download_location(location: dict, start_date: str, end_date: str) -> None:
    slug = location["id"]
    output_dir = RAW_HISTORICAL_DIR / slug
    output_dir.mkdir(parents=True, exist_ok=True)

    common = {
        "latitude": location["latitude"],
        "longitude": location["longitude"],
        "start_date": start_date,
        "end_date": end_date,
        "timezone": "UTC",
    }

    weather_path = output_dir / f"weather_{start_date}_{end_date}.json"
    marine_path = output_dir / f"marine_{start_date}_{end_date}.json"

    if not weather_path.exists():
        print(f"GET weather {slug}")
        weather = get_json(WEATHER_ENDPOINT, {**common, "hourly": ",".join(WEATHER_VARIABLES)})
        weather_path.write_text(json.dumps(weather), encoding="utf-8")
    else:
        print(f"SKIP weather {slug}")

    if not marine_path.exists():
        print(f"GET marine  {slug}")
        marine = get_json(MARINE_ENDPOINT, {**common, "hourly": ",".join(MARINE_VARIABLES)})
        marine_path.write_text(json.dumps(marine), encoding="utf-8")
    else:
        print(f"SKIP marine  {slug}")

    time.sleep(0.5)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--start", default=HISTORICAL_START_DATE)
    parser.add_argument("--end", default=HISTORICAL_END_DATE)
    parser.add_argument("--locations", nargs="*", default=None)
    args = parser.parse_args()

    selected = HISTORICAL_LOCATIONS
    if args.locations:
        wanted = set(args.locations)
        selected = [item for item in HISTORICAL_LOCATIONS if item["id"] in wanted]
        missing = wanted - {item["id"] for item in selected}
        if missing:
            raise SystemExit(f"Unknown location ids: {sorted(missing)}")

    RAW_HISTORICAL_DIR.mkdir(parents=True, exist_ok=True)
    for location in selected:
        download_location(location, args.start, args.end)

    print("Historical Open-Meteo marine/weather download complete.")
    print(f"Raw directory: {RAW_HISTORICAL_DIR}")


if __name__ == "__main__":
    main()
