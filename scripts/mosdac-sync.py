#!/usr/bin/env python3
"""Refresh the ORCA-X MOSDAC SST snapshot through the official MOSDAC client.

This worker deliberately delegates authentication and data download to the official
MOSDAC Data Download API client. Credentials are read only from environment variables
and are written only to a temporary config.json consumed by that client.

Required environment variables:
  MOSDAC_USERNAME
  MOSDAC_PASSWORD

Useful optional variables:
  MOSDAC_DATASET_ID=3SIMG_L3B_SST
  MOSDAC_TARGET_LATITUDE=21.6266
  MOSDAC_TARGET_LONGITUDE=87.5074
  MOSDAC_BOUNDING_BOX=87.20,21.40,87.80,21.90
  MOSDAC_LOOKBACK_DAYS=2
  MOSDAC_COUNT=1
  MOSDAC_OUTPUT=data/realtime/mosdac_latest.json
  MOSDAC_MDAPI_DIR=<directory containing the official mdapi.py>
  MOSDAC_AUTO_DOWNLOAD_CLIENT=false
  MOSDAC_CLIENT_URL=https://www.mosdac.gov.in/software/mdapi.zip

The official MOSDAC client is never committed to this repository. When
MOSDAC_AUTO_DOWNLOAD_CLIENT=true, it is downloaded to a temporary directory and
removed after the refresh.
"""
from __future__ import annotations

import datetime as dt
import json
import os
import shutil
import subprocess
import sys
import tempfile
import urllib.request
import zipfile
from pathlib import Path


DEFAULT_CLIENT_URL = "https://www.mosdac.gov.in/software/mdapi.zip"
DEFAULT_DATASET_ID = "3SIMG_L3B_SST"
DEFAULT_LATITUDE = 21.6266
DEFAULT_LONGITUDE = 87.5074
DEFAULT_BBOX = "87.20,21.40,87.80,21.90"


def env_required(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise RuntimeError(f"Missing required environment variable: {name}")
    return value


def env_float(name: str, default: float) -> float:
    raw = os.environ.get(name)
    if not raw:
        return default
    try:
        return float(raw)
    except ValueError as exc:
        raise RuntimeError(f"{name} must be numeric") from exc


def env_int(name: str, default: int) -> int:
    raw = os.environ.get(name)
    if not raw:
        return default
    try:
        return int(raw)
    except ValueError as exc:
        raise RuntimeError(f"{name} must be an integer") from exc


def locate_mdapi(root: Path) -> Path:
    matches = list(root.rglob("mdapi.py"))
    if not matches:
        raise RuntimeError(f"Could not find mdapi.py under {root}")
    return matches[0]


def prepare_client(temp_root: Path) -> Path:
    configured_dir = os.environ.get("MOSDAC_MDAPI_DIR", "").strip()
    auto_download = os.environ.get("MOSDAC_AUTO_DOWNLOAD_CLIENT", "false").lower() == "true"

    if configured_dir:
        source = Path(configured_dir).expanduser().resolve()
        if not source.exists():
            raise RuntimeError(f"MOSDAC_MDAPI_DIR does not exist: {source}")
        client_root = temp_root / "client"
        shutil.copytree(source, client_root)
        return locate_mdapi(client_root)

    if not auto_download:
        raise RuntimeError(
            "Set MOSDAC_MDAPI_DIR to the official mdapi folder, or set "
            "MOSDAC_AUTO_DOWNLOAD_CLIENT=true to download the official client temporarily."
        )

    client_zip = temp_root / "mdapi.zip"
    client_root = temp_root / "client"
    url = os.environ.get("MOSDAC_CLIENT_URL", DEFAULT_CLIENT_URL).strip() or DEFAULT_CLIENT_URL
    request = urllib.request.Request(url, headers={"User-Agent": "ORCA-X MOSDAC refresh worker"})
    with urllib.request.urlopen(request, timeout=30) as response, client_zip.open("wb") as output:
        shutil.copyfileobj(response, output)
    client_root.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(client_zip) as archive:
        archive.extractall(client_root)
    return locate_mdapi(client_root)


def build_config(
    username: str,
    password: str,
    dataset_id: str,
    start_date: str,
    end_date: str,
    count: int,
    bounding_box: str,
    download_path: Path,
    error_log_path: Path,
) -> dict[str, object]:
    return {
        "user_credentials": {"username": username, "password": password},
        "search_parameters": {
            "datasetId": dataset_id,
            "startTime": start_date,
            "endTime": end_date,
            "count": str(min(max(count, 1), 100)),
            "boundingBox": bounding_box,
            "gId": "",
        },
        "download_settings": {
            "download_path": str(download_path),
            "organize_by_date": False,
            "skip_user_prompt": True,
            "generate_error_log": True,
            "error_log_path": str(error_log_path),
        },
    }


def newest_hdf(download_path: Path, dataset_id: str) -> Path:
    candidates = [
        path
        for path in download_path.rglob("*")
        if path.is_file() and path.suffix.lower() in {".h5", ".hdf", ".hdf5"}
    ]
    if not candidates:
        raise RuntimeError(f"MOSDAC download completed without an HDF/HDF5 product under {download_path}")
    dataset_matches = [path for path in candidates if dataset_id.lower() in path.name.lower()]
    pool = dataset_matches or candidates
    return max(pool, key=lambda path: path.stat().st_mtime)


def run_client(mdapi: Path, config: dict[str, object], work_root: Path) -> Path:
    config_path = mdapi.parent / "config.json"
    download_path = Path(str(config["download_settings"]["download_path"]))
    error_log_path = Path(str(config["download_settings"]["error_log_path"]))
    download_path.mkdir(parents=True, exist_ok=True)
    error_log_path.mkdir(parents=True, exist_ok=True)
    config_path.write_text(json.dumps(config, indent=2), encoding="utf-8")
    try:
        result = subprocess.run(
            [sys.executable, mdapi.name],
            cwd=mdapi.parent,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
            text=True,
            timeout=15 * 60,
            check=False,
        )
        if result.returncode != 0:
            raise RuntimeError(
                "Official MOSDAC client failed with exit code "
                f"{result.returncode}. Check the MOSDAC client error log under {error_log_path}."
            )
        return newest_hdf(download_path, str(config["search_parameters"]["datasetId"]))
    finally:
        config_path.unlink(missing_ok=True)


def normalize(product: Path, output: Path, latitude: float, longitude: float, work_root: Path) -> None:
    temp_output = work_root / "mosdac_latest.json"
    command = [
        sys.executable,
        str(Path(__file__).with_name("mosdac-normalize.py")),
        "--input",
        str(product),
        "--latitude",
        str(latitude),
        "--longitude",
        str(longitude),
        "--output",
        str(temp_output),
    ]
    result = subprocess.run(command, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True, check=False)
    if result.returncode != 0:
        raise RuntimeError(f"MOSDAC normalization failed: {result.stderr.strip()[-500:]}")

    payload = json.loads(temp_output.read_text(encoding="utf-8"))
    if payload.get("source") != "MOSDAC / ISRO":
        raise RuntimeError("MOSDAC normalization returned an unexpected source marker")
    values = payload.get("values")
    if not isinstance(values, dict) or not isinstance(values.get("seaSurfaceTemperatureC"), (int, float)):
        raise RuntimeError("MOSDAC normalization produced no numeric seaSurfaceTemperatureC")

    output.parent.mkdir(parents=True, exist_ok=True)
    temp_publish = output.with_suffix(output.suffix + ".tmp")
    temp_publish.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    temp_publish.replace(output)


def main() -> int:
    username = env_required("MOSDAC_USERNAME")
    password = env_required("MOSDAC_PASSWORD")
    dataset_id = os.environ.get("MOSDAC_DATASET_ID", DEFAULT_DATASET_ID).strip() or DEFAULT_DATASET_ID
    latitude = env_float("MOSDAC_TARGET_LATITUDE", DEFAULT_LATITUDE)
    longitude = env_float("MOSDAC_TARGET_LONGITUDE", DEFAULT_LONGITUDE)
    bbox = os.environ.get("MOSDAC_BOUNDING_BOX", DEFAULT_BBOX).strip() or DEFAULT_BBOX
    lookback_days = max(env_int("MOSDAC_LOOKBACK_DAYS", 2), 1)
    count = env_int("MOSDAC_COUNT", 1)
    output = Path(os.environ.get("MOSDAC_OUTPUT", "data/realtime/mosdac_latest.json")).expanduser().resolve()

    today = dt.datetime.now(dt.timezone.utc).date()
    start_date = (today - dt.timedelta(days=lookback_days)).isoformat()
    end_date = today.isoformat()

    with tempfile.TemporaryDirectory(prefix="orca-mosdac-") as temp_dir:
        temp_root = Path(temp_dir)
        mdapi = prepare_client(temp_root)
        download_path = temp_root / "downloads"
        error_log_path = temp_root / "error_logs"
        config = build_config(
            username,
            password,
            dataset_id,
            start_date,
            end_date,
            count,
            bbox,
            download_path,
            error_log_path,
        )
        product = run_client(mdapi, config, temp_root)
        normalize(product, output, latitude, longitude, temp_root)

    print(json.dumps({
        "status": "LIVE",
        "datasetId": dataset_id,
        "product": product.name,
        "output": str(output),
        "target": {"latitude": latitude, "longitude": longitude},
        "window": {"start": start_date, "end": end_date},
    }, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
