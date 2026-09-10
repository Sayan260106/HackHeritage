"""ORCA-X XGBoost ML inference API with staged v1/v2 model compatibility."""
from __future__ import annotations

from datetime import datetime
from pathlib import Path
import sys
from typing import Optional, Union

# pyrefly: ignore [missing-import]
from fastapi import FastAPI, HTTPException
# pyrefly: ignore [missing-import]
from pydantic import BaseModel

ML_ROOT = Path(__file__).resolve().parent
ML_SRC = ML_ROOT / "src"
if str(ML_SRC) not in sys.path:
    sys.path.insert(0, str(ML_SRC))

try:
    from ml.src.predict import MODEL_VERSION, OrcaXRiskPredictor  # noqa: E402
except ImportError:
    try:
        # pyrefly: ignore [missing-import]
        from predict import MODEL_VERSION, OrcaXRiskPredictor  # noqa: E402
    except ImportError:
        from .src.predict import MODEL_VERSION, OrcaXRiskPredictor  # noqa: E402


app = FastAPI(
    title="ORCA-X ML Risk API",
    description="XGBoost marine environmental risk prediction service.",
    version="2.0.0",
)
predictor = OrcaXRiskPredictor()


class RiskRequest(BaseModel):
    wind_speed_kts: Optional[float] = None
    wind_gust_kts: Optional[float] = None
    wave_height_m: Optional[float] = None
    wave_period_s: Optional[float] = None
    mean_wave_period_s: Optional[float] = None
    swell_height_m: Optional[float] = None
    swell_period_s: Optional[float] = None
    wind_direction_deg: Optional[float] = None
    wave_direction_deg: Optional[float] = None
    swell_direction_deg: Optional[float] = None
    air_pressure_hpa: Optional[float] = None
    air_temperature_c: Optional[float] = None
    water_temperature_c: Optional[float] = None
    sea_surface_temperature_c: Optional[float] = None
    precipitation_mm: Optional[float] = None
    visibility_km: Optional[float] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    month: Optional[int] = None
    hour: Optional[int] = None
    season: Optional[int] = None
    observed_at: Optional[Union[datetime, str]] = None



@app.get("/")
def root():
    return {
        "service": "ORCA-X ML Risk API",
        "status": "online",
        "model": "XGBoost",
        "model_version": MODEL_VERSION,
        "loaded_model_version": predictor.model_version,
        "feature_count": len(predictor.feature_columns),
        "feature_contract": predictor.feature_columns,
    }


@app.get("/health")
def health():
    return {
        "status": "healthy",
        "model_loaded": predictor.model is not None,
        "model_version": predictor.model_version,
        "feature_count": len(predictor.feature_columns),
    }


@app.get("/ready")
def ready():
    if predictor.model is None:
        raise HTTPException(status_code=503, detail="ML model is not loaded")
    return {
        "status": "ready",
        "model_loaded": True,
        "model_version": predictor.model_version,
        "feature_count": len(predictor.feature_columns),
    }


class BatchRiskRequest(BaseModel):
    items: list[RiskRequest]


@app.post("/predict-risk")
def predict_risk(request: RiskRequest):
    try:
        payload = request.model_dump(exclude_none=True)
        if isinstance(payload.get("observed_at"), datetime):
            payload["observed_at"] = payload["observed_at"].isoformat()
        result = predictor.predict_one(payload)
        return {"success": True, **result}
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Risk prediction failed: {exc}") from exc


@app.post("/predict-risk-batch")
def predict_risk_batch(request: BatchRiskRequest):
    try:
        payloads = []
        for item in request.items:
            dumped = item.model_dump(exclude_none=True)
            if isinstance(dumped.get("observed_at"), datetime):
                dumped["observed_at"] = dumped["observed_at"].isoformat()
            payloads.append(dumped)
        results = predictor.predict_batch(payloads)
        return {"success": True, "count": len(results), "results": results}
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Batch risk prediction failed: {exc}") from exc


@app.post("/diagnostics/ood")
def diagnose_ood(request: RiskRequest):
    try:
        payload = request.model_dump(exclude_none=True)
        diagnostics = predictor.diagnose_ood(payload)
        return {"success": True, **diagnostics}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"OOD diagnostics failed: {exc}") from exc


