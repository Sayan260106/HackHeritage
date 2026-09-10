"""Prepare the canonical ORCA-X dataset inside a Colab runtime.

The processed parquet is intentionally not required to be committed to Git. A
fresh Colab clone therefore needs a deterministic way to recreate it from the
project's real Open-Meteo historical sources before training/refinements run.
"""
from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

from config import PROCESSED_DIR

ROOT = Path(__file__).resolve().parents[2]
DATA = PROCESSED_DIR / "orca_historical_marine_risk.parquet"


def run(script: str, *args: str) -> None:
    cmd = [sys.executable, str(ROOT / "ml" / "src" / script), *args]
    print("RUN:", " ".join(cmd))
    subprocess.run(cmd, cwd=ROOT, check=True)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--force", action="store_true", help="Re-download/rebuild even when the processed dataset exists")
    args = parser.parse_args()

    print("=" * 78)
    print("ORCA-X COLAB DATASET BOOTSTRAP")
    print("=" * 78)
    print(f"Repository: {ROOT}")
    print(f"Canonical dataset: {DATA}")

    if DATA.exists() and not args.force:
        print(f"Dataset already exists ({DATA.stat().st_size / (1024**2):.1f} MiB); skipping download/prepare.")
        return

    # These scripts use the real Open-Meteo Historical Weather + Marine APIs.
    run("download_historical_marine.py")
    run("prepare_dataset.py")

    if not DATA.exists():
        raise FileNotFoundError(f"Dataset preparation completed without creating {DATA}")

    print(f"READY: {DATA} ({DATA.stat().st_size / (1024**2):.1f} MiB)")


if __name__ == "__main__":
    main()
