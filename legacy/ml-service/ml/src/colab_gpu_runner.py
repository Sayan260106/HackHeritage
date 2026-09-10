"""Run an existing ORCA-X ML script with Colab GPU-compatible XGBoost settings.

This is a runtime adapter, not a second implementation of any refinement.
Direct execution of the original scripts remains CPU-compatible and unchanged.

Usage from the repository root inside Colab:
    python ml/src/colab_gpu_runner.py ml/src/refinement26_uncertainty_aware_forecast.py

The adapter covers the public XGBoost sklearn estimators used by the project.
It also fails early when CUDA is requested but no NVIDIA GPU is visible.
"""
from __future__ import annotations

import argparse
import os
import runpy
import subprocess
import sys
from pathlib import Path

XGB_ESTIMATORS = ("XGBClassifier", "XGBRegressor", "XGBRanker")


def _configure_environment() -> None:
    os.environ["ORCA_X_DEVICE"] = "cuda"
    os.environ.setdefault("ORCA_X_N_JOBS", "2")


def _require_gpu() -> None:
    try:
        result = subprocess.run(
            ["nvidia-smi", "--query-gpu=name", "--format=csv,noheader"],
            check=False, capture_output=True, text=True,
        )
    except OSError as exc:
        raise SystemExit(
            "No NVIDIA runtime was found. In Colab choose Runtime > Change runtime type > GPU "
            "and reconnect before running this command."
        ) from exc
    if result.returncode != 0 or not result.stdout.strip():
        raise SystemExit(
            "CUDA GPU is not visible to this Colab runtime. Choose a T4/L4 GPU runtime and reconnect."
        )
    print("Visible NVIDIA GPU(s):")
    print(result.stdout.strip())


def _patch_xgboost() -> None:
    """Patch estimator constructors before the target script imports them."""
    try:
        import xgboost as xgb
    except ImportError as exc:
        raise SystemExit(
            "xgboost is not installed. Run: python -m pip install -r ml/requirements-colab.txt"
        ) from exc

    device = os.getenv("ORCA_X_DEVICE", "cuda").strip().lower()
    n_jobs = int(os.getenv("ORCA_X_N_JOBS", "2"))
    if device == "cuda":
        _require_gpu()

    for class_name in XGB_ESTIMATORS:
        original = getattr(xgb, class_name, None)
        if original is None or getattr(original, "_orca_colab_patched", False):
            continue

        def make_wrapper(base_class):
            def wrapper(*args, **kwargs):
                kwargs.setdefault("device", device)
                kwargs.setdefault("tree_method", "hist")
                kwargs.setdefault("n_jobs", n_jobs)
                return base_class(*args, **kwargs)

            wrapper.__name__ = base_class.__name__
            wrapper.__qualname__ = base_class.__qualname__
            wrapper.__doc__ = base_class.__doc__
            wrapper._orca_colab_patched = True
            return wrapper

        setattr(xgb, class_name, make_wrapper(original))

    print(f"ORCA-X XGBoost device: {device}")
    print(f"ORCA-X XGBoost n_jobs: {n_jobs}")
    print(f"XGBoost version: {xgb.__version__}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("script", help="Path to an ORCA-X Python ML/refinement script")
    parser.add_argument("script_args", nargs=argparse.REMAINDER, help="Arguments forwarded unchanged")
    args = parser.parse_args()

    target = Path(args.script).resolve()
    if not target.exists() or target.suffix != ".py":
        raise SystemExit(f"Target Python script not found: {target}")

    _configure_environment()
    _patch_xgboost()

    script_dir = str(target.parent)
    if script_dir not in sys.path:
        sys.path.insert(0, script_dir)
    sys.argv = [str(target), *args.script_args]
    runpy.run_path(str(target), run_name="__main__")


if __name__ == "__main__":
    main()
