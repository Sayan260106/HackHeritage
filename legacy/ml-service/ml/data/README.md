# ORCA-X ML data

## Refinement 4 / v2.5

The Refinement 4 training pipeline uses real historical Open-Meteo weather + marine observations at six representative Indian coastal points.

Run:

```bash
python ml/src/download_historical_marine.py
python ml/src/prepare_dataset.py
python ml/src/train.py
```

The training target is a **six-hour forward operational severity proxy**. The current environmental state is used as input and the risk class is derived from conditions six hours later. This avoids training the model to reproduce a contemporaneous threshold label and gives the evaluation a genuine forward-prediction interpretation.

The base dataset contains 18 point-in-time environmental/location/calendar features, including visibility. Missing observations are preserved rather than synthetically imputed. The model adds explicit missingness indicators, circular direction features and gust-structure features. It does **not** use hidden 3h/6h lag or trend features because the production API receives one live observation and cannot legitimately derive those values without a separate time-series state store.

Evaluation includes a chronological temporal validation split, a complete Digha spatial holdout, and majority-class baselines. Raw and generated tabular data are intentionally ignored by Git; `dataset_manifest.json` is regenerated locally.

The previous NOAA NDBC pipeline remains available for comparison/audit but is no longer the primary Refinement 4 training source. The committed model artifact remains the legacy compatible artifact until the documented download → prepare → train pipeline is executed and the resulting v2.5 model is evaluated.
