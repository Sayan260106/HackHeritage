# ORCA-X Real-Time Source Onboarding

## Purpose

ORCA-X uses heterogeneous marine observations for live decision support. The three-source pipeline is:

**INCOIS in-situ + MOSDAC/ISRO satellite + Open-Meteo weather/marine**
→ normalize
→ freshness/quality validation
→ variable-level fusion
→ 44-feature point-in-time ML vector
→ existing XGBoost risk engine.

The model contract is intentionally unchanged. Sources do not get concatenated into a new opaque feature space; each source contributes only variables it actually observes.

## Source policy

### Open-Meteo

Open-Meteo remains the operational baseline for complete live weather and marine coverage. It supplies the complete feature vector used by the current XGBoost service.

### INCOIS

The repository now has a direct public INCOIS ERDDAP adapter for `Indian_ARGO_Floats`. It selects the nearest available near-surface Argo profile and contributes `seaSurfaceTemperatureC` when the observation passes the freshness gate.

INCOIS Argo is an in-situ profile product, not a full surface wind/wave feed. Therefore the adapter does **not** fabricate wind, gust, wave, swell or current values. When its observation is stale, its score becomes zero and Open-Meteo/MOSDAC remain eligible.

`INCOIS_REALTIME_URL` is no longer required for the public Argo path. It may still be used by a separately approved normalized gateway if a true near-real-time INCOIS surface observation service becomes available.

### MOSDAC / ISRO

MOSDAC provides satellite products through its official API/download workflow. ORCA-X supports two safe integration modes:

1. `MOSDAC_REALTIME_URL` — an approved normalized gateway returning ORCA-X values.
2. `MOSDAC_REALTIME_CACHE_FILE` — a local normalized JSON snapshot generated from an official MOSDAC download.

The repository includes `scripts/mosdac-normalize.py` for converting an official MOSDAC HDF/HDF5 SST product into the cache format. The utility does not authenticate to MOSDAC and never stores credentials.

For INSAT-3DS SST, use the MOSDAC dataset/product identifier shown in the official catalogue (for example `3SIMG_L3B_SST` in the published product documentation). Only variables actually present in the downloaded product are exported.

## Automated MOSDAC refresh

The repository now includes `scripts/mosdac-sync.py`, exposed as:

```powershell
npm run sync:mosdac
```

The worker delegates authentication and downloading to the official MOSDAC Data Download API client. It then runs the existing credential-free HDF normalizer and atomically publishes `data/realtime/mosdac_latest.json`.

Set the credentials only in the process environment:

```powershell
$env:MOSDAC_USERNAME="<your MOSDAC username>"
$env:MOSDAC_PASSWORD="<your MOSDAC password>"
```

The worker defaults to the INSAT-3DS daily SST dataset `3SIMG_L3B_SST`, a Digha-area target (`21.6266, 87.5074`) and a two-day search window. Override the target/window through environment variables when deploying for other coastal locations. The official MOSDAC documentation states that dataset search accepts a bounding box and date range, while download requires authenticated credentials.

For the official client, either point `MOSDAC_MDAPI_DIR` at the directory containing `mdapi.py`, or allow a temporary download of the official client:

```powershell
$env:MOSDAC_AUTO_DOWNLOAD_CLIENT="true"
npm run sync:mosdac
```

The downloaded client, generated `config.json`, credentials and temporary products are removed when the worker exits. No credentials are written to Git or the repository's persistent telemetry.

The normalized MOSDAC source is accepted only when the observation is fresh and spatially valid. The default freshness gate is 36 hours (`MOSDAC_MAX_CACHE_STALENESS_HOURS=36`), which is intentionally compatible with the documented daily INSAT-3DS SST product cadence. Stale MOSDAC data is rejected rather than presented as live.

When a fresh MOSDAC SST snapshot exists, the satellite/ocean intelligence layer prefers it over the Open-Meteo SST fallback. Chlorophyll, SST anomaly, turbidity and other indicators continue to come from their existing independent scientific sources; ORCA-X does not fabricate missing satellite variables.

## Variable-level fusion

The fusion layer first validates every provider independently. It then chooses the best fresh provider **per variable**, using freshness, availability and provider priority. This is important because an Indian satellite/in-situ source may provide excellent SST without providing the wind/wave variables needed for the full model vector.

Example:

- wind speed → Open-Meteo
- wind gust → Open-Meteo
- wave height → Open-Meteo
- SST → MOSDAC if a fresher valid satellite observation is available
- SST → INCOIS if its fresh Argo observation outranks the alternatives

The selected per-variable provenance is returned as `featureSources` and is persisted in telemetry as `feature:<variable>` entries.

## MOSDAC cache workflow

1. Register/login to MOSDAC outside the repository and obtain access to the required product.
2. Use the official MOSDAC Data Download API/client to download the required HDF/HDF5 product.
3. Install the optional normalizer dependencies:

```powershell
python -m pip install -r scripts/requirements-mosdac.txt
```

4. Normalize the product manually when needed:

```powershell
python scripts/mosdac-normalize.py --input C:\path\to\product.h5 --latitude 21.63 --longitude 87.51 --output data\realtime\mosdac_latest.json
```

5. Or use the automated worker:

```powershell
$env:MOSDAC_USERNAME="<your MOSDAC username>"
$env:MOSDAC_PASSWORD="<your MOSDAC password>"
$env:MOSDAC_AUTO_DOWNLOAD_CLIENT="true"
npm run sync:mosdac
```

6. Run the realtime collector so the normalized MOSDAC observation is recorded alongside INCOIS and Open-Meteo.

For production, schedule `npm run sync:mosdac` with the deployment platform's secret manager and scheduler. Do not put MOSDAC credentials in `.env.example`, Git, logs or telemetry.

## Verification

Run:

```powershell
npm run verify:realtime
```

This verifies Open-Meteo, the public INCOIS ERDDAP path and the MOSDAC catalogue. It also checks any configured normalized adapters. A successful catalogue probe is **not** equivalent to live MOSDAC data availability; actual satellite data still has to be downloaded through the official MOSDAC access workflow.

After a successful refresh, verify that the normalized snapshot is fresh and that the API reports MOSDAC as a selected source for `seaSurfaceTemperatureC` when appropriate.

## Telemetry and retraining gate

Start the collector with:

```powershell
$env:REALTIME_COLLECTION_ENABLED="true"
$env:REALTIME_COLLECTION_INTERVAL_MS="900000"
npm run dev
```

The collector persists `data/realtime/marine_telemetry.jsonl` by default.

Run:

```powershell
npm run analyze:realtime
```

The analysis requires, by default:

- at least 100 telemetry events;
- at least 2 live sources with >=80% live coverage;
- at least 50 pairwise samples for a source pair;
- mean source quality >=0.60;
- explicit engineering review of distribution shift.

The script remains conservative and **never authorizes retraining by itself**. Distribution-shift review remains an explicit gate before XGBoost v2.7.

## ML training policy

The production XGBoost v2.6 artifact is not modified by source onboarding. Do not retrain simply because a third source was connected. First collect parallel source observations, verify missingness and disagreement, compare distributions against the historical training data, and document the shift.

If the evidence supports retraining, train a v2.7 candidate using the same locked temporal 2025 test and Digha spatial holdout protocols. Promotion remains manual.

## Security rule

Do not place MOSDAC passwords, API credentials, cookies, tokens or session files in Git. Use the local environment, deployment secret manager, or the official MOSDAC client outside the repository.
