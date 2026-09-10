"""Validate the ORCA-X Colab ML runtime before an expensive run."""
from __future__ import annotations

import ast
import importlib
import subprocess
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "ml" / "src"


def xgboost_scripts() -> list[Path]:
    found: list[Path] = []
    for path in sorted(SRC.glob("*.py")):
        if path.name in {"colab_gpu_runner.py", "colab_preflight.py"}:
            continue
        try:
            tree = ast.parse(path.read_text(encoding="utf-8"))
        except (OSError, SyntaxError):
            continue
        text = path.read_text(encoding="utf-8")
        uses_xgb = any(isinstance(node, ast.Name) and node.id.startswith("XGB") for node in ast.walk(tree)) or "import xgboost" in text or "from xgboost" in text
        if uses_xgb:
            found.append(path)
    return found


def gpu_name() -> str | None:
    try:
        result = subprocess.run(
            ["nvidia-smi", "--query-gpu=name,memory.total", "--format=csv,noheader"],
            check=False, capture_output=True, text=True,
        )
    except OSError:
        return None
    return result.stdout.strip() if result.returncode == 0 and result.stdout.strip() else None


def test_xgboost_cuda() -> str | None:
    """Prove that XGBoost itself can fit and predict on the visible GPU."""
    try:
        import xgboost as xgb
        X = np.arange(80, dtype=np.float32).reshape(-1, 2)
        y = (X[:, 0] + X[:, 1] > 78).astype(int)
        model = xgb.XGBClassifier(
            n_estimators=2, max_depth=2, tree_method="hist", device="cuda",
            n_jobs=2, eval_metric="logloss", random_state=42,
        )
        model.fit(X, y, verbose=False)
        model.predict(X[:4])
        return None
    except Exception as exc:
        return str(exc)


def main() -> None:
    print("=" * 78)
    print("ORCA-X COLAB GPU PREFLIGHT")
    print("=" * 78)

    failures: list[str] = []
    for package in ("numpy", "pandas", "sklearn", "pyarrow", "xgboost"):
        try:
            mod = importlib.import_module(package)
            print(f"OK   {package}: {getattr(mod, '__version__', 'installed')}")
        except Exception as exc:
            failures.append(f"{package}: {exc}")
            print(f"FAIL {package}: {exc}")

    gpu = gpu_name()
    if gpu:
        print("OK   NVIDIA GPU:", gpu)
    else:
        failures.append("No visible NVIDIA GPU")
        print("FAIL NVIDIA GPU: nvidia-smi cannot see a GPU")

    if gpu and not any(item.startswith("xgboost:") for item in failures):
        cuda_error = test_xgboost_cuda()
        if cuda_error:
            failures.append(f"XGBoost CUDA execution: {cuda_error}")
            print("FAIL XGBoost CUDA execution:", cuda_error)
        else:
            print("OK   XGBoost CUDA execution: tiny GPU fit/predict succeeded")

    scripts = xgboost_scripts()
    print(f"\nDetected XGBoost scripts: {len(scripts)}")
    for path in scripts:
        print(f"  - {path.relative_to(ROOT)}")

    compile_failures: list[str] = []
    for path in sorted(SRC.glob("*.py")):
        try:
            compile(path.read_text(encoding="utf-8"), str(path), "exec")
        except SyntaxError as exc:
            compile_failures.append(f"{path.name}: {exc}")
    if compile_failures:
        failures.extend(compile_failures)
        print("\nFAIL Python compilation:")
        for item in compile_failures:
            print("  ", item)
    else:
        print("OK   Python compilation: all ml/src/*.py files compile")

    print("\n" + "=" * 78)
    if failures:
        print("PREFLIGHT FAILED")
        for item in failures:
            print(" -", item)
        raise SystemExit(1)
    print("PREFLIGHT PASSED — Colab GPU is ready for ORCA-X ML execution")


if __name__ == "__main__":
    main()
