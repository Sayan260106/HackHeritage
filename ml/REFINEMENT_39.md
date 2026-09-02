# Refinement 39 — Final ML Validation & Hardening

Refinement 39 is the final ML quality gate for the ORCA-X historical risk model. It is intentionally diagnostic: it does **not** change the operational risk policy, retrain the production model, or use the 2025 final temporal test for model selection.

## What is audited

- 2025 out-of-time performance using the locked R38 protocol.
- Performance by operational location and month.
- HIGH/EXTREME underprediction patterns and the largest confusion paths.
- Current-risk → six-hour-future-risk transitions.
- Geographic dependence through controlled latitude/longitude ablation.
- Sampled permutation importance on the 2025 test set.
- Multiclass calibration using Brier score, log loss and ECE.
- Production metadata and point-in-time feature contract.
- Whether Digha is a genuine holdout for the **final production artifact**. R38 remains the authoritative spatial-holdout evidence because the production promotion intentionally retrains on all six operational locations through 2024.

## Run

From the repository root, after the reviewed v2.6 model and R38 evaluation artifacts are present:

```bash
python ml/src/refinement39_final_audit.py
```

For the Kaggle/Colab GPU workflow, use the same environment used to produce the v2.6 artifact. The audit itself is inference/diagnostic work; it does not require GPU training.

## Outputs

The script writes:

- `ml/models/refinement39_audit/refinement39_audit.json`
- `ml/models/refinement39_audit/permutation_importance_2025.csv`

## Finalization rule

Freeze the model when the audit finds no material leakage or generalization defect. If a material defect is discovered, make **one targeted corrective change**, rerun the locked R38 evaluation, and rerun Refinement 39. Do not repeatedly tune against the 2025 final test.

The production system must continue to treat authoritative IMD/INCOIS/Coast Guard evidence and grounded RAG evidence as higher-priority safety evidence than the ML score.
