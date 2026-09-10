"""Push the repository-owned ORCA-X Kaggle notebook from VS Code.

Usage (PowerShell):
    $env:KAGGLE_USERNAME = "your_kaggle_username"
    python ml/kaggle/push_kaggle.py

The script writes a temporary kernel-metadata.json next to this file and asks
Kaggle CLI to push the notebook. The generated metadata is intentionally not
committed because it contains the user's Kaggle username.
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
from pathlib import Path

HERE = Path(__file__).resolve().parent
METADATA = HERE / "kernel-metadata.json"
TEMPLATE = HERE / "kernel-metadata.template.json"


def main() -> None:
    username = os.environ.get("KAGGLE_USERNAME", "").strip()
    if not username:
        raise SystemExit(
            "KAGGLE_USERNAME is not set. Example (PowerShell): "
            '$env:KAGGLE_USERNAME = "your_kaggle_username"'
        )

    kaggle = shutil.which("kaggle")
    if not kaggle:
        raise SystemExit(
            "Kaggle CLI was not found. Install it with: "
            "python -m pip install --upgrade kaggle"
        )

    metadata = json.loads(TEMPLATE.read_text(encoding="utf-8"))
    metadata["id"] = f"{username}/{metadata['slug']}"
    metadata.pop("slug", None)
    METADATA.write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")

    try:
        subprocess.run([kaggle, "kernels", "push", "-p", str(HERE)], check=True)
    finally:
        # Never leave user-specific Kaggle metadata in the working tree.
        METADATA.unlink(missing_ok=True)


if __name__ == "__main__":
    main()
