# ORCA-X Colab GPU ML workflow

The ML directory supports Colab T4/L4 execution for expensive XGBoost work without changing the completed ORCA-X scientific methodology.

## Recommended workflow

Open `ml/colab/ORCA_X_Refinements_GPU.ipynb` in Google Colab.

1. Select `Runtime > Change runtime type > GPU` and use T4/L4 when available.
2. Run the installation cell.
3. Run `python ml/src/colab_preflight.py`.
4. Run one expensive training/refinement at a time.

The preflight checks Python packages, GPU visibility, and compilation of every `ml/src/*.py` file.

## Performance optimization — important

The original Refinement 29 implementation repeatedly retrained the same XGBoost ensembles for each scenario and configuration. This is computationally wasteful because the gate/calibration parameters only change how already-generated predictions are evaluated.

A cached implementation is now available:

```bash
!python ml/src/colab_gpu_runner.py ml/src/refinement29_safety_gate_calibration_fast.py
```

It:

- builds the dataset/features once;
- trains the location-holdout ensemble once per fold;
- caches training predictions used for calibration;
- caches predictions for all degradation scenarios;
- evaluates all 16 calibration/gate configurations without refitting;
- performs the final temporal validation with one additional training fit;
- uses CUDA XGBoost when the Colab GPU is available;
- attempts GPU-native XGBoost prediction through CuPy to avoid the CPU-input/device-mismatch fallback.

This removes the previous pattern of refitting models separately for every scenario and every trial. The benchmark remains read-only and preserves the six-hour point-in-time contract, location holdout, degradation scenarios, calibration levels, gate thresholds, and objective.

### Profile before expensive runs

Use the lightweight profiler to measure dataset/pair/feature preparation:

```bash
!python ml/src/performance_profile.py
```

It writes `ml/models/performance_profile/performance_profile.json` and does not train models.

## Canonical production model

```bash
python ml/src/train.py
```

In the Colab workflow, CUDA execution is configured with:

```text
ORCA_X_DEVICE=cuda
ORCA_X_N_JOBS=2
```

## GPU adapter

Use the adapter for XGBoost refinements:

```bash
!python ml/src/colab_gpu_runner.py ml/src/<script>.py
```

The adapter covers `XGBClassifier`, `XGBRegressor` and `XGBRanker`, sets `device="cuda"`, keeps `tree_method="hist"`, limits estimator-level CPU parallelism, and fails early when no NVIDIA GPU is visible.

## What is and is not GPU-accelerated

GPU:

- XGBoost tree construction;
- XGBoost prediction when the estimator/input path supports GPU-native prediction.

Colab CPU:

- pandas data loading/transforms;
- NumPy feature calculations;
- scikit-learn metrics/calibration;
- CSV/JSON/parquet I/O;
- ordinary Python orchestration.

This is expected. A T4 accelerates the tree-model workload; it does not make pandas or ordinary Python automatically GPU-accelerated.

## Methodology preservation

The optimization does not change:

- the six-hour forward forecasting horizon;
- point-in-time feature constraints;
- temporal validation rules;
- Digha spatial holdout;
- observation-degradation scenarios;
- uncertainty calibration;
- risk-policy thresholds;
- production inference contract.

Refinement 29 remains a **read-only benchmark** and must not automatically replace production artifacts.

## Important local-terminal rule

A command run on the Windows laptop does not use the Colab GPU. The Colab GPU is available only inside the Colab runtime.

## Data and artifacts

The Colab environment is ephemeral. Rebuild/download the required processed dataset in Colab and export generated model/evaluation artifacts before the runtime is deleted. Do not commit large raw datasets merely to make Colab work.
