# ORCA-X Google Colab GPU workflow

The canonical ORCA-X production model is XGBoost. The project can train it on a Google Colab GPU without changing its data contract or evaluation policy. The heavy XGBoost refinement/audit scripts can also be launched through the Colab GPU runner.

## What changed

- `ml/src/train.py` accepts `ORCA_X_DEVICE=cpu|cuda`.
- `ORCA_X_DEVICE=cuda` maps to XGBoost's GPU `device="cuda"` while retaining `tree_method="hist"`.
- `ORCA_X_N_JOBS` controls CPU-side worker parallelism; Colab defaults to `2`.
- CPU remains the default for direct local execution, so existing workflows remain backward-compatible.
- `ml/src/colab_gpu_runner.py` provides a compatibility shim for existing XGBoost refinement scripts. It injects `device="cuda"` and `tree_method="hist"` into XGBoost estimators that do not explicitly select a device, without changing the refinement algorithms.
- `ml/requirements-colab.txt` contains the lightweight Colab ML dependencies.
- `ml/colab/ORCA_X_GPU_Training.ipynb` handles canonical production-model training.
- `ml/colab/ORCA_X_Refinements_GPU.ipynb` handles computationally heavy refinement/audit runs such as Refinement 25/26.

## Canonical production training in Colab

1. Open `ml/colab/ORCA_X_GPU_Training.ipynb`.
2. Select a T4/L4 GPU runtime.
3. Run all cells.
4. The notebook downloads the real historical Open-Meteo weather + marine data and rebuilds the canonical parquet.
5. It runs `ml/src/train.py` with `ORCA_X_DEVICE=cuda`.
6. It evaluates the temporal validation and Digha spatial holdout.
7. It packages `orca_xgb_risk.json` and `orca_xgb_risk_metadata.json` for use by the application.

## Refinement 25/26 and other XGBoost audits

Do **not** run a heavy refinement locally if you want to keep the laptop cool. Inside Colab, use:

```bash
python ml/src/colab_gpu_runner.py ml/src/refinement26_uncertainty_aware_forecast.py
```

For Refinement 25:

```bash
python ml/src/colab_gpu_runner.py ml/src/refinement25_temporal_reliability_forecast.py
```

The runner sets:

```text
ORCA_X_DEVICE=cuda
ORCA_X_N_JOBS=2
```

and patches the imported XGBoost estimator constructors so existing refinement code can use the Colab GPU. CPU-side pandas, NumPy and scikit-learn evaluation still run on the Colab CPU; only XGBoost tree computation is moved to the GPU.

The repository currently contains multiple historical refinement scripts that use XGBoost, including Refinements 18, 19, 22, 23, 24, 25 and 26. The runner is intentionally generic so these scripts do not need duplicated GPU-specific implementations.

## Important methodology rule

This is a **compute migration, not a model redesign**. Do not change the refinement methodology merely to obtain a faster run. Preserve:

- the six-hour forward forecasting horizon;
- point-in-time information constraints;
- chronological/temporal validation rules;
- Digha spatial holdout rules;
- observation-degradation scenarios;
- uncertainty calibration methodology;
- existing risk-policy/version metadata.

Refinements 20–26 remain audit/benchmark work unless a refinement explicitly promotes a model to production. The canonical production XGBoost model remains the source of truth for application inference.

## Local CPU fallback

Direct local execution remains supported:

```bash
# PowerShell
$env:ORCA_X_DEVICE="cpu"
$env:ORCA_X_N_JOBS="-1"
python ml/src/train.py
```

For Colab canonical training:

```bash
export ORCA_X_DEVICE=cuda
export ORCA_X_N_JOBS=2
python ml/src/train.py
```

For a Colab refinement:

```bash
python ml/src/colab_gpu_runner.py ml/src/refinement26_uncertainty_aware_forecast.py
```

Do not commit generated raw datasets or large model artifacts unless the repository's artifact policy explicitly requires them. The Colab workflow is designed to rebuild data and export the trained artifacts when needed.
