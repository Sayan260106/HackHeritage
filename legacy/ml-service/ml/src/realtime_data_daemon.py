"""Continuously bridge server-side fused telemetry into the ML live store.

Run this process alongside the ORCA-X server when persistent shared storage is available.
It imports fused 17-feature observations and matures +6h labels. It never trains or
promotes a model automatically.
"""
from __future__ import annotations

import os
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
INTERVAL_SECONDS = max(300, int(os.environ.get("REALTIME_ML_SYNC_INTERVAL_SECONDS", "900")))


def run_import() -> None:
    script = ROOT / "ml" / "src" / "import_realtime_telemetry.py"
    result = subprocess.run([sys.executable, str(script)], cwd=ROOT, check=False)
    if result.returncode != 0:
        print(f"REALTIME ML SYNC: telemetry import exited with code {result.returncode}")


def run_mature() -> None:
    script = ROOT / "ml" / "src" / "realtime_training.py"
    result = subprocess.run([sys.executable, str(script), "mature"], cwd=ROOT, check=False)
    if result.returncode != 0:
        print(f"REALTIME ML SYNC: label maturation exited with code {result.returncode}")


def main() -> None:
    print(f"Realtime ML sync enabled: interval={INTERVAL_SECONDS}s")
    while True:
        started = time.monotonic()
        try:
            run_import()
            run_mature()
        except Exception as exc:
            print(f"REALTIME ML SYNC: cycle failed: {exc}")
        elapsed = time.monotonic() - started
        time.sleep(max(5, INTERVAL_SECONDS - elapsed))


if __name__ == "__main__":
    main()
