# ORCA-X Kaggle GPU workflow

This directory is the project-owned Kaggle GPU setup. The existing `ml/colab/` workflow remains unchanged and is still supported.

## What this solves

A fresh cloud clone does **not** contain the generated parquet dataset because large generated data is intentionally ignored by Git. The Kaggle notebook therefore:

1. checks that Kaggle has a GPU,
2. clones the exact ORCA-X repository branch,
3. installs the pinned Colab/Kaggle ML dependencies,
4. rebuilds the canonical historical dataset from the project's real Open-Meteo sources when it is missing,
5. runs the requested ORCA-X training/refinement script on CUDA,
6. keeps generated data and model outputs inside the Kaggle runtime.

The source dataset is reproducible from the repository's `download_historical_marine.py` and `prepare_dataset.py` pipeline; the processed parquet is deliberately not committed to Git.

## Option A — run the notebook directly on Kaggle

Open `orca_x_kaggle_gpu.ipynb` in Kaggle and enable **GPU** plus **Internet** in the notebook settings.

The notebook has a `SCRIPT` variable near the top. For R36:

```python
SCRIPT = "ml/src/refinement36_coastal_domain_adaptation.py"
```

For another XGBoost refinement, change only `SCRIPT`.

## Option B — launch from VS Code with the Kaggle API

Install the Kaggle CLI:

```powershell
python -m pip install --upgrade kaggle
```

Create a Kaggle API token from your Kaggle account settings and place `kaggle.json` in:

```text
Windows: %USERPROFILE%\.kaggle\kaggle.json
Linux:   ~/.kaggle/kaggle.json
```

Do **not** commit `kaggle.json`, API keys, or secrets.

Set your Kaggle username before pushing:

```powershell
$env:KAGGLE_USERNAME = "YOUR_KAGGLE_USERNAME"
python ml/kaggle/push_kaggle.py
```

The helper generates the temporary `kernel-metadata.json` required by Kaggle and runs `kaggle kernels push` for `ml/kaggle`.

## GPU choice

For ORCA-X XGBoost jobs, use a Kaggle **GPU** accelerator. A T4 is sufficient for the current refinements. You do not need two GPUs for the current scripts because XGBoost is configured for a single CUDA device.

## Important data rule

Do not upload the 2024–2025 processed parquet into Git just to make Kaggle work. The repository intentionally ignores generated parquet/CSV data. Recreate the canonical dataset inside the cloud runtime instead:

```bash
python ml/src/colab_prepare.py
```

Despite the historical filename, `colab_prepare.py` is a cloud bootstrapper: it invokes the project's real historical download + preparation scripts and works in Kaggle as well.

## R36 command

Once the repository and dataset are ready:

```bash
python ml/src/colab_gpu_runner.py ml/src/refinement36_coastal_domain_adaptation.py
```

The runner selects CUDA when `ORCA_X_DEVICE=cuda` is set and falls back to CPU when explicitly configured otherwise.

## Reproducibility

Record these in the experiment output when reporting results:

- Git branch and commit SHA
- dataset manifest/version
- accelerator (for example Tesla T4)
- XGBoost version
- `ORCA_X_DEVICE`
- `ORCA_X_N_JOBS`
- refinement script

Generated benchmark artifacts should be copied back to the appropriate `ml/models/refinementXX/` directory only when they are intentionally part of the project evidence.
