#!/usr/bin/env python3
"""Normalize a MOSDAC HDF/HDF5 satellite product into the ORCA-X source cache.

The download itself must come from the official MOSDAC API/client. This utility only
reads the downloaded product and writes a small, credential-free JSON snapshot for the
ORCA-X realtime fusion layer.

Typical use:
  python scripts/mosdac-normalize.py --input /path/to/3SIMG_L3B_SST.h5 \
      --latitude 21.63 --longitude 87.51 \
      --output data/realtime/mosdac_latest.json

The parser intentionally accepts common HDF5 layouts instead of assuming a private
MOSDAC endpoint. It looks for latitude/longitude and SST datasets recursively and
performs nearest-pixel selection.
"""
from __future__ import annotations

import argparse
import json
import math
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import h5py
import numpy as np


def find_dataset(handle: h5py.File, names: set[str]) -> h5py.Dataset | None:
    found: list[h5py.Dataset] = []

    def visitor(_name: str, obj: Any) -> None:
        if isinstance(obj, h5py.Dataset) and obj.name.rsplit('/', 1)[-1].lower() in names:
            found.append(obj)

    handle.visititems(visitor)
    return found[0] if found else None


def as_array(dataset: h5py.Dataset) -> np.ndarray:
    values = np.asarray(dataset[()])
    if values.dtype.kind not in 'fiu':
        values = values.astype(float)
    return values.astype(float, copy=False)


def valid_mask(values: np.ndarray, dataset: h5py.Dataset) -> np.ndarray:
    mask = np.isfinite(values)
    for attribute in ('_FillValue', 'missing_value'):
        if attribute in dataset.attrs:
            raw = np.asarray(dataset.attrs[attribute]).reshape(-1)
            for value in raw:
                try:
                    mask &= values != float(value)
                except (TypeError, ValueError):
                    pass
    return mask


def scalar_at(values: np.ndarray, index: tuple[int, ...]) -> float | None:
    value = float(values[index])
    return value if math.isfinite(value) else None


def nearest_index(latitudes: np.ndarray, longitudes: np.ndarray, target_lat: float, target_lon: float) -> tuple[int, ...]:
    if latitudes.shape != longitudes.shape:
        raise ValueError(f'Latitude and longitude shapes differ: {latitudes.shape} vs {longitudes.shape}')
    valid = np.isfinite(latitudes) & np.isfinite(longitudes)
    if not valid.any():
        raise ValueError('No finite latitude/longitude pixels were found in the product.')
    lon_delta = np.abs(longitudes - target_lon)
    lon_delta = np.minimum(lon_delta, 360.0 - lon_delta)
    distance = (latitudes - target_lat) ** 2 + lon_delta ** 2
    distance[~valid] = np.inf
    return np.unravel_index(int(np.argmin(distance)), distance.shape)


def parse_filename_time(path: Path) -> str | None:
    match = re.search(r'(20\d{2})(\d{2})(\d{2})(\d{2})(\d{2})', path.name)
    if not match:
        return None
    year, month, day, hour, minute = map(int, match.groups())
    return datetime(year, month, day, hour, minute, tzinfo=timezone.utc).isoformat().replace('+00:00', 'Z')


def convert_sst_to_celsius(value: float, dataset: h5py.Dataset) -> float:
    units = str(dataset.attrs.get('units', '')).lower()
    if 'kelvin' in units or value > 150:
        return value - 273.15
    return value


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--input', required=True)
    parser.add_argument('--latitude', type=float, required=True)
    parser.add_argument('--longitude', type=float, required=True)
    parser.add_argument('--output', default='data/realtime/mosdac_latest.json')
    parser.add_argument('--observed-at', default='')
    args = parser.parse_args()

    input_path = Path(args.input)
    output_path = Path(args.output)
    if not input_path.exists():
        raise FileNotFoundError(input_path)

    with h5py.File(input_path, 'r') as handle:
        lat_dataset = find_dataset(handle, {'latitude', 'lat', 'latitude_data'})
        lon_dataset = find_dataset(handle, {'longitude', 'lon', 'longitude_data'})
        sst_dataset = find_dataset(handle, {'sst', 'sea_surface_temperature', 'sea_surface_temp'})
        if not lat_dataset or not lon_dataset or not sst_dataset:
            raise ValueError('Could not locate latitude, longitude and SST datasets in the HDF5 product.')

        latitudes = as_array(lat_dataset)
        longitudes = as_array(lon_dataset)
        sst = as_array(sst_dataset)
        if latitudes.shape != longitudes.shape:
            raise ValueError('Latitude and longitude grids are not shape-compatible.')
        if sst.shape != latitudes.shape:
            if sst.size == latitudes.size:
                sst = sst.reshape(latitudes.shape)
            else:
                raise ValueError(f'SST shape {sst.shape} cannot be aligned to coordinate shape {latitudes.shape}.')

        index = nearest_index(latitudes, longitudes, args.latitude, args.longitude)
        sst_value = scalar_at(sst, index)
        if sst_value is None or not valid_mask(sst, sst_dataset)[index]:
            raise ValueError('Nearest MOSDAC SST pixel is missing/invalid.')
        sst_c = convert_sst_to_celsius(sst_value, sst_dataset)
        observed_at = args.observed_at or parse_filename_time(input_path) or datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')
        retrieved_at = datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')

        payload = {
            'source': 'MOSDAC / ISRO',
            'product': input_path.name,
            'latitude': float(latitudes[index]),
            'longitude': float(longitudes[index]),
            'observedAt': observed_at,
            'retrievedAt': retrieved_at,
            'values': {'seaSurfaceTemperatureC': round(float(sst_c), 3)},
            'warnings': [
                'Normalized from an official MOSDAC satellite product. Only variables present in the product are exported; ORCA-X does not synthesize missing wind/wave fields.',
            ],
        }

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(payload, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(payload, indent=2))


if __name__ == '__main__':
    main()
