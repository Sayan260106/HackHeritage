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


def attr_float(dataset: h5py.Dataset, names: tuple[str, ...], default: float) -> float:
    for name in names:
        if name in dataset.attrs:
            try:
                raw = np.asarray(dataset.attrs[name]).reshape(-1)
                if len(raw) > 0 and math.isfinite(float(raw[0])):
                    return float(raw[0])
            except Exception:
                pass
    return default


def as_array(dataset: h5py.Dataset) -> np.ndarray:
    values = np.asarray(dataset[()])
    if values.dtype.kind not in 'fiu':
        values = values.astype(float)
    else:
        values = values.astype(float, copy=False)
    scale = attr_float(dataset, ('scale_factor', 'Scale', 'slope'), 1.0)
    offset = attr_float(dataset, ('add_offset', 'Offset', 'intercept'), 0.0)
    if scale != 1.0 or offset != 0.0:
        values = values * scale + offset
    else:
        name_lower = dataset.name.rsplit('/', 1)[-1].lower()
        if any(term in name_lower for term in ('lat', 'lon')):
            valid_vals = values[np.isfinite(values) & (np.abs(values) < 100000)]
            if valid_vals.size > 0 and np.max(np.abs(valid_vals)) > 180:
                values = values * 0.01
    return values


def to_celsius(values: np.ndarray, dataset: h5py.Dataset) -> np.ndarray:
    units = str(dataset.attrs.get('units', '')).strip().lower()
    c = values.copy()
    fill_vals: list[float] = []
    for attribute in ('_FillValue', 'missing_value'):
        if attribute in dataset.attrs:
            raw = np.asarray(dataset.attrs[attribute]).reshape(-1)
            for v in raw:
                try:
                    fill_vals.append(float(v))
                except (TypeError, ValueError):
                    pass
    for f in fill_vals:
        c[c == f] = np.nan

    valid_pts = c[np.isfinite(c) & (c > 150)]
    if units in ('k', 'kelvin', "b'k'", "b'kelvin'") or (valid_pts.size > 0 and np.nanmedian(valid_pts) > 200):
        c = c - 273.15
    return c


def valid_sst_mask(values_celsius: np.ndarray, dataset: h5py.Dataset) -> np.ndarray:
    return np.isfinite(values_celsius) & (values_celsius >= 0.0) & (values_celsius <= 45.0)


def scalar_at(values: np.ndarray, index: tuple[int, ...]) -> float | None:
    value = float(values[index])
    return value if math.isfinite(value) else None


def nearest_index(latitudes: np.ndarray, longitudes: np.ndarray, target_lat: float, target_lon: float, mask: np.ndarray | None = None) -> tuple[int, ...]:
    if latitudes.shape != longitudes.shape:
        raise ValueError(f'Latitude and longitude shapes differ: {latitudes.shape} vs {longitudes.shape}')
    valid = np.isfinite(latitudes) & np.isfinite(longitudes)
    if mask is not None:
        if mask.any():
            valid &= mask
        else:
            raise ValueError('No cloud-free ocean pixels with physically valid SST (0-45°C) found in this satellite scene.')
    if not valid.any():
        raise ValueError('No finite latitude/longitude pixels were found in the product.')
    lon_delta = np.abs(longitudes - target_lon)
    lon_delta = np.minimum(lon_delta, 360.0 - lon_delta)
    distance = (latitudes - target_lat) ** 2 + lon_delta ** 2
    distance[~valid] = np.inf
    return np.unravel_index(int(np.argmin(distance)), distance.shape)


def parse_filename_time(path: Path) -> str | None:
    match_insat = re.search(r'(\d{2})([A-Za-z]{3})(20\d{2})_(\d{2})(\d{2})', path.name)
    if match_insat:
        day, month_name, year, hour, minute = match_insat.groups()
        try:
            parsed = datetime.strptime(f"{year}-{month_name}-{day} {hour}:{minute}", "%Y-%b-%d %H:%M")
            return parsed.replace(tzinfo=timezone.utc).isoformat().replace('+00:00', 'Z')
        except ValueError:
            pass
    match = re.search(r'(20\d{2})(\d{2})(\d{2})(\d{2})(\d{2})', path.name)
    if match:
        year, month, day, hour, minute = map(int, match.groups())
        return datetime(year, month, day, hour, minute, tzinfo=timezone.utc).isoformat().replace('+00:00', 'Z')
    return None


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
        all_ds: list[str] = []
        handle.visititems(lambda name, obj: all_ds.append(name) if isinstance(obj, h5py.Dataset) else None)
        lat_dataset = find_dataset(handle, {'latitude', 'lat', 'latitude_data', 'latitudes', 'lats'})
        lon_dataset = find_dataset(handle, {'longitude', 'lon', 'longitude_data', 'longitudes', 'lons'})
        sst_dataset = find_dataset(handle, {
            'sst_reg', 'sst', 'sea_surface_temperature', 'sea_surface_temp',
            'sst_fct', 'sst_var', 'sst_data', 'sst_retrieval'
        })
        if not lat_dataset or not lon_dataset or not sst_dataset:
            missing = []
            if not lat_dataset: missing.append("latitude")
            if not lon_dataset: missing.append("longitude")
            if not sst_dataset: missing.append("SST")
            raise ValueError(
                f'Could not locate {", ".join(missing)} datasets in {input_path.name}. '
                f'Available datasets in HDF5: {all_ds}'
            )

        latitudes = as_array(lat_dataset)
        longitudes = as_array(lon_dataset)
        sst_raw = as_array(sst_dataset)
        if latitudes.ndim == 1 and longitudes.ndim == 1 and (latitudes.shape != longitudes.shape or sst_raw.ndim == 2):
            latitudes, longitudes = np.meshgrid(latitudes, longitudes, indexing='ij')
        if latitudes.shape != longitudes.shape:
            raise ValueError(f'Latitude and longitude grids are not shape-compatible: {latitudes.shape} vs {longitudes.shape}.')
        if sst_raw.shape != latitudes.shape:
            if sst_raw.size == latitudes.size:
                sst_raw = sst_raw.reshape(latitudes.shape)
            else:
                raise ValueError(f'SST shape {sst_raw.shape} cannot be aligned to coordinate shape {latitudes.shape}.')

        sst_c = to_celsius(sst_raw, sst_dataset)
        sst_mask = valid_sst_mask(sst_c, sst_dataset)
        index = nearest_index(latitudes, longitudes, args.latitude, args.longitude, mask=sst_mask)
        sst_value = scalar_at(sst_c, index)
        if sst_value is None or not sst_mask[index]:
            raise ValueError('Nearest MOSDAC SST pixel is missing/invalid.')
        observed_at = args.observed_at or parse_filename_time(input_path) or datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')
        retrieved_at = datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')

        payload = {
            'source': 'MOSDAC / ISRO',
            'product': input_path.name,
            'latitude': float(latitudes[index]),
            'longitude': float(longitudes[index]),
            'observedAt': observed_at,
            'retrievedAt': retrieved_at,
            'values': {'seaSurfaceTemperatureC': round(float(sst_value), 3)},
            'warnings': [
                'Normalized from an official MOSDAC satellite product. Only variables present in the product are exported; ORCA-X does not synthesize missing wind/wave fields.',
            ],
        }

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(payload, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(payload, indent=2))


if __name__ == '__main__':
    main()
