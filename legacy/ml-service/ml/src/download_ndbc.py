"""Download real NOAA NDBC historical standard-meteorological observations.

The downloader intentionally keeps raw source files untouched so the dataset can
be reproduced and audited later.
"""

from __future__ import annotations

import argparse
import gzip
import shutil
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from config import DEFAULT_STATIONS, DEFAULT_YEARS, NDBC_BASE, RAW_DIR


def download_file(station: str, year: int) -> Path:
    filename = f"{station}h{year}.txt.gz"
    url = f"{NDBC_BASE}/{filename}"
    station_dir = RAW_DIR / station
    station_dir.mkdir(parents=True, exist_ok=True)
    destination = station_dir / filename

    if destination.exists() and destination.stat().st_size > 0:
        print(f"SKIP  {destination}")
        return destination

    request = Request(url, headers={"User-Agent": "ORCA-X/1.0 research dataset downloader"})
    print(f"GET   {url}")
    try:
        with urlopen(request, timeout=60) as response, destination.open("wb") as out:
            shutil.copyfileobj(response, out)
    except (HTTPError, URLError, TimeoutError) as exc:
        if destination.exists():
            destination.unlink()
        print(f"FAIL  {url} -> {exc}")
        raise SystemExit(2) from exc

    return destination


def validate_gzip(path: Path) -> None:
    with gzip.open(path, "rb") as stream:
        stream.read(128)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--stations", nargs="+", default=DEFAULT_STATIONS)
    parser.add_argument("--years", nargs="+", type=int, default=DEFAULT_YEARS)
    args = parser.parse_args()

    RAW_DIR.mkdir(parents=True, exist_ok=True)
    for station in args.stations:
        for year in args.years:
            path = download_file(station.upper(), year)
            try:
                validate_gzip(path)
            except (OSError, gzip.BadGzipFile) as exc:
                path.unlink(missing_ok=True)
                print(f"FAIL  invalid gzip: {path} -> {exc}")
                raise SystemExit(3) from exc

    print()
    print("NDBC raw-data download complete.")
    print(f"Raw data directory: {RAW_DIR}")


if __name__ == "__main__":
    main()
