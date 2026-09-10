# Refinement 37 — Safe Coastal Expert Routing

R37 follows R36's coastal-domain adaptation experiment. R36 showed that full local experts beat the global model on most coasts, while small residual adapters did not. R37 tests whether those experts can be used safely through a frozen, auditable routing gate.

## Protocol

- Fit the global model and coast-specific experts on the first 80% of 2024.
- Use only the final 20% of 2024 for routing calibration.
- Freeze all route decisions before the 2025 test period.
- Route at `location × degradation scenario` granularity.
- Unknown locations/scenarios fall back to the global model.
- An expert is selected only when it improves the existing safety-weighted utility **and** passes all guardrails:
  - critical-recall drop no worse than 1 percentage point,
  - false-escalation increase no worse than 2 percentage points,
  - MAE no more than 10% above global.
- Minimum calibration support is 200 rows per location/scenario.

The utility remains the R34/R36 safety-first metric:

`10 × critical_recall + 2 × balanced_accuracy + accuracy − 2 × false_escalation_rate − 0.10 × MAE`

## Strategies

1. `global` — pooled model.
2. `local_expert` — coast-specific model.
3. `fixed_r36_reference` — R36-informed local-expert policy (reference diagnostic only; not eligible for selection).
4. `safe_router` — the actual pre-test safety-gated policy.

The fixed R36 reference is deliberately excluded from model selection because its coast membership was motivated by R36's 2025 observations. This prevents turning test-set evidence into a hidden tuning rule.

## Run on Kaggle / Colab

From the repository root:

```bash
python ml/src/colab_gpu_runner.py ml/src/refinement37_safe_coastal_routing.py
```

For GPU execution:

```text
ORCA_X_DEVICE=cuda
ORCA_X_N_JOBS=2
```

The script expects the generated dataset at:

```text
ml/data/processed/orca_historical_marine_risk.parquet
```

The existing Kaggle/Colab bootstrap workflow can regenerate it from the real historical Open-Meteo pipeline.

## Outputs

The benchmark writes to `ml/models/refinement37/`:

- `temporal_2025_routing_results.csv`
- `routing_calibration.csv`
- `frozen_routes.csv`
- `strategy_summary.csv`
- `benchmark_metadata.json`

These are experiment evidence, not production inference artifacts.

## Production rule

R37 does **not** change the production model, thresholds, risk policy, routing path, or inference service. Even if `safe_router` wins the benchmark, production adoption requires inspection of the frozen route table and per-coast/per-scenario safety metrics first.
