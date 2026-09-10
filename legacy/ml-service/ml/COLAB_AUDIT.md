# ORCA-X Colab compatibility audit

Audited the full `ml/src` tree on 2026-08-31 for the current refinement pipeline.

## Result

- The canonical production trainer has first-class `ORCA_X_DEVICE` support.
- Existing XGBoost-based training/refinement scripts can be executed through `colab_gpu_runner.py` without editing their scientific logic.
- The runner covers `XGBClassifier`, `XGBRegressor`, and `XGBRanker`.
- The runner verifies that an NVIDIA GPU is actually visible before starting an expensive job.
- `colab_preflight.py` compiles every Python file under `ml/src` and reports all XGBoost-using scripts before a long run.
- Colab dependencies are isolated in `ml/requirements-colab.txt`.
- The dedicated notebook uses the current GPU branch and runs preflight before training/refinement.

## Scope of the GPU migration

Only XGBoost estimator computation is GPU accelerated. pandas, NumPy, scikit-learn metrics/calibration, and file I/O continue to use the Colab CPU. This is normal and does not involve the developer laptop CPU.

## Scientific invariants

The audit intentionally does not modify the completed refinement methodology: target horizon, point-in-time contract, temporal validation, Digha holdout, degradation scenarios, uncertainty calibration, or safety policy.

## Operational rule

Run heavy ML jobs from inside Colab using the runner. A PowerShell command on the laptop remains a local CPU process even while a Colab browser session is open.
